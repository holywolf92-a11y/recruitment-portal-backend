"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadCandidateDocumentController = uploadCandidateDocumentController;
exports.getCandidateDocumentController = getCandidateDocumentController;
exports.listCandidateDocumentsControllerNew = listCandidateDocumentsControllerNew;
exports.getCandidateDocumentDownloadUrlController = getCandidateDocumentDownloadUrlController;
exports.deleteCandidateDocumentController = deleteCandidateDocumentController;
exports.uploadDocumentController = uploadDocumentController;
exports.getDocumentController = getDocumentController;
exports.listCandidateDocumentsController = listCandidateDocumentsController;
exports.getDocumentSignedUrlController = getDocumentSignedUrlController;
exports.deleteDocumentController = deleteDocumentController;
const documentService_1 = require("../services/documentService");
const candidateDocumentService_1 = require("../services/candidateDocumentService");
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
    if (!candidate_id) {
        throw new Error('candidate_id is required');
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
// ============================================================================
// LEGACY CONTROLLERS (for old documents table)
// ============================================================================
async function uploadDocumentController(req, res) {
    try {
        const userId = 'test-user-id';
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const { candidate_id, doc_type, is_primary } = req.body;
        if (!candidate_id) {
            return res.status(400).json({ error: 'candidate_id is required' });
        }
        if (!doc_type) {
            return res.status(400).json({ error: 'doc_type is required' });
        }
        const uploadData = {
            candidate_id,
            doc_type,
            file_name: req.file.originalname,
            mime_type: req.file.mimetype,
            buffer: req.file.buffer,
            is_primary: is_primary === 'true' || is_primary === true,
        };
        const document = await (0, documentService_1.uploadDocument)(uploadData, userId);
        res.status(201).json({ document });
    }
    catch (error) {
        console.error('Error uploading document:', error);
        res.status(400).json({ error: error.message || 'Failed to upload document' });
    }
}
async function getDocumentController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Document ID is required' });
        }
        const document = await (0, documentService_1.getDocumentById)(id, userId);
        res.json({ document });
    }
    catch (error) {
        console.error('Error fetching document:', error);
        if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Document not found' });
        }
        else {
            res.status(500).json({ error: 'Failed to fetch document' });
        }
    }
}
async function listCandidateDocumentsController(req, res) {
    try {
        const userId = 'test-user-id';
        const { candidateId } = req.params;
        if (!candidateId) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const documents = await (0, documentService_1.listCandidateDocuments)(candidateId, userId);
        res.json({ documents });
    }
    catch (error) {
        console.error('Error listing documents:', error);
        res.status(500).json({ error: 'Failed to list documents' });
    }
}
async function getDocumentSignedUrlController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        const expiresIn = req.query.expiresIn ? parseInt(req.query.expiresIn) : 3600;
        if (!id) {
            return res.status(400).json({ error: 'Document ID is required' });
        }
        const signedUrl = await (0, documentService_1.getDocumentSignedUrl)(id, userId, expiresIn);
        res.json({ signedUrl });
    }
    catch (error) {
        console.error('Error generating signed URL:', error);
        res.status(500).json({ error: 'Failed to generate signed URL' });
    }
}
async function deleteDocumentController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Document ID is required' });
        }
        await (0, documentService_1.deleteDocument)(id, userId);
        res.json({ message: 'Document deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting document:', error);
        if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Document not found' });
        }
        else {
            res.status(500).json({ error: 'Failed to delete document' });
        }
    }
}
