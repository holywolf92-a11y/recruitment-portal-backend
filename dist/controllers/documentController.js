"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadCandidateDocumentController = uploadCandidateDocumentController;
exports.getCandidateDocumentController = getCandidateDocumentController;
exports.listCandidateDocumentsControllerNew = listCandidateDocumentsControllerNew;
exports.getCandidateDocumentDownloadUrlController = getCandidateDocumentDownloadUrlController;
exports.deleteCandidateDocumentController = deleteCandidateDocumentController;
exports.reprocessCandidateDocumentController = reprocessCandidateDocumentController;
// Old documentService imports removed - using candidateDocumentService instead
const candidateDocumentService_1 = require("../services/candidateDocumentService");
const candidateController_1 = require("./candidateController");
const documentCategories_1 = require("../config/documentCategories");
/**
 * Upload document with AI verification workflow (NEW)
 * POST /api/candidate-documents
 */
async function uploadCandidateDocumentController(req, res) {
    const userId = req.user?.id || 'system'; // Get from auth middleware if available
    if (!req.file) {
        // Let this error propagate to global error handler
        throw new Error('No file uploaded');
    }
    const { candidate_id, source } = req.body;
    // Validate candidate_id is provided
    if (!candidate_id) {
        throw new Error('candidate_id is required');
    }
    // Validate candidate_id is a valid UUID format (not null UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(candidate_id)) {
        throw new Error('candidate_id must be a valid UUID');
    }
    // Reject null UUID
    if (candidate_id === '00000000-0000-0000-0000-000000000000') {
        throw new Error('candidate_id cannot be null UUID');
    }
    const uploadData = {
        candidate_id,
        file_name: req.file.originalname,
        mime_type: req.file.mimetype,
        buffer: req.file.buffer,
        source: source || 'web',
        uploaded_by_user_id: userId,
    };
    const { document, request_id } = await (0, candidateDocumentService_1.uploadCandidateDocument)(uploadData);
    // Update candidate document flags after upload
    // This ensures flags (cv_received, passport_received, etc.) are set correctly
    try {
        const mockReq = { params: { id: candidate_id }, body: {} };
        const mockRes = {
            status: (code) => ({
                json: (data) => {
                    if (code >= 400) {
                        console.error(`[uploadCandidateDocumentController] Flag update failed (${code}):`, data);
                    }
                    else {
                        console.log(`[uploadCandidateDocumentController] Flags updated successfully for candidate ${candidate_id}`);
                    }
                }
            }),
            json: (data) => console.log(`[uploadCandidateDocumentController] Flag update response:`, data)
        };
        await (0, candidateController_1.updateDocumentFlagsController)(mockReq, mockRes);
    }
    catch (flagError) {
        // Log but don't fail the upload if flag update fails
        console.error('[uploadCandidateDocumentController] Failed to update document flags after upload:', flagError);
    }
    res.status(201).json({
        success: true,
        document: {
            id: document.id,
            candidate_id: document.candidate_id,
            file_name: document.file_name,
            mime_type: document.mime_type,
            verification_status: document.verification_status,
            category: document.category,
            created_at: document.created_at,
        },
        request_id,
        message: 'Document uploaded successfully. AI verification in progress.',
    });
}
/**
 * Get candidate document by ID (NEW)
 * GET /api/candidate-documents/:id
 */
async function getCandidateDocumentController(req, res) {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Document ID is required' });
        }
        const document = await (0, candidateDocumentService_1.getCandidateDocumentById)(id);
        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }
        res.json({ document });
    }
    catch (error) {
        console.error('Error fetching candidate document:', error);
        res.status(500).json({ error: 'Failed to fetch document' });
    }
}
/**
 * List documents for a candidate (NEW)
 * GET /api/candidates/:candidateId/documents
 */
async function listCandidateDocumentsControllerNew(req, res) {
    try {
        const { candidateId } = req.params;
        const { category } = req.query;
        if (!candidateId) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const documents = await (0, candidateDocumentService_1.listCandidateDocumentsByCandidate)(candidateId, category);
        // Group by category for frontend
        const groupedByCategory = documents.reduce((acc, doc) => {
            const cat = doc.category || 'other_documents';
            if (!acc[cat]) {
                acc[cat] = {
                    category: cat,
                    display_name: documentCategories_1.DOCUMENT_CATEGORY_DISPLAY_NAMES[cat],
                    documents: [],
                };
            }
            acc[cat].documents.push(doc);
            return acc;
        }, {});
        res.json({
            documents,
            grouped_by_category: Object.values(groupedByCategory),
            total: documents.length,
        });
    }
    catch (error) {
        console.error('Error listing candidate documents:', error);
        res.status(500).json({ error: 'Failed to list documents' });
    }
}
/**
 * Get signed URL for document download (NEW)
 * GET /api/candidate-documents/:id/download
 */
async function getCandidateDocumentDownloadUrlController(req, res) {
    try {
        const { id } = req.params;
        const expiresIn = req.query.expiresIn ? parseInt(req.query.expiresIn) : 3600;
        if (!id) {
            return res.status(400).json({ error: 'Document ID is required' });
        }
        const signedUrl = await (0, candidateDocumentService_1.getCandidateDocumentSignedUrl)(id, expiresIn);
        res.json({ signedUrl, expiresIn });
    }
    catch (error) {
        console.error('Error generating signed URL:', error);
        res.status(500).json({ error: error.message || 'Failed to generate signed URL' });
    }
}
/**
 * Delete candidate document (NEW)
 * DELETE /api/candidate-documents/:id
 */
async function deleteCandidateDocumentController(req, res) {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Document ID is required' });
        }
        await (0, candidateDocumentService_1.deleteCandidateDocument)(id);
        res.json({ success: true, message: 'Document deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting candidate document:', error);
        res.status(500).json({ error: error.message || 'Failed to delete document' });
    }
}
/**
 * Reprocess document verification (re-run AI verification)
 * POST /api/candidate-documents/:id/reprocess
 */
async function reprocessCandidateDocumentController(req, res) {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Document ID is required' });
        }
        const result = await (0, candidateDocumentService_1.reprocessDocumentVerification)(id);
        res.json({
            success: true,
            message: 'Document verification reprocessing initiated',
            request_id: result.request_id,
        });
    }
    catch (error) {
        console.error('Error reprocessing candidate document:', error);
        res.status(500).json({ error: error.message || 'Failed to reprocess document' });
    }
}
// ============================================================================
// LEGACY CONTROLLERS (for old documents table)
// ============================================================================
// ============================================================================
// OLD CONTROLLERS - REMOVED
// These controllers are no longer used as the old endpoints have been removed.
// Use the new candidate-documents controllers instead.
// ============================================================================
//
// REMOVED CONTROLLERS (use new unified system instead):
// - uploadDocumentController → Use uploadCandidateDocumentController
// - getDocumentController → Use getCandidateDocumentController
// - listCandidateDocumentsController → Use listCandidateDocumentsControllerNew
// - getDocumentSignedUrlController → Use getCandidateDocumentDownloadUrlController
// - deleteDocumentController → Use deleteCandidateDocumentController
//
