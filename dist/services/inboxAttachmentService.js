"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAttachment = createAttachment;
exports.listAttachmentsForMessage = listAttachmentsForMessage;
exports.deleteAttachment = deleteAttachment;
exports.getAttachmentById = getAttachmentById;
exports.getAttachmentSignedUrl = getAttachmentSignedUrl;
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const hashing_1 = require("../utils/hashing");
const inboxMemory_1 = require("./inboxMemory");
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
    try {
        const db = (0, database_1.supabaseAdminClient)();
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
            storage_path: input.storagePath,
            file_name: input.fileName,
            mime_type: input.mimeType ?? null,
            sha256,
            attachment_type: input.attachmentType ?? 'cv',
        })
            .select()
            .single();
        if (error) {
            const msg = String(error.message || '');
            const code = error.code || '';
            // Robust duplicate detection for Postgres unique violations
            if (code === '23505' || /duplicate key|unique constraint|already exists/i.test(msg)) {
                throw new errorHandling_1.AppError('Duplicate attachment (sha256 + type)', errorHandling_1.ErrorType.DUPLICATE, 409);
            }
            throw error;
        }
        return data;
    }
    catch (err) {
        // If we already classified as duplicate, surface it without falling back
        if (err instanceof errorHandling_1.AppError && err.type === errorHandling_1.ErrorType.DUPLICATE) {
            throw err;
        }
        // Try robust duplicate detection on raw error blob
        const raw = JSON.stringify(err || {});
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
        throw new errorHandling_1.AppError('Failed to create attachment (database error)', errorHandling_1.ErrorType.DATABASE, 500);
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
