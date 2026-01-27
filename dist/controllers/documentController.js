"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadCandidateDocumentController = uploadCandidateDocumentController;
exports.getCandidateDocumentController = getCandidateDocumentController;
exports.listCandidateDocumentsControllerNew = listCandidateDocumentsControllerNew;
exports.getCandidateDocumentDownloadUrlController = getCandidateDocumentDownloadUrlController;
exports.deleteCandidateDocumentController = deleteCandidateDocumentController;
exports.reprocessCandidateDocumentController = reprocessCandidateDocumentController;
exports.overrideCandidateDocumentController = overrideCandidateDocumentController;
exports.splitUploadController = splitUploadController;
// Old documentService imports removed - using candidateDocumentService instead
const candidateDocumentService_1 = require("../services/candidateDocumentService");
const candidateController_1 = require("./candidateController");
const documentCategories_1 = require("../config/documentCategories");
const splitUploadService_1 = require("../services/splitUploadService");
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
    const { candidate_id, source, document_type } = req.body;
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
        document_type: document_type || undefined,
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
        document: await (0, candidateDocumentService_1.formatDocumentResponse)(document), // Use formatted response with rejection details
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
        // Format document with rejection details for ALL document types
        res.json({ document: await (0, candidateDocumentService_1.formatDocumentResponse)(document) });
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
        // Format all documents with rejection details
        const formattedDocuments = await Promise.all(documents.map(doc => (0, candidateDocumentService_1.formatDocumentResponse)(doc)));
        // Group by category for frontend
        const groupedByCategory = formattedDocuments.reduce((acc, doc) => {
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
            documents: formattedDocuments,
            grouped_by_category: Object.values(groupedByCategory),
            total: formattedDocuments.length,
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
        // Backward compatibility: frontend expects `download_url`
        res.json({ signedUrl, download_url: signedUrl, expiresIn });
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
/**
 * Admin override document verification
 * POST /api/candidate-documents/:id/override
 * Requires admin role and password verification
 */
async function overrideCandidateDocumentController(req, res) {
    try {
        const { id } = req.params;
        const { admin_email, admin_password, justification } = req.body;
        const authUser = req.user;
        if (!id) {
            return res.status(400).json({ error: 'Document ID is required' });
        }
        if (!admin_email) {
            return res.status(400).json({ error: 'Admin email is required' });
        }
        if (!admin_password) {
            return res.status(400).json({ error: 'Admin password is required' });
        }
        if (!justification || justification.trim().length < 10) {
            return res.status(400).json({ error: 'Justification must be at least 10 characters' });
        }
        // Get admin user info from auth context (if available) or from password verification
        // For now, we'll get it from password verification in the service
        // In production, auth middleware should provide req.user
        const adminUserId = authUser?.id || null; // Will be verified in service via password
        const adminRole = authUser?.role?.toLowerCase() || 'admin'; // Default to admin, will be verified in service
        const document = await (0, candidateDocumentService_1.overrideDocumentVerification)(id, adminUserId || 'temp', // Will be replaced by actual user ID from password verification
        admin_email, admin_password, justification.trim(), adminRole);
        res.json({
            success: true,
            document: await (0, candidateDocumentService_1.formatDocumentResponse)(document),
            message: 'Document verification override successful',
        });
    }
    catch (error) {
        console.error('Error overriding candidate document:', error);
        // Map AppError to appropriate status codes
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        res.status(500).json({ error: error.message || 'Failed to override document verification' });
    }
}
// ============================================================================
// LEGACY CONTROLLERS (for old documents table)
// ============================================================================
// ============================================================================
// OLD CONTROLLERS - REMOVED
// Use the new candidate-documents controllers instead.
// ============================================================================
/**
 * Split-and-categorize upload: preserve original -> parser -> create candidate if none -> one doc per documents[].
 * Body: file (multer), optional candidate_id, optional candidate_data (JSON string), optional use_textract.
 */
async function splitUploadController(req, res) {
    try {
        const userId = req.user?.id || 'system';
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const candidateId = req.body?.candidate_id || undefined;
        let candidateData;
        try {
            const raw = req.body?.candidate_data;
            if (typeof raw === 'string' && raw)
                candidateData = JSON.parse(raw);
            else if (raw && typeof raw === 'object')
                candidateData = raw;
        }
        catch {
            candidateData = undefined;
        }
        const useTextract = req.body?.use_textract !== 'false' && req.body?.use_textract !== false;
        const result = await (0, splitUploadService_1.splitUpload)({
            buffer: req.file.buffer,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            candidateId,
            candidateData,
            useTextract,
            userId,
        });
        return res.status(201).json({
            message: 'Split upload complete',
            uploadId: result.uploadId,
            originalPath: result.originalPath,
            candidateId: result.candidateId,
            engineUsed: result.engineUsed,
            documentCount: result.documentCount,
        });
    }
    catch (error) {
        console.error('Split upload error:', error);
        return res.status(400).json({ error: error.message || 'Split upload failed' });
    }
}
