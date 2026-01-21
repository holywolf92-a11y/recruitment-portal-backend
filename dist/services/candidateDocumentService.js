"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadCandidateDocument = uploadCandidateDocument;
exports.getCandidateDocumentById = getCandidateDocumentById;
exports.listCandidateDocumentsByCandidate = listCandidateDocumentsByCandidate;
exports.getCandidateDocumentSignedUrl = getCandidateDocumentSignedUrl;
exports.deleteCandidateDocument = deleteCandidateDocument;
exports.updateDocumentVerification = updateDocumentVerification;
const database_1 = require("../config/database");
const crypto_1 = __importDefault(require("crypto"));
const documentCategories_1 = require("../config/documentCategories");
const documentVerificationLogService_1 = require("./documentVerificationLogService");
const queue_1 = require("../config/queue");
const errorHandling_1 = require("../utils/errorHandling");
const STORAGE_BUCKET = 'documents';
/**
 * Calculate SHA256 hash of file buffer
 */
function calculateSHA256(buffer) {
    return crypto_1.default.createHash('sha256').update(buffer).digest('hex');
}
/**
 * Generate storage path for candidate document
 */
function generateStoragePath(candidateId, fileName) {
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `candidates/${candidateId}/documents/${timestamp}_${sanitizedFileName}`;
}
/**
 * Upload document with AI verification workflow
 * - Stores file in private bucket
 * - Creates candidate_documents record with status = PENDING_AI
 * - Enqueues AI processing job
 * - Logs upload event to verification logs
 */
async function uploadCandidateDocument(data) {
    const db = (0, database_1.supabaseAdminClient)();
    const logService = new documentVerificationLogService_1.DocumentVerificationLogService();
    const requestId = (0, documentVerificationLogService_1.generateRequestId)();
    try {
        // File validation
        const allowedTypes = [
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/jpg',
            'text/plain',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (!data.file_name || !data.mime_type || !data.buffer) {
            const errMsg = 'Missing file_name, mime_type, or buffer';
            await logService.logError(requestId, errMsg, undefined, undefined, data.candidate_id);
            throw new errorHandling_1.AppError(errMsg, errorHandling_1.ErrorType.VALIDATION, 400);
        }
        if (data.buffer.length === 0) {
            const errMsg = 'File is empty';
            await logService.logError(requestId, errMsg, undefined, undefined, data.candidate_id);
            throw new errorHandling_1.AppError(errMsg, errorHandling_1.ErrorType.VALIDATION, 400);
        }
        if (data.buffer.length > maxSize) {
            const errMsg = 'File exceeds 10MB size limit';
            await logService.logError(requestId, errMsg, undefined, undefined, data.candidate_id);
            throw new errorHandling_1.AppError(errMsg, errorHandling_1.ErrorType.VALIDATION, 400);
        }
        if (!allowedTypes.includes(data.mime_type)) {
            const errMsg = `Unsupported file type: ${data.mime_type}`;
            await logService.logError(requestId, errMsg, undefined, undefined, data.candidate_id);
            throw new errorHandling_1.AppError(errMsg, errorHandling_1.ErrorType.VALIDATION, 400);
        }
        // Validate candidate_id format first (before any logging)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(data.candidate_id) || data.candidate_id === '00000000-0000-0000-0000-000000000000') {
            const errMsg = 'Invalid candidate_id format';
            throw new errorHandling_1.AppError(errMsg, errorHandling_1.ErrorType.VALIDATION, 400);
        }
        // Verify candidate exists BEFORE logging (to avoid foreign key violations)
        const { data: candidate, error: candidateError } = await db
            .from('candidates')
            .select('id')
            .eq('id', data.candidate_id)
            .single();
        if (candidateError || !candidate) {
            const errMsg = `Candidate not found: ${data.candidate_id}`;
            throw new errorHandling_1.AppError(errMsg, errorHandling_1.ErrorType.VALIDATION, 404);
        }
        // Generate unique request ID for tracing
        console.log(`[UploadDocument] Starting upload for candidate ${data.candidate_id}, request_id: ${requestId}`);
        // Log upload started (now safe because candidate exists)
        await logService.logUploadStarted(requestId, data.candidate_id, data.file_name, data.mime_type, data.buffer.length, data.uploaded_by_user_id);
        // Generate storage path
        const storagePath = generateStoragePath(data.candidate_id, data.file_name);
        // Upload to Supabase Storage (private bucket)
        const { error: uploadError } = await db.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, data.buffer, {
            contentType: data.mime_type,
            upsert: false,
        });
        if (uploadError) {
            await logService.logError(requestId, `Failed to upload file: ${uploadError.message}`, undefined, undefined, data.candidate_id);
            throw new Error(`Failed to upload file: ${uploadError.message}`);
        }
        console.log(`[UploadDocument] File uploaded to storage: ${storagePath}`);
        // Create candidate_documents record with status = PENDING_AI
        const documentData = {
            candidate_id: data.candidate_id,
            // Provide a safe default to satisfy NOT NULL constraint
            document_type: 'other',
            storage_bucket: STORAGE_BUCKET,
            storage_path: storagePath,
            file_name: data.file_name,
            mime_type: data.mime_type,
            source: data.source || 'manual', // Use 'manual' as safe default (constraint allows it)
            status: 'received', // Legacy field
            verification_status: documentCategories_1.VERIFICATION_STATUS.PENDING_AI, // New AI workflow status
            received_at: new Date().toISOString(),
        };
        const { data: document, error: dbError } = await db
            .from('candidate_documents')
            .insert(documentData)
            .select()
            .single();
        if (dbError) {
            // Rollback: delete uploaded file
            await db.storage.from(STORAGE_BUCKET).remove([storagePath]);
            await logService.logError(requestId, `Failed to create document record: ${dbError.message}`, undefined, undefined, data.candidate_id);
            throw new Error(`Failed to create document record: ${dbError.message}`);
        }
        console.log(`[UploadDocument] Document record created: ${document.id}`);
        // Log upload completed
        await logService.logUploadCompleted(requestId, document.id, data.candidate_id, STORAGE_BUCKET, storagePath);
        // Enqueue AI processing job
        try {
            const jobData = {
                requestId,
                documentId: document.id,
                candidateId: data.candidate_id,
                storageBucket: STORAGE_BUCKET,
                storagePath,
                fileName: data.file_name,
                mimeType: data.mime_type,
            };
            await queue_1.documentVerificationQueue.add('verify-document', jobData, {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 2000,
                },
            });
            console.log(`[UploadDocument] Enqueued AI verification job for document ${document.id}`);
        }
        catch (queueError) {
            console.error('[UploadDocument] Failed to enqueue AI job:', queueError);
            // Don't fail the upload, but log the error
            await logService.logError(requestId, `Failed to enqueue AI job: ${queueError.message}`, queueError.stack, document.id, data.candidate_id);
        }
        return {
            document: document,
            request_id: requestId,
        };
    }
    catch (error) {
        console.error('[UploadDocument] Upload failed:', error);
        // Log error if not already logged
        try {
            await logService.logError(requestId, error.message || 'Upload failed', error.stack, undefined, data.candidate_id);
        }
        catch (logError) {
            console.error('[UploadDocument] Failed to log error:', logError);
        }
        throw error;
    }
}
/**
 * Get candidate document by ID
 */
async function getCandidateDocumentById(documentId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('candidate_documents')
        .select('*')
        .eq('id', documentId)
        .single();
    if (error) {
        if (error.code === 'PGRST116') {
            return null;
        }
        throw new Error(`Failed to fetch document: ${error.message}`);
    }
    return data;
}
/**
 * List all documents for a candidate
 */
async function listCandidateDocumentsByCandidate(candidateId, category) {
    const db = (0, database_1.supabaseAdminClient)();
    let query = db
        .from('candidate_documents')
        .select('*')
        .eq('candidate_id', candidateId)
        .order('created_at', { ascending: false });
    if (category) {
        query = query.eq('category', category);
    }
    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to list documents: ${error.message}`);
    }
    return (data || []);
}
/**
 * Get document signed URL for download
 */
async function getCandidateDocumentSignedUrl(documentId, expiresIn = 3600) {
    const db = (0, database_1.supabaseAdminClient)();
    const document = await getCandidateDocumentById(documentId);
    if (!document) {
        throw new Error('Document not found');
    }
    const { data, error } = await db.storage
        .from(document.storage_bucket)
        .createSignedUrl(document.storage_path, expiresIn);
    if (error || !data) {
        throw new Error(`Failed to generate signed URL: ${error?.message}`);
    }
    return data.signedUrl;
}
/**
 * Delete candidate document
 */
async function deleteCandidateDocument(documentId) {
    const db = (0, database_1.supabaseAdminClient)();
    const document = await getCandidateDocumentById(documentId);
    if (!document) {
        throw new Error('Document not found');
    }
    // Delete from storage
    const { error: storageError } = await db.storage
        .from(document.storage_bucket)
        .remove([document.storage_path]);
    if (storageError) {
        console.error('Failed to delete file from storage:', storageError);
        // Continue with database deletion even if storage deletion fails
    }
    // Delete from database
    const { error: dbError } = await db
        .from('candidate_documents')
        .delete()
        .eq('id', documentId);
    if (dbError) {
        throw new Error(`Failed to delete document: ${dbError.message}`);
    }
}
/**
 * Update document verification status and category
 */
async function updateDocumentVerification(documentId, updates) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('candidate_documents')
        .update({
        ...updates,
        updated_at: new Date().toISOString(),
    })
        .eq('id', documentId)
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to update document: ${error.message}`);
    }
    return data;
}
