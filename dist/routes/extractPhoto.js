"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const database_1 = require("../config/database");
const router = (0, express_1.Router)();
/**
 * POST /api/candidates/:id/extract-photo
 * Extracts profile photo from a PDF document and sets it as the candidate's profile photo
 */
router.post('/:id/extract-photo', async (req, res) => {
    try {
        const { id } = req.params;
        const { documentId } = req.body;
        if (!documentId) {
            return res.status(400).json({ error: 'documentId is required' });
        }
        const db = (0, database_1.supabaseAdminClient)();
        // Get the document
        const { data: doc, error: docError } = await db
            .from('candidate_documents')
            .select('*')
            .eq('id', documentId)
            .eq('candidate_id', id)
            .single();
        if (docError || !doc) {
            return res.status(404).json({ error: 'Document not found' });
        }
        // Update document category to 'photos' and set as profile photo
        const { error: updateDocError } = await db
            .from('candidate_documents')
            .update({
            category: 'photos',
            verification_status: 'verified'
        })
            .eq('id', documentId);
        if (updateDocError) {
            console.error('Failed to update document:', updateDocError);
            return res.status(500).json({ error: 'Failed to update document' });
        }
        // Update candidate profile photo
        const { error: updateCandidateError } = await db
            .from('candidates')
            .update({
            profile_photo_path: doc.storage_path,
            profile_photo_url: doc.storage_url,
            profile_photo_bucket: doc.storage_bucket || 'documents',
            photo_received: true,
            photo_received_at: new Date().toISOString()
        })
            .eq('id', id);
        if (updateCandidateError) {
            console.error('Failed to update candidate:', updateCandidateError);
            return res.status(500).json({ error: 'Failed to update candidate' });
        }
        res.json({
            success: true,
            message: 'Profile photo extracted successfully',
            document: doc
        });
    }
    catch (error) {
        console.error('Error extracting photo:', error);
        res.status(500).json({ error: error.message || 'Failed to extract photo' });
    }
});
exports.default = router;
