"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAttachment = createAttachment;
exports.listAttachmentsForMessage = listAttachmentsForMessage;
exports.deleteAttachment = deleteAttachment;
exports.getAttachmentById = getAttachmentById;
exports.getAttachmentSignedUrl = getAttachmentSignedUrl;
exports.enqueueCvParsingJobForAttachment = enqueueCvParsingJobForAttachment;
const database_1 = require("../config/database");
const queue_1 = require("../config/queue");
const errorHandling_1 = require("../utils/errorHandling");
const hashing_1 = require("../utils/hashing");
const inboxMemory_1 = require("./inboxMemory");
const documentClassifier_1 = require("./documentClassifier");
const documentLinkQueue_1 = require("../queues/documentLinkQueue");
const parsingJobsService_1 = require("./parsingJobsService");
const logger = (0, errorHandling_1.createLogger)('InboxAttachmentService');
async function createAttachment(input) {
    if (!input.inboxMessageId)
        throw new errorHandling_1.AppError('inboxMessageId is required', errorHandling_1.ErrorType.VALIDATION, 400);
    if (!input.fileBuffer || input.fileBuffer.length === 0)
        throw new errorHandling_1.AppError('fileBuffer is required', errorHandling_1.ErrorType.VALIDATION, 400);
    if (!input.fileName)
        throw new errorHandling_1.AppError('fileName is required', errorHandling_1.ErrorType.VALIDATION, 400);
    if (!input.storageBucket)
        throw new errorHandling_1.AppError('storageBucket is required', errorHandling_1.ErrorType.VALIDATION, 400);
    if (!input.storagePath)
        throw new errorHandling_1.AppError('storagePath is required', errorHandling_1.ErrorType.VALIDATION, 400);
    const sha256 = (0, hashing_1.hashFile)(input.fileBuffer);
    // Classify attachment automatically
    const classification = documentClassifier_1.DocumentClassifier.classify(input.fileName, input.messageSubject, input.mimeType, input.fileBuffer);
    // Extract metadata hints from filename
    const metadata = documentClassifier_1.DocumentClassifier.extractMetadataFromFilename(input.fileName);
    // Determine storage path based on classification
    let finalStoragePath = input.storagePath;
    if (classification.attachmentKind === 'document' || classification.attachmentKind === 'unknown') {
        // WhatsApp identity-first rule: preserve explicit raw storage paths.
        // For other sources, default to unmatched_documents for later linking.
        const source = input.messageSource || 'web';
        const shouldPreserveProvidedPath = source === 'whatsapp' &&
            typeof input.storagePath === 'string' &&
            input.storagePath.startsWith('whatsapp/raw/');
        if (!shouldPreserveProvidedPath) {
            finalStoragePath = documentClassifier_1.DocumentClassifier.generateUnmatchedPath(source, input.inboxMessageId, input.fileName);
        }
    }
    try {
        const db = (0, database_1.supabaseAdminClient)();
        // Upload file to Supabase Storage (upsert to allow retries)
        // Note: occasionally Supabase storage may respond with non-JSON (HTML) on transient edge/proxy errors.
        // We'll retry a couple of times for these cases.
        const isTransientStorageError = (msg) => /Unexpected token\s*'<'.*valid JSON|not valid JSON|fetch failed|network|timeout|ECONNRESET|ETIMEDOUT/i.test(msg);
        let lastUploadError = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            const upload = await db.storage
                .from(input.storageBucket)
                .upload(finalStoragePath, input.fileBuffer, {
                upsert: true,
                contentType: input.mimeType ?? 'application/octet-stream',
            });
            const uploadError = upload?.error;
            if (!uploadError) {
                lastUploadError = null;
                break;
            }
            lastUploadError = uploadError;
            const errMsg = uploadError?.message || 'unknown error';
            if (attempt < 3 && isTransientStorageError(errMsg)) {
                logger.warn('Transient storage upload error, retrying', {
                    attempt,
                    bucket: input.storageBucket,
                    path: finalStoragePath,
                    error: errMsg,
                });
                await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
                continue;
            }
            throw new errorHandling_1.AppError(`Failed to upload to storage (bucket=${input.storageBucket}, path=${finalStoragePath}): ${errMsg}`, errorHandling_1.ErrorType.DATABASE, 500);
        }
        if (lastUploadError) {
            const errMsg = lastUploadError?.message || 'unknown error';
            throw new errorHandling_1.AppError(`Failed to upload to storage after retries (bucket=${input.storageBucket}, path=${finalStoragePath}): ${errMsg}`, errorHandling_1.ErrorType.DATABASE, 500);
        }
        // Pre-check for duplicates when DB is accessible
        if (input.attachmentType === 'cv' && sha256) {
            const { data: exists, error: checkErr } = await db
                .from('inbox_attachments')
                .select('id')
                .eq('sha256', sha256)
                .eq('attachment_type', 'cv')
                .limit(1);
            if (!checkErr && Array.isArray(exists) && exists.length > 0) {
                throw new errorHandling_1.AppError('Duplicate attachment (sha256 + type)', errorHandling_1.ErrorType.DUPLICATE, 409);
            }
        }
        const { data, error } = await db
            .from('inbox_attachments')
            .insert({
            inbox_message_id: input.inboxMessageId,
            candidate_id: input.candidateId ?? null,
            storage_bucket: input.storageBucket,
            storage_path: finalStoragePath,
            file_name: input.fileName,
            mime_type: input.mimeType ?? null,
            sha256,
            whatsapp_wamid: input.whatsappWamid ?? null,
            whatsapp_media_id: input.whatsappMediaId ?? null,
            attachment_type: input.attachmentType ?? 'cv',
            attachment_kind: classification.attachmentKind,
            document_type: classification.documentType,
            received_at: new Date().toISOString(),
        })
            .select()
            .single();
        if (error) {
            const msg = String(error.message || '');
            const code = error.code || '';
            // Robust duplicate detection for Postgres unique violations
            if (code === '23505' || /duplicate key|unique constraint|already exists/i.test(msg)) {
                if (/inbox_attachments_unique_whatsapp_media/i.test(msg)) {
                    throw new errorHandling_1.AppError('Duplicate WhatsApp media attachment (wamid + media_id)', errorHandling_1.ErrorType.DUPLICATE, 409);
                }
                throw new errorHandling_1.AppError('Duplicate attachment (sha256 + type)', errorHandling_1.ErrorType.DUPLICATE, 409);
            }
            throw error;
        }
        logger.info(`Attachment classified and created`, {
            attachmentId: data.id,
            kind: classification.attachmentKind,
            documentType: classification.documentType,
            extractedMetadata: metadata
        });
        // Auto-enqueue for document linking if it's a document or unknown type.
        // IMPORTANT: WhatsApp runs identity extraction first, so we do NOT enqueue linking here.
        const source = input.messageSource || 'web';
        const shouldAutoEnqueueLinking = source !== 'whatsapp';
        if (shouldAutoEnqueueLinking && (classification.attachmentKind === 'document' || classification.attachmentKind === 'unknown')) {
            try {
                await (0, documentLinkQueue_1.enqueueDocumentLink)(data.id);
                logger.info(`Enqueued document for linking`, { attachmentId: data.id });
            }
            catch (enqueueErr) {
                // Log error but don't fail the attachment creation
                logger.error(`Failed to enqueue document link`, { attachmentId: data.id, error: enqueueErr });
            }
        }
        return { ...data, extractedMetadata: metadata };
    }
    catch (err) {
        // If we already classified as duplicate, surface it without falling back
        if (err instanceof errorHandling_1.AppError && err.type === errorHandling_1.ErrorType.DUPLICATE) {
            throw err;
        }
        // Try robust duplicate detection on raw error blob
        const raw = JSON.stringify(err || {});
        if (/inbox_attachments_unique_whatsapp_media/i.test(raw)) {
            throw new errorHandling_1.AppError('Duplicate WhatsApp media attachment (wamid + media_id)', errorHandling_1.ErrorType.DUPLICATE, 409);
        }
        if (/23505|duplicate key|unique constraint|uq_inboxattachments_sha256_type/i.test(raw)) {
            throw new errorHandling_1.AppError('Duplicate attachment (sha256 + type)', errorHandling_1.ErrorType.DUPLICATE, 409);
        }
        // Heuristic: only fallback to memory if the inboxMessageId looks like a memory ID
        if (input.inboxMessageId.startsWith('msg_')) {
            logger.warn('Falling back to memory createAttachment due to DB error (memory messageId detected)');
            return (0, inboxMemory_1.memCreateAttachment)({
                inboxMessageId: input.inboxMessageId,
                fileName: input.fileName,
                mimeType: input.mimeType,
                attachmentType: input.attachmentType,
                storageBucket: input.storageBucket,
                storagePath: input.storagePath,
                sha256,
                candidateId: input.candidateId,
            });
        }
        // Otherwise treat as DB error to avoid incorrect 404 from memory fallback
        const detail = err?.message || JSON.stringify(err || {});
        throw new errorHandling_1.AppError(`Failed to create attachment (database error): ${detail}`, errorHandling_1.ErrorType.DATABASE, 500);
    }
}
async function listAttachmentsForMessage(messageId) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { data, error } = await db
            .from('inbox_attachments')
            .select('*')
            .eq('inbox_message_id', messageId)
            .order('created_at', { ascending: false });
        if (error) {
            throw error;
        }
        return data;
    }
    catch (err) {
        logger.warn('Falling back to memory listAttachmentsForMessage due to DB error');
        return (0, inboxMemory_1.memListAttachmentsForMessage)(messageId);
    }
}
async function deleteAttachment(id) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        // First, get the attachment to find the linked candidate
        const { data: attachment } = await db
            .from('inbox_attachments')
            .select('candidate_id')
            .eq('id', id)
            .single();
        const candidateId = attachment?.candidate_id;
        // Clean up orphaned parsing_jobs (no foreign key, manual cleanup needed)
        // parsing_jobs schema varies across deployments (inbox_attachment_id vs attachment_id)
        const attempt1 = await db.from('parsing_jobs').delete().eq('inbox_attachment_id', id);
        if (attempt1?.error) {
            const attempt2 = await db.from('parsing_jobs').delete().eq('attachment_id', id);
            if (attempt2?.error) {
                logger.warn('Failed to delete parsing jobs for attachment (non-fatal)', {
                    attachmentId: id,
                    error: attempt2?.error?.message || attempt2?.error,
                });
            }
        }
        logger.info(`Deleted parsing jobs for attachment ${id}`);
        // Delete the attachment (this will CASCADE to unmatched_documents if exists)
        const { data, error } = await db
            .from('inbox_attachments')
            .delete()
            .eq('id', id)
            .select()
            .single();
        if (error) {
            if (error.code === 'PGRST116' || error.details?.includes('Results contain 0 rows')) {
                throw new errorHandling_1.NotFoundError('Inbox attachment');
            }
            throw error;
        }
        // If attachment had a linked candidate, delete the candidate and all related data
        if (candidateId) {
            try {
                // Delete candidate (CASCADE will delete: candidate_documents, timeline_events, job_order_candidates, etc.)
                await db
                    .from('candidates')
                    .delete()
                    .eq('id', candidateId);
                logger.info(`Deleted candidate ${candidateId} and all related records along with attachment ${id}`);
            }
            catch (candidateDeleteError) {
                logger.warn(`Failed to delete candidate ${candidateId}:`, candidateDeleteError);
                // Don't throw - attachment is already deleted
            }
        }
        return data;
    }
    catch (err) {
        logger.warn('Falling back to memory deleteAttachment due to DB error');
        return (0, inboxMemory_1.memDeleteAttachment)(id);
    }
}
async function getAttachmentById(id) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { data, error } = await db
            .from('inbox_attachments')
            .select('*')
            .eq('id', id)
            .single();
        if (error) {
            if (error.code === 'PGRST116') {
                throw new errorHandling_1.NotFoundError('Inbox attachment');
            }
            throw error;
        }
        return data;
    }
    catch (err) {
        throw err;
    }
}
async function getAttachmentSignedUrl(id, expiresInSeconds = 300) {
    const db = (0, database_1.supabaseAdminClient)();
    const att = await getAttachmentById(id);
    if (!att?.storage_bucket || !att?.storage_path) {
        throw new errorHandling_1.AppError('Attachment storage location missing', errorHandling_1.ErrorType.VALIDATION, 400);
    }
    const { data, error } = await db.storage
        .from(att.storage_bucket)
        .createSignedUrl(att.storage_path, expiresInSeconds);
    if (error) {
        throw new errorHandling_1.AppError(`Failed to create signed URL: ${error.message}`, errorHandling_1.ErrorType.DATABASE, 500);
    }
    return data.signedUrl;
}
async function enqueueCvParsingJobForAttachment(attachmentId, options) {
    const parsingJobs = new parsingJobsService_1.ParsingJobsService();
    let jobRowId = null;
    try {
        const attachment = await getAttachmentById(attachmentId);
        if (!options?.force && attachment?.attachment_kind !== 'cv') {
            logger.info('Skipping CV parsing enqueue for non-CV attachment', {
                attachmentId,
                attachmentKind: attachment?.attachment_kind,
                attachmentType: attachment?.attachment_type,
            });
            return { jobId: null, status: 'skipped_non_cv' };
        }
        const fileHash = attachment?.sha256 ?? null;
        const createdJobRow = await parsingJobs.createJob({ attachmentId, fileHash });
        jobRowId = createdJobRow.id;
        await queue_1.cvParsingQueue.add('parse', {
            jobId: createdJobRow.id,
            attachmentId,
            fileHash,
            force: options?.force ?? false,
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 200,
            removeOnFail: 200,
        });
        logger.info('Enqueued CV parsing job', { attachmentId, jobId: createdJobRow.id });
        return { jobId: createdJobRow.id, status: 'queued' };
    }
    catch (err) {
        if (jobRowId) {
            try {
                await parsingJobs.setStatus(jobRowId, 'failed', {
                    result_json: {
                        error: 'QUEUE_ENQUEUE_FAILED',
                        message: err instanceof Error ? err.message : String(err),
                    },
                });
            }
            catch {
                // Best-effort only; original error still thrown.
            }
        }
        throw err;
    }
}
