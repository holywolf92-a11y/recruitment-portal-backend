"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadDocumentController = uploadDocumentController;
exports.getDocumentController = getDocumentController;
exports.listCandidateDocumentsController = listCandidateDocumentsController;
exports.getDocumentSignedUrlController = getDocumentSignedUrlController;
exports.deleteDocumentController = deleteDocumentController;
const documentService_1 = require("../services/documentService");
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
