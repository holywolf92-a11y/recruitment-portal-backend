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
// Bulk processing status (reduces per-candidate polling)
// POST /api/documents/processing-status
// Body: { candidate_ids: string[] }
router.post('/processing-status', async (req, res) => {
    try {
        const candidateIds = (req.body?.candidate_ids || req.body?.candidateIds);
        if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
            return res.status(400).json({ error: 'candidate_ids array is required and must not be empty' });
        }
        if (candidateIds.length > 500) {
            return res.status(400).json({ error: 'Maximum 500 candidates allowed per request' });
        }
        const db = (0, database_1.supabaseAdminClient)();
        // Only fetch minimal columns; aggregate on server.
        const { data, error } = await db
            .from('candidate_documents')
            .select('candidate_id, verification_status')
            .in('candidate_id', candidateIds)
            .in('verification_status', ['pending_ai', 'pending']);
        if (error)
            throw error;
        const pendingCounts = new Map();
        for (const row of data || []) {
            const id = row.candidate_id;
            pendingCounts.set(id, (pendingCounts.get(id) || 0) + 1);
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
        logger.error('Failed to fetch processing status', err);
        return res.status(500).json({ error: 'Failed to fetch processing status' });
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
        let query = db
            .from('unmatched_documents')
            .select(`
        id,
        document_type,
        file_name,
        storage_path,
        received_at,
        source,
        extracted_metadata,
        needs_manual_review,
        review_reasons
      `, { count: 'exact' })
            .order('received_at', { ascending: false })
            .range(offset, offset + limit - 1);
        if (filterStatus === 'needs_review') {
            query = query.eq('needs_manual_review', true);
        }
        else if (filterStatus === 'pending') {
            query = query.eq('needs_manual_review', false);
        }
        const { data: documents, error, count } = await query;
        if (error)
            throw error;
        // Generate download URLs
        const docsWithUrls = await Promise.all((documents || []).map(async (doc) => {
            try {
                const { data } = await db.storage
                    .from('documents')
                    .createSignedUrl(doc.storage_path, 3600);
                return {
                    ...doc,
                    downloadUrl: data?.signedUrl || null,
                };
            }
            catch (err) {
                logger.warn(`Failed to generate signed URL for ${doc.storage_path}`, err);
                return { ...doc, downloadUrl: null };
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
        const newPath = `candidates/${candidateId}/documents/${doc.document_type}/${doc.file_name}`;
        // Prefer Storage-side move to avoid backend download -> re-upload egress.
        // If move fails, keep original storage_path to avoid broken links.
        let resolvedStoragePath = doc.storage_path;
        try {
            const bucket = db.storage.from('documents');
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
            document_type: doc.document_type,
            file_name: doc.file_name,
            storage_path: resolvedStoragePath,
            source: doc.source,
            received_at: doc.received_at,
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
