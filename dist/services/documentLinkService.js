"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentLinkService = void 0;
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const documentClassifier_1 = require("./documentClassifier");
const candidateMatcher_1 = require("./candidateMatcher");
const crypto_1 = __importDefault(require("crypto"));
const queue_1 = require("../config/queue");
const logger = (0, errorHandling_1.createLogger)('DocumentLinkService');
const CONSTRAINED_DOCUMENT_SOURCES = new Set([
    'gmail',
    'email',
    'whatsapp',
    'web',
    'api',
    'unknown',
    'manual',
]);
function normalizeDocumentRecordSource(source) {
    const normalized = (source || 'unknown').toLowerCase();
    if (normalized === 'google_drive') {
        return 'web';
    }
    return CONSTRAINED_DOCUMENT_SOURCES.has(normalized) ? normalized : 'unknown';
}
/**
 * Service for linking supporting documents to candidates
 */
class DocumentLinkService {
    /**
     * Process a supporting document attachment
     */
    async processDocument(input) {
        const db = (0, database_1.supabaseAdminClient)();
        // Get attachment details
        const { data: attachment, error: attachError } = await db
            .from('inbox_attachments')
            .select('*')
            .eq('id', input.attachmentId)
            .single();
        if (attachError || !attachment) {
            throw new errorHandling_1.AppError('Attachment not found', errorHandling_1.ErrorType.NOT_FOUND, 404);
        }
        logger.info(`Processing document: ${attachment.file_name}`, { attachmentId: input.attachmentId });
        // If the attachment already has a known candidate (e.g. WhatsApp conversation-bound), link deterministically.
        if (attachment.candidate_id) {
            await this.linkDocumentToCandidate(attachment, attachment.candidate_id);
            logger.info(`Document linked using attachment.candidate_id`, { attachmentId: input.attachmentId, candidateId: attachment.candidate_id });
            return;
        }
        // Try to match candidate
        const matchResult = await candidateMatcher_1.CandidateMatcher.findCandidate({
            cnic: input.extractedCnic,
            email: input.extractedEmail,
            phone: input.extractedPhone,
            name: input.extractedName,
            fatherName: input.extractedFatherName
        });
        if (matchResult.needsManualReview || matchResult.multipleMatches) {
            // Multiple matches or needs review - store as unmatched
            await this.createUnmatchedDocument(attachment, input, matchResult.reviewReasons || []);
            logger.warn(`Document needs manual review: ${attachment.file_name}`, matchResult);
            return;
        }
        if (matchResult.candidateId) {
            // Single clear match - link to candidate
            await this.linkDocumentToCandidate(attachment, matchResult.candidateId);
            logger.info(`Document linked to candidate: ${matchResult.candidateId}`, {
                matchedBy: matchResult.matchedBy,
                confidence: matchResult.confidence
            });
        }
        else {
            // No match yet - store as unmatched for later reconciliation
            await this.createUnmatchedDocument(attachment, input, ['No matching candidate found']);
            logger.info(`Document stored as unmatched: ${attachment.file_name}`);
        }
    }
    /**
     * Link document to candidate
     */
    async linkDocumentToCandidate(attachment, candidateId) {
        const db = (0, database_1.supabaseAdminClient)();
        // Idempotency: if already linked once, do nothing.
        const { data: existingDoc } = await db
            .from('candidate_documents')
            .select('id')
            .eq('inbox_attachment_id', attachment.id)
            .limit(1);
        if (Array.isArray(existingDoc) && existingDoc.length > 0) {
            logger.info('Attachment already linked to candidate_documents (idempotent skip)', {
                attachmentId: attachment.id,
                candidateId,
                documentId: existingDoc[0]?.id,
            });
            return;
        }
        // Get inbox message for source info
        const { data: message } = await db
            .from('inbox_messages')
            .select('source')
            .eq('id', attachment.inbox_message_id)
            .single();
        const source = message?.source || 'unknown';
        const documentSource = normalizeDocumentRecordSource(source);
        const rawDocType = (attachment.document_type || '').toString().toLowerCase();
        const documentType = (rawDocType && rawDocType !== 'unknown' ? rawDocType : 'other');
        // Generate new storage path
        const newStoragePath = documentClassifier_1.DocumentClassifier.generateStoragePath(candidateId, documentType, attachment.file_name);
        // Move file in storage (copy; preserve original raw upload for audit)
        await this.moveFileInStorage(attachment.storage_bucket, attachment.storage_path, newStoragePath);
        // Create candidate_documents record
        const { data: createdDoc, error: docError } = await db
            .from('candidate_documents')
            .insert({
            candidate_id: candidateId,
            inbox_attachment_id: attachment.id,
            document_type: documentType,
            storage_bucket: attachment.storage_bucket,
            storage_path: newStoragePath,
            file_name: attachment.file_name,
            mime_type: attachment.mime_type,
            source: documentSource,
            received_at: attachment.received_at || new Date().toISOString()
        })
            .select('id,candidate_id,storage_bucket,storage_path,file_name,mime_type')
            .single();
        if (docError) {
            logger.error('Failed to create candidate_documents record', docError);
            throw new errorHandling_1.AppError('Failed to link document', errorHandling_1.ErrorType.DATABASE, 500);
        }
        // Update inbox_attachments with link
        await db
            .from('inbox_attachments')
            .update({
            linked_candidate_id: candidateId
        })
            .eq('id', attachment.id);
        // Enqueue AI verification for the linked document
        try {
            if (createdDoc?.id) {
                const requestId = crypto_1.default.randomUUID();
                await queue_1.documentVerificationQueue.add('verify', {
                    requestId,
                    documentId: createdDoc.id,
                    candidateId: createdDoc.candidate_id,
                    storageBucket: createdDoc.storage_bucket,
                    storagePath: createdDoc.storage_path,
                    fileName: createdDoc.file_name,
                    mimeType: createdDoc.mime_type,
                }, {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 2000 },
                    removeOnComplete: 200,
                    removeOnFail: 200,
                });
                logger.info('Enqueued document verification job', { documentId: createdDoc.id, candidateId: createdDoc.candidate_id });
            }
        }
        catch (enqueueErr) {
            logger.error('Failed to enqueue document verification (non-fatal)', {
                attachmentId: attachment.id,
                candidateId,
                error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
            });
        }
        logger.info(`Document linked successfully: ${attachment.id} → candidate ${candidateId}`);
    }
    /**
     * Store as unmatched document
     */
    async createUnmatchedDocument(attachment, input, reasons) {
        const db = (0, database_1.supabaseAdminClient)();
        // Get inbox message for source
        const { data: message } = await db
            .from('inbox_messages')
            .select('source, external_message_id')
            .eq('id', attachment.inbox_message_id)
            .single();
        const source = message?.source || 'unknown';
        const documentSource = normalizeDocumentRecordSource(source);
        const messageId = message?.external_message_id || attachment.inbox_message_id;
        // Generate unmatched storage path
        const unmatchedPath = documentClassifier_1.DocumentClassifier.generateUnmatchedPath(source, messageId, attachment.file_name);
        // Move file to unmatched area (only if not already there)
        // Files uploaded via web already go to unmatched_documents, so avoid unnecessary move
        const isAlreadyInUnmatchedLocation = attachment.storage_path.startsWith('unmatched_documents/');
        if (!isAlreadyInUnmatchedLocation) {
            await this.moveFileInStorage(attachment.storage_bucket, attachment.storage_path, unmatchedPath);
        }
        else {
            logger.info(`File already in unmatched location, skipping move: ${attachment.storage_path}`);
        }
        // Create unmatched_documents record (use actual storage path)
        const finalPath = isAlreadyInUnmatchedLocation ? attachment.storage_path : unmatchedPath;
        const { error } = await db
            .from('unmatched_documents')
            .insert({
            inbox_attachment_id: attachment.id,
            document_type: attachment.document_type || 'unknown',
            storage_bucket: attachment.storage_bucket,
            storage_path: finalPath,
            file_name: attachment.file_name,
            source: documentSource,
            extracted_email: input.extractedEmail,
            extracted_phone: input.extractedPhone,
            extracted_name: input.extractedName,
            extracted_father_name: input.extractedFatherName,
            extracted_cnic: input.extractedCnic,
            needs_manual_review: reasons.length > 0,
            review_reasons: reasons.length > 0 ? reasons : null,
            status: 'pending_link'
        });
        if (error) {
            logger.error('Failed to create unmatched_documents record', error);
            throw new errorHandling_1.AppError('Failed to store unmatched document', errorHandling_1.ErrorType.DATABASE, 500);
        }
        // Update inbox_attachments storage path (use current path if already in unmatched location)
        await db
            .from('inbox_attachments')
            .update({ storage_path: finalPath })
            .eq('id', attachment.id);
    }
    /**
     * Move file in Supabase Storage
     */
    async moveFileInStorage(bucket, oldPath, newPath) {
        const db = (0, database_1.supabaseAdminClient)();
        // Copy file to new location
        const { error: copyError } = await db.storage
            .from(bucket)
            .copy(oldPath, newPath);
        if (copyError) {
            logger.error('Failed to copy file in storage', copyError);
            throw new errorHandling_1.AppError('Failed to move file', errorHandling_1.ErrorType.DATABASE, 500);
        }
        // Preserve original uploads for auditability (do not delete the old path).
        logger.info(`File copied (original preserved): ${oldPath} → ${newPath}`);
    }
    /**
     * Reconcile unmatched documents for a newly created candidate
     */
    async reconcileDocumentsForCandidate(candidateId) {
        const db = (0, database_1.supabaseAdminClient)();
        // Get candidate details
        const { data: candidate, error: candError } = await db
            .from('candidates')
            .select('id')
            .eq('id', candidateId)
            .single();
        if (candError || !candidate) {
            logger.error('Candidate not found for reconciliation', candError, { candidateId });
            return 0;
        }
        // Get pending unmatched documents
        const { data: unmatchedDocs, error: unmatchedError } = await db
            .from('unmatched_documents')
            .select('*')
            .eq('status', 'pending_link')
            .eq('needs_manual_review', false);
        if (unmatchedError) {
            logger.warn('Unable to load unmatched documents for reconciliation', {
                candidateId,
                error: unmatchedError?.message,
            });
            return 0;
        }
        if (!unmatchedDocs || unmatchedDocs.length === 0) {
            return 0;
        }
        let linkedCount = 0;
        for (const doc of unmatchedDocs) {
            // Try to match this document to our new candidate
            const matchResult = await candidateMatcher_1.CandidateMatcher.findCandidate({
                cnic: doc.extracted_cnic || undefined,
                email: doc.extracted_email || undefined,
                phone: doc.extracted_phone || undefined,
                name: doc.extracted_name || undefined,
                fatherName: doc.extracted_father_name || undefined
            });
            if (matchResult.candidateId === candidateId && !matchResult.needsManualReview) {
                // This document matches our candidate!
                const { data: attachment } = await db
                    .from('inbox_attachments')
                    .select('*')
                    .eq('id', doc.inbox_attachment_id)
                    .single();
                if (attachment) {
                    await this.linkDocumentToCandidate(attachment, candidateId);
                    // Update unmatched_documents status
                    await db
                        .from('unmatched_documents')
                        .update({
                        status: 'linked',
                        linked_candidate_id: candidateId,
                        linked_at: new Date().toISOString()
                    })
                        .eq('id', doc.id);
                    linkedCount++;
                }
            }
        }
        logger.info(`Reconciled ${linkedCount} documents for candidate ${candidateId}`);
        return linkedCount;
    }
}
exports.DocumentLinkService = DocumentLinkService;
