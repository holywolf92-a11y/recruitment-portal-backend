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
const documentController_1 = require("../controllers/documentController");
const documentController_2 = require("../controllers/documentController");
const logger = (0, errorHandling_1.createLogger)('DocumentsRouter');
const router = (0, express_1.Router)();
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
            'text/plain',
        ];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, PNG, and TXT files are allowed.'));
        }
    },
});
// All routes require authentication
// router.use(authenticate);
// ============================================================================
// NEW ROUTES - AI Document Verification System
// ============================================================================
// Upload document with AI verification
const errorHandling_2 = require("../utils/errorHandling");
// Multer error handler middleware
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer_1.default.MulterError) {
        return next(err); // Pass to global error handler
    }
    if (err) {
        return next(err); // Pass other errors (like fileFilter errors)
    }
    next();
};
// Upload endpoint with extended timeout for large files
router.post('/candidate-documents', (req, res, next) => {
    // Set timeout to 5 minutes for this specific route
    req.setTimeout(300000, () => {
        if (!res.headersSent) {
            res.status(408).json({ error: 'Upload timeout. Please try again with a smaller file.' });
        }
    });
    next();
}, upload.single('file'), handleMulterError, (0, errorHandling_2.asyncHandler)(documentController_2.uploadCandidateDocumentController));
// Get candidate document by ID
router.get('/candidate-documents/:id', documentController_2.getCandidateDocumentController);
// Get signed URL for download
router.get('/candidate-documents/:id/download', documentController_2.getCandidateDocumentDownloadUrlController);
// Delete candidate document
router.delete('/candidate-documents/:id', documentController_2.deleteCandidateDocumentController);
// Reprocess document verification (re-run AI verification with updated logic)
router.post('/candidate-documents/:id/reprocess', documentController_2.reprocessCandidateDocumentController);
// List documents for a candidate (with category filtering)
router.get('/candidates/:candidateId/documents', documentController_2.listCandidateDocumentsControllerNew);
// ============================================================================
// LEGACY ROUTES - Old documents table (kept for backward compatibility)
// ============================================================================
// Upload document
router.post('/', upload.single('file'), documentController_1.uploadDocumentController);
// Get document metadata
router.get('/:id', documentController_1.getDocumentController);
// List all documents for a candidate
router.get('/candidate/:candidateId', documentController_1.listCandidateDocumentsController);
// Get signed URL for document download
router.get('/:id/download', documentController_1.getDocumentSignedUrlController);
// Delete document
router.delete('/:id', documentController_1.deleteDocumentController);
/**
 * GET /api/documents/candidates/:candidateId/documents
 * Returns all documents linked to a candidate with download URLs
 */
router.get('/candidates/:candidateId/documents', async (req, res) => {
    try {
        const { candidateId } = req.params;
        const db = (0, database_1.supabaseAdminClient)();
        // Get all documents for this candidate
        const { data: documents, error } = await db
            .from('candidate_documents')
            .select(`
        id,
        document_type,
        file_name,
        storage_path,
        received_at,
        source
      `)
            .eq('candidate_id', candidateId)
            .order('received_at', { ascending: false });
        if (error)
            throw error;
        // Generate download URLs for each document
        const docsWithUrls = await Promise.all((documents || []).map(async (doc) => {
            try {
                const { data } = await db.storage
                    .from('documents')
                    .createSignedUrl(doc.storage_path, 3600); // 1 hour expiry
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
        res.json({ documents: docsWithUrls });
    }
    catch (err) {
        logger.error('Failed to fetch candidate documents', err);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});
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
        try {
            // Copy file to new location
            const { data: fileData } = await db.storage
                .from('documents')
                .download(doc.storage_path);
            if (fileData) {
                await db.storage
                    .from('documents')
                    .upload(newPath, fileData, { upsert: false });
            }
        }
        catch (moveErr) {
            logger.warn(`Could not move file, continuing with reference update`, moveErr);
        }
        // Create candidate_documents entry
        const { error: linkError } = await db
            .from('candidate_documents')
            .insert({
            candidate_id: candidateId,
            document_type: doc.document_type,
            file_name: doc.file_name,
            storage_path: newPath,
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
