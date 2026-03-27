"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const errorHandling_1 = require("../utils/errorHandling");
const database_1 = require("../config/database");
// import { authenticate } from '../middleware/auth';
// Old document controllers removed - using unified candidate-documents system
const documentController_1 = require("../controllers/documentController");
const quickApproveController_1 = require("../controllers/quickApproveController");
const fixApprovedPhotosController_1 = require("../controllers/fixApprovedPhotosController");
const pdfPhotoExtractionController_1 = require("../controllers/pdfPhotoExtractionController");
const aiPhotoExtractionController_1 = require("../controllers/aiPhotoExtractionController");
const rateLimit_1 = require("../middleware/rateLimit");
const logger = (0, errorHandling_1.createLogger)('DocumentsRouter');
const router = (0, express_1.Router)();
const UNMATCHED_DOCUMENT_SELECT = [
    'id',
    'inbox_attachment_id',
    'document_type',
    'storage_bucket',
    'storage_path',
    'file_name',
    'source',
    'received_at',
    'needs_manual_review',
    'review_reasons',
    'extracted_metadata',
].join(',');
const LEGACY_UNMATCHED_DOCUMENT_SELECT = [
    'id',
    'inbox_attachment_id',
    'document_type',
    'storage_path',
    'file_name',
    'source',
].join(',');
function normalizeStorageBucket(bucket) {
    return typeof bucket === 'string' && bucket.trim() ? bucket : 'documents';
}
function normalizeReviewReasons(value) {
    if (Array.isArray(value)) {
        const reasons = value.map((item) => String(item).trim()).filter(Boolean);
        return reasons.length > 0 ? reasons : null;
    }
    return null;
}
function normalizeCandidateDocumentSource(source) {
    const normalized = String(source || '').trim().toLowerCase();
    if (normalized === 'gmail' || normalized === 'email') {
        return 'gmail';
    }
    if (normalized === 'whatsapp') {
        return 'whatsapp';
    }
    if (normalized === 'web') {
        return 'web';
    }
    return 'manual';
}
function normalizeCandidateDocumentType(documentType) {
    const normalized = String(documentType || '').trim().toLowerCase();
    const allowed = new Set(['passport', 'cnic', 'degree', 'medical', 'visa', 'certificate']);
    return allowed.has(normalized) ? normalized : 'other';
}
// Bulk processing status (reduces per-candidate polling)
// POST /api/documents/processing-status
// Body: { candidate_ids: string[] }
//
// Root cause of previous 500 errors:
// Supabase-JS sends .select().in('candidate_id', [...N ids...]) as a GET request with URL parameters.
// With 200+ candidates, the URL exceeds the HTTP server's URL size limit (~8 KB), causing PostgREST
// to return a 414/400 error which Supabase-JS puts in `error`, then `throw error` produced a 500.
//
// Correct fix: NEVER pass candidate IDs into a .in() filter on this endpoint.
// Instead, query ALL currently-pending documents system-wide (a small transient set — processed in
// seconds) and filter to the requested candidates in JavaScript.  This keeps the DB query URL tiny.
router.post('/processing-status', async (req, res) => {
    try {
        const candidateIdsRaw = (req.body?.candidate_ids || req.body?.candidateIds);
        const candidateIds = Array.isArray(candidateIdsRaw) ? candidateIdsRaw : [];
        if (candidateIds.length === 0) {
            return res.json({ statuses: {} });
        }
        // Build a Set for O(1) membership lookup when filtering query results.
        const candidateIdSet = new Set(candidateIds);
        const db = (0, database_1.supabaseAdminClient)();
        // KEY DESIGN: Do NOT include candidate_id in the DB filter.
        // Pending documents are transient (they exist for seconds to minutes while being processed).
        // Querying all pending docs across the whole system prevents the URL-length 500 that occurs
        // when 200+ candidate UUIDs are stuffed into a PostgREST GET query parameter.
        const { data, error } = await db
            .from('candidate_documents')
            .select('candidate_id')
            .eq('verification_status', 'pending_ai');
        if (error) {
            // Log full error details to Railway so we can diagnose if it ever happens again.
            logger.error('Processing-status DB query failed', {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint,
            });
            // Return empty statuses so the UI stays stable; do NOT 500 for polling.
            return res.json({ statuses: {} });
        }
        // Aggregate pending counts per candidate, filtered to only the requested candidates.
        const pendingCounts = new Map();
        for (const row of data || []) {
            const id = row.candidate_id;
            if (candidateIdSet.has(id)) {
                pendingCounts.set(id, (pendingCounts.get(id) || 0) + 1);
            }
        }
        const statuses = {};
        for (const id of candidateIds) {
            const pendingCount = pendingCounts.get(id) || 0;
            statuses[id] = {
                isProcessing: pendingCount > 0,
                pendingCount,
            };
        }
        return res.json({ statuses });
    }
    catch (err) {
        logger.error('Unexpected error in processing-status', { message: err?.message, stack: err?.stack });
        return res.json({ statuses: {} });
    }
});
// Configure multer for memory storage
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
    },
    fileFilter: (req, file, cb) => {
        // Allow common document types
        const allowedMimeTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/png',
            'image/jpg',
            'image/gif',
            'image/webp',
            'text/plain',
        ];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, PNG, GIF, WEBP, and TXT files are allowed.'));
        }
    },
});
// All routes require authentication
// router.use(authenticate);
// ============================================================================
// NEW ROUTES - AI Document Verification System
// ============================================================================
// Multer error handler middleware
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer_1.default.MulterError) {
        return next(err);
    }
    if (err) {
        return next(err);
    }
    next();
};
// Split-and-categorize upload: preserve original -> parser -> create docs (create candidate if none)
router.post('/split-upload', upload.single('file'), handleMulterError, (0, errorHandling_1.asyncHandler)(documentController_1.splitUploadController));
// Upload endpoint with extended timeout for large files
router.post('/candidate-documents', (req, res, next) => {
    req.setTimeout(300000, () => {
        if (!res.headersSent) {
            res.status(408).json({ error: 'Upload timeout. Please try again with a smaller file.' });
        }
    });
    next();
}, upload.single('file'), handleMulterError, (0, errorHandling_1.asyncHandler)(documentController_1.uploadCandidateDocumentController));
// Get candidate document by ID
router.get('/candidate-documents/:id', documentController_1.getCandidateDocumentController);
// Get signed URL for download
router.get('/candidate-documents/:id/download', documentController_1.getCandidateDocumentDownloadUrlController);
// Delete candidate document
router.delete('/candidate-documents/:id', documentController_1.deleteCandidateDocumentController);
// Reprocess document verification (re-run AI verification with updated logic)
router.post('/candidate-documents/:id/reprocess', documentController_1.reprocessCandidateDocumentController);
// Admin override document verification (requires admin role)
router.post('/candidate-documents/:id/override', documentController_1.overrideCandidateDocumentController);
// Quick approve pending document (no password required for pending_ai/needs_review)
router.post('/candidate-documents/:id/approve', quickApproveController_1.quickApproveCandidateDocument);
// Fix approved photos that are missing profile_photo_url (retroactive fix)
router.post('/fix-approved-photos', fixApprovedPhotosController_1.fixApprovedPhotos);
// List documents for a candidate (with category filtering)
router.get('/candidates/:candidateId/documents', documentController_1.listCandidateDocumentsControllerNew);
// Extract photo from PDF profile photo and save as image
router.post('/candidates/:candidateId/extract-photo', (0, errorHandling_1.asyncHandler)(pdfPhotoExtractionController_1.extractPhotoFromPdfController));
// AI-assisted: Extract profile headshot from a PDF document and save as image
router.post('/candidates/:candidateId/extract-photo-ai', rateLimit_1.aiExtractionLimiter, (0, errorHandling_1.asyncHandler)(aiPhotoExtractionController_1.extractPhotoFromPdfAiController));
// ============================================================================
// LEGACY ROUTES - REMOVED
// All old endpoints have been removed. Use /candidate-documents endpoints instead.
// ============================================================================
// 
// REMOVED ENDPOINTS (use new unified system instead):
// - POST /api/documents → Use POST /api/documents/candidate-documents
// - GET /api/documents/:id → Use GET /api/documents/candidate-documents/:id
// - GET /api/documents/candidate/:candidateId → Use GET /api/documents/candidates/:candidateId/documents
// - GET /api/documents/:id/download → Use GET /api/documents/candidate-documents/:id/download
// - DELETE /api/documents/:id → Use DELETE /api/documents/candidate-documents/:id
//
// Duplicate route removed - using listCandidateDocumentsControllerNew at line 102 instead
/**
 * GET /api/documents/unmatched
 * Returns unmatched documents pending manual linking
 */
router.get('/unmatched', async (req, res) => {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;
        const filterStatus = req.query.status; // 'pending', 'needs_review', all if not specified
        const buildBaseQuery = (includeManualReviewFilter, selectColumns) => {
            let query = db
                .from('unmatched_documents')
                .select(selectColumns, { count: 'exact' })
                .order('id', { ascending: false })
                .range(offset, offset + limit - 1);
            if (includeManualReviewFilter && filterStatus === 'needs_review') {
                query = query.eq('needs_manual_review', true);
            }
            else if (includeManualReviewFilter && filterStatus === 'pending') {
                query = query.eq('needs_manual_review', false);
            }
            return query;
        };
        let { data: documents, error, count } = await buildBaseQuery(true, UNMATCHED_DOCUMENT_SELECT);
        const errorMessage = String(error?.message || '');
        if (errorMessage.includes('relation "unmatched_documents" does not exist')) {
            logger.warn('unmatched_documents table missing in current schema; returning empty unmatched documents list');
            return res.json({ documents: [], total: 0, limit, offset });
        }
        if (error && errorMessage.includes('column unmatched_documents.')) {
            logger.warn('Legacy unmatched_documents schema detected; retrying with compatibility query', {
                message: errorMessage,
            });
            ({ data: documents, error, count } = await buildBaseQuery(false, LEGACY_UNMATCHED_DOCUMENT_SELECT));
        }
        if (error)
            throw error;
        // Generate download URLs
        const unmatchedDocuments = (documents || []);
        const docsWithUrls = await Promise.all(unmatchedDocuments.map(async (doc) => {
            const storageBucket = normalizeStorageBucket(doc.storage_bucket);
            const reviewReasons = normalizeReviewReasons(doc.review_reasons);
            try {
                const { data } = await db.storage
                    .from(storageBucket)
                    .createSignedUrl(doc.storage_path, 3600);
                return {
                    id: doc.id,
                    document_type: doc.document_type,
                    file_name: doc.file_name,
                    storage_bucket: storageBucket,
                    storage_path: doc.storage_path,
                    received_at: doc.received_at || null,
                    source: doc.source || null,
                    extracted_metadata: doc.extracted_metadata || null,
                    needs_manual_review: Boolean(doc.needs_manual_review),
                    review_reasons: reviewReasons,
                    downloadUrl: data?.signedUrl || null,
                };
            }
            catch (err) {
                logger.warn(`Failed to generate signed URL for ${storageBucket}/${doc.storage_path}`, err);
                return {
                    id: doc.id,
                    document_type: doc.document_type,
                    file_name: doc.file_name,
                    storage_bucket: storageBucket,
                    storage_path: doc.storage_path,
                    received_at: doc.received_at || null,
                    source: doc.source || null,
                    extracted_metadata: doc.extracted_metadata || null,
                    needs_manual_review: Boolean(doc.needs_manual_review),
                    review_reasons: reviewReasons,
                    downloadUrl: null,
                };
            }
        }));
        res.json({
            documents: docsWithUrls,
            total: count || 0,
            limit,
            offset,
        });
    }
    catch (err) {
        logger.error('Failed to fetch unmatched documents', err);
        res.status(500).json({ error: 'Failed to fetch unmatched documents' });
    }
});
/**
 * POST /api/documents/unmatched/:documentId/link
 * Manually link an unmatched document to a candidate
 */
router.post('/unmatched/:documentId/link', async (req, res) => {
    try {
        const { documentId } = req.params;
        const { candidateId } = req.body;
        if (!candidateId) {
            return res.status(400).json({ error: 'candidateId is required' });
        }
        const db = (0, database_1.supabaseAdminClient)();
        // Get the unmatched document
        const { data: doc, error: docError } = await db
            .from('unmatched_documents')
            .select('*')
            .eq('id', documentId)
            .single();
        if (docError || !doc) {
            return res.status(404).json({ error: 'Document not found' });
        }
        // Verify candidate exists
        const { data: candidate, error: candidateError } = await db
            .from('candidates')
            .select('id')
            .eq('id', candidateId)
            .single();
        if (candidateError || !candidate) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        // Move document to candidate folder
        const storageBucket = normalizeStorageBucket(doc.storage_bucket);
        const normalizedDocumentType = normalizeCandidateDocumentType(doc.document_type);
        const normalizedSource = normalizeCandidateDocumentSource(doc.source);
        const newPath = `candidates/${candidateId}/documents/${normalizedDocumentType}/${doc.file_name}`;
        // Prefer Storage-side move to avoid backend download -> re-upload egress.
        // If move fails, keep original storage_path to avoid broken links.
        let resolvedStoragePath = doc.storage_path;
        try {
            const bucket = db.storage.from(storageBucket);
            if (typeof bucket.move === 'function') {
                const { error: moveError } = await bucket.move(doc.storage_path, newPath);
                if (moveError)
                    throw moveError;
                resolvedStoragePath = newPath;
            }
            else {
                logger.warn('Supabase Storage move() not available; keeping original storage_path to avoid egress');
            }
        }
        catch (moveErr) {
            logger.warn(`Could not move file, keeping original storage_path`, moveErr);
        }
        // Create candidate_documents entry
        const { error: linkError } = await db
            .from('candidate_documents')
            .insert({
            candidate_id: candidateId,
            document_type: normalizedDocumentType,
            storage_bucket: storageBucket,
            file_name: doc.file_name,
            storage_path: resolvedStoragePath,
            source: normalizedSource,
            ...(doc.received_at ? { received_at: doc.received_at } : {}),
        });
        if (linkError)
            throw linkError;
        // Delete from unmatched
        const { error: deleteError } = await db
            .from('unmatched_documents')
            .delete()
            .eq('id', documentId);
        if (deleteError)
            throw deleteError;
        res.json({ success: true, message: 'Document linked to candidate' });
    }
    catch (err) {
        logger.error('Failed to link document', err);
        res.status(500).json({ error: 'Failed to link document' });
    }
});
/**
 * GET /api/documents/checklist/:candidateId
 * Returns document checklist status for a candidate
 */
router.get('/checklist/:candidateId', async (req, res) => {
    try {
        const { candidateId } = req.params;
        const db = (0, database_1.supabaseAdminClient)();
        const { data: candidate, error } = await db
            .from('candidates')
            .select(`
        id,
        passport_received,
        passport_received_at,
        cnic_received,
        cnic_received_at,
        degree_received,
        degree_received_at,
        medical_received,
        medical_received_at,
        visa_received,
        visa_received_at
      `)
            .eq('id', candidateId)
            .single();
        if (error) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        res.json({
            checklist: {
                passport: {
                    received: candidate?.passport_received || false,
                    receivedAt: candidate?.passport_received_at,
                },
                cnic: {
                    received: candidate?.cnic_received || false,
                    receivedAt: candidate?.cnic_received_at,
                },
                degree: {
                    received: candidate?.degree_received || false,
                    receivedAt: candidate?.degree_received_at,
                },
                medical: {
                    received: candidate?.medical_received || false,
                    receivedAt: candidate?.medical_received_at,
                },
                visa: {
                    received: candidate?.visa_received || false,
                    receivedAt: candidate?.visa_received_at,
                },
            },
        });
    }
    catch (err) {
        logger.error('Failed to fetch document checklist', err);
        res.status(500).json({ error: 'Failed to fetch checklist' });
    }
});
exports.default = router;
