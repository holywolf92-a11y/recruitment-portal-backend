"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPhotoFromPdfController = extractPhotoFromPdfController;
const database_1 = require("../config/database");
const pdfPhotoExtractionService_1 = require("../services/pdfPhotoExtractionService");
/**
 * POST /api/documents/candidates/:candidateId/extract-photo
 * Extracts a photo from the candidate's profile photo PDF and saves it as an image
 */
async function extractPhotoFromPdfController(req, res) {
    try {
        const { candidateId } = req.params;
        if (!candidateId) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        console.log(`[Extract Photo] Starting for candidate: ${candidateId}`);
        // Get candidate to find their profile photo PDF
        const db = (0, database_1.supabaseAdminClient)();
        const { data: candidate, error: candidateError } = await db
            .from('candidates')
            .select('profile_photo_url, profile_photo_path')
            .eq('id', candidateId)
            .neq('status', 'Deleted') // Exclude deleted candidates
            .single();
        if (candidateError || !candidate) {
            console.error(`[Extract Photo] Candidate not found:`, candidateError);
            return res.status(404).json({ error: 'Candidate not found' });
        }
        const pdfUrl = candidate.profile_photo_url || candidate.profile_photo_path;
        if (!pdfUrl) {
            return res.status(400).json({ error: 'No profile photo found for this candidate' });
        }
        // Check if URL is actually a PDF
        if (!pdfUrl.toLowerCase().includes('.pdf')) {
            return res.status(400).json({ error: 'Profile photo is not a PDF' });
        }
        console.log(`[Extract Photo] Profile photo URL: ${pdfUrl.substring(0, 100)}...`);
        // Extract and save photo
        const signedUrl = await (0, pdfPhotoExtractionService_1.extractAndSavePhotoFromPdf)(candidateId, pdfUrl);
        if (!signedUrl) {
            return res.status(500).json({ error: 'Failed to extract photo from PDF' });
        }
        // Update candidate's profile_photo_url to point to the extracted image
        const { error: updateError } = await db
            .from('candidates')
            .update({ profile_photo_url: signedUrl })
            .eq('id', candidateId);
        if (updateError) {
            console.warn(`[Extract Photo] Update error (non-fatal):`, updateError);
        }
        res.json({
            success: true,
            signedUrl,
            message: 'Photo extracted from PDF and saved successfully',
        });
    }
    catch (error) {
        console.error('[Extract Photo] Error:', error);
        res.status(500).json({ error: error.message || 'Failed to extract photo' });
    }
}
