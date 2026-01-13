"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCandidateController = createCandidateController;
exports.getCandidateController = getCandidateController;
exports.listCandidatesController = listCandidatesController;
exports.updateCandidateController = updateCandidateController;
exports.deleteCandidateController = deleteCandidateController;
exports.extractCandidateDataController = extractCandidateDataController;
exports.updateExtractionController = updateExtractionController;
exports.getExtractionHistoryController = getExtractionHistoryController;
exports.getCandidateCVDownloadController = getCandidateCVDownloadController;
exports.uploadCandidatePhotoController = uploadCandidatePhotoController;
exports.bulkUpdateCandidateStatusController = bulkUpdateCandidateStatusController;
// import { AuthRequest } from '../middleware/auth';
const candidateService_1 = require("../services/candidateService");
async function createCandidateController(req, res) {
    try {
        // For now, use a placeholder user ID for testing
        const userId = 'test-user-id';
        const candidateData = req.body;
        // Basic validation
        if (!candidateData.name || candidateData.name.trim().length === 0) {
            return res.status(400).json({ error: 'Candidate name is required' });
        }
        const candidate = await (0, candidateService_1.createCandidate)(candidateData, userId);
        res.status(201).json({ candidate });
    }
    catch (error) {
        console.error('Error creating candidate:', error);
        res.status(400).json({ error: error.message || 'Failed to create candidate' });
    }
}
async function getCandidateController(req, res) {
    try {
        // For now, use a placeholder user ID for testing
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const candidate = await (0, candidateService_1.getCandidateById)(id, userId);
        res.json({ candidate });
    }
    catch (error) {
        console.error('Error fetching candidate:', error);
        if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Candidate not found' });
        }
        else {
            res.status(500).json({ error: 'Failed to fetch candidate' });
        }
    }
}
async function listCandidatesController(req, res) {
    try {
        // For now, use a placeholder user ID for testing
        const userId = 'test-user-id';
        const filters = {
            search: req.query.search,
            status: req.query.status,
            position: req.query.position,
            country_of_interest: req.query.country_of_interest,
            documents: req.query.documents,
            limit: req.query.limit ? parseInt(req.query.limit) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset) : undefined,
        };
        const result = await (0, candidateService_1.listCandidates)(filters, userId);
        res.json(result);
    }
    catch (error) {
        console.error('Error listing candidates:', error);
        res.status(500).json({ error: 'Failed to fetch candidates' });
    }
}
async function updateCandidateController(req, res) {
    try {
        // For now, use a placeholder user ID for testing
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const updateData = req.body;
        // Basic validation
        if (updateData.name !== undefined && (!updateData.name || updateData.name.trim().length === 0)) {
            return res.status(400).json({ error: 'Candidate name cannot be empty' });
        }
        const candidate = await (0, candidateService_1.updateCandidate)(id, updateData, userId);
        res.json({ candidate });
    }
    catch (error) {
        console.error('Error updating candidate:', error);
        if (error.message?.includes('Duplicate candidate found')) {
            res.status(409).json({ error: error.message });
        }
        else if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Candidate not found' });
        }
        else {
            res.status(400).json({ error: error.message || 'Failed to update candidate' });
        }
    }
}
async function deleteCandidateController(req, res) {
    try {
        // For now, use a placeholder user ID for testing
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        await (0, candidateService_1.deleteCandidate)(id, userId);
        res.json({ message: 'Candidate deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting candidate:', error);
        if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Candidate not found' });
        }
        else {
            res.status(500).json({ error: 'Failed to delete candidate' });
        }
    }
}
// CV Extraction Controllers
async function extractCandidateDataController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        const { cvUrl } = req.body;
        console.log('🔄 CV Extraction endpoint called - ID:', id, 'URL:', cvUrl);
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        if (!cvUrl) {
            return res.status(400).json({ error: 'CV URL is required' });
        }
        // Import extraction service
        const { extractCandidateData } = require('../services/extractionService');
        const result = await extractCandidateData(id, cvUrl, userId);
        res.json(result);
    }
    catch (error) {
        console.error('Error extracting candidate data:', error);
        res.status(500).json({ error: error.message || 'Failed to extract candidate data' });
    }
}
async function updateExtractionController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        const { extractedData, approved, notes } = req.body;
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const { updateExtraction } = require('../services/extractionService');
        const result = await updateExtraction(id, extractedData, approved, notes, userId);
        res.json(result);
    }
    catch (error) {
        console.error('Error updating extraction:', error);
        res.status(500).json({ error: error.message || 'Failed to update extraction' });
    }
}
async function getExtractionHistoryController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const { getExtractionHistory } = require('../services/extractionService');
        const history = await getExtractionHistory(id, userId);
        res.json({ history });
    }
    catch (error) {
        console.error('Error fetching extraction history:', error);
        res.status(500).json({ error: 'Failed to fetch extraction history' });
    }
}
async function getCandidateCVDownloadController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        // Import supabase and utility for signed URLs
        const { supabaseAdminClient } = require('../config/database');
        const db = supabaseAdminClient();
        // Find CV document for this candidate
        const { data: cvDoc, error: docError } = await db
            .from('candidate_documents')
            .select('*')
            .eq('candidate_id', id)
            .eq('document_type', 'cv')
            .order('received_at', { ascending: false })
            .limit(1)
            .single();
        if (docError || !cvDoc) {
            return res.status(404).json({ error: 'CV not found for this candidate' });
        }
        // Generate signed URL for download
        try {
            const { data, error: urlError } = await db.storage
                .from('documents')
                .createSignedUrl(cvDoc.storage_path, 300); // 5 minute expiry for download
            if (urlError || !data?.signedUrl) {
                return res.status(500).json({ error: 'Failed to generate download URL' });
            }
            return res.json({
                download_url: data.signedUrl,
                filename: cvDoc.file_name,
                document_id: cvDoc.id
            });
        }
        catch (urlGenError) {
            console.error('Error generating signed URL:', urlGenError);
            return res.status(500).json({ error: 'Failed to generate download link' });
        }
    }
    catch (error) {
        console.error('Error fetching CV download URL:', error);
        res.status(500).json({ error: 'Failed to fetch CV download URL' });
    }
}
async function uploadCandidatePhotoController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No photo file uploaded' });
        }
        const { supabaseAdminClient } = require('../config/database');
        const db = supabaseAdminClient();
        // Verify candidate exists
        const { data: candidate, error: candidateError } = await db
            .from('candidates')
            .select('id, name')
            .eq('id', id)
            .single();
        if (candidateError || !candidate) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        // Generate storage path: candidates/{id}/photo/{filename}
        const timestamp = Date.now();
        const ext = req.file.originalname.split('.').pop() || 'jpg';
        const filename = `profile_${timestamp}.${ext}`;
        const storagePath = `candidates/${id}/photo/${filename}`;
        const bucket = 'documents';
        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await db.storage
            .from(bucket)
            .upload(storagePath, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: true,
        });
        if (uploadError) {
            console.error('Upload error:', uploadError);
            return res.status(500).json({ error: 'Failed to upload photo to storage' });
        }
        // Update candidate record with photo path
        const { error: updateError } = await db
            .from('candidates')
            .update({
            profile_photo_bucket: bucket,
            profile_photo_path: storagePath,
            photo_received: true,
            photo_received_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
            .eq('id', id);
        if (updateError) {
            console.error('Update error:', updateError);
            return res.status(500).json({ error: 'Failed to update candidate with photo' });
        }
        // Generate signed URL for display
        const { data: signedUrlData, error: urlError } = await db.storage
            .from(bucket)
            .createSignedUrl(storagePath, 3600); // 1 hour expiry
        if (urlError) {
            console.error('Signed URL error:', urlError);
            // Photo uploaded successfully but URL generation failed
            return res.json({
                message: 'Photo uploaded successfully',
                photo_path: storagePath,
                photo_url: null
            });
        }
        return res.json({
            message: 'Photo uploaded successfully',
            photo_path: storagePath,
            photo_url: signedUrlData.signedUrl
        });
    }
    catch (error) {
        console.error('Error uploading candidate photo:', error);
        res.status(500).json({ error: 'Failed to upload photo' });
    }
}
async function bulkUpdateCandidateStatusController(req, res) {
    try {
        const userId = 'test-user-id';
        const { candidateIds, status } = req.body || {};
        if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
            return res.status(400).json({ error: 'candidateIds must be a non-empty array' });
        }
        if (!status) {
            return res.status(400).json({ error: 'status is required' });
        }
        const result = await (0, candidateService_1.bulkUpdateCandidateStatus)(candidateIds, status, userId);
        return res.json(result);
    }
    catch (error) {
        console.error('Error bulk updating candidate status:', error);
        return res.status(400).json({ error: error.message || 'Failed to bulk update status' });
    }
}
