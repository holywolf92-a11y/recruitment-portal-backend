"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCandidateController = createCandidateController;
exports.getCandidateController = getCandidateController;
exports.listCandidatesController = listCandidatesController;
exports.updateCandidateController = updateCandidateController;
exports.deleteCandidateController = deleteCandidateController;
exports.extractCandidateDataController = extractCandidateDataController;
exports.updateExtractionController = updateExtractionController;
exports.updateDocumentFlagsController = updateDocumentFlagsController;
exports.getExtractionHistoryController = getExtractionHistoryController;
exports.getCandidateCVDownloadController = getCandidateCVDownloadController;
exports.uploadCandidatePhotoController = uploadCandidatePhotoController;
exports.bulkUpdateCandidateStatusController = bulkUpdateCandidateStatusController;
// import { AuthRequest } from '../middleware/auth';
const candidateService_1 = require("../services/candidateService");
const database_1 = require("../config/database");
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
/**
 * Update candidate document flags based on actual documents
 * POST /api/candidates/:id/update-document-flags
 */
async function updateDocumentFlagsController(req, res) {
    try {
        const { id } = req.params;
        const db = (0, database_1.supabaseAdminClient)();
        // Get ALL documents for this candidate (including all statuses)
        // This ensures we catch documents regardless of verification status
        const { data: documents, error: docsError } = await db
            .from('candidate_documents')
            .select('category, verification_status, file_name')
            .eq('candidate_id', id);
        if (docsError) {
            return res.status(500).json({ error: `Failed to fetch documents: ${docsError.message}` });
        }
        // Also check the old documents table for CVs (legacy support)
        const { data: oldDocuments, error: oldDocsError } = await db
            .from('documents')
            .select('doc_type, file_name')
            .eq('candidate_id', id)
            .eq('deleted_at', null);
        // Combine both document sources
        const allDocs = [
            ...(documents || []).map(d => ({ category: d.category, type: null, file_name: d.file_name })),
            ...(oldDocuments || []).map(d => ({ category: null, type: d.doc_type, file_name: d.file_name }))
        ];
        // Determine which flags to set based on actual documents
        const updateFlags = {};
        const now = new Date().toISOString();
        // Track what we found for logging
        const foundCategories = [];
        for (const doc of allDocs) {
            const category = (doc.category || '').toLowerCase();
            const docType = (doc.type || '').toLowerCase();
            const fileName = (doc.file_name || '').toLowerCase();
            // Check category first (new system)
            if (category === 'cv_resume' || category === 'cv') {
                updateFlags.cv_received = true;
                updateFlags.cv_received_at = now;
                foundCategories.push('CV (from category)');
            }
            // Check doc_type (old system)
            else if (docType === 'cv' || docType.includes('resume') || docType.includes('cv')) {
                updateFlags.cv_received = true;
                updateFlags.cv_received_at = now;
                foundCategories.push('CV (from doc_type)');
            }
            // Check filename as fallback
            else if (fileName.includes('cv') || fileName.includes('resume')) {
                updateFlags.cv_received = true;
                updateFlags.cv_received_at = now;
                foundCategories.push('CV (from filename)');
            }
            if (category === 'passport' || docType === 'passport' || fileName.includes('passport')) {
                updateFlags.passport_received = true;
                updateFlags.passport_received_at = now;
                foundCategories.push('Passport');
            }
            if (category === 'certificates' || category === 'certificate' || docType === 'certificate' || fileName.includes('certificate')) {
                updateFlags.certificate_received = true;
                updateFlags.certificate_received_at = now;
                foundCategories.push('Certificate');
            }
            if (category === 'photos' || category === 'photo' || docType === 'photo' || fileName.includes('photo')) {
                updateFlags.photo_received = true;
                updateFlags.photo_received_at = now;
                foundCategories.push('Photo');
            }
            if (category === 'medical_reports' || category === 'medical' || docType === 'medical' || fileName.includes('medical')) {
                updateFlags.medical_received = true;
                updateFlags.medical_received_at = now;
                foundCategories.push('Medical');
            }
        }
        if (Object.keys(updateFlags).length > 0) {
            const { error: updateError } = await db
                .from('candidates')
                .update(updateFlags)
                .eq('id', id);
            if (updateError) {
                return res.status(500).json({ error: `Failed to update flags: ${updateError.message}` });
            }
            return res.json({
                success: true,
                message: 'Document flags updated',
                flags: Object.keys(updateFlags).filter(k => k.endsWith('_received')),
                found_documents: foundCategories,
                total_documents: allDocs.length,
            });
        }
        else {
            return res.json({
                success: true,
                message: 'No documents found to update flags',
                flags: [],
            });
        }
    }
    catch (error) {
        console.error('Error updating document flags:', error);
        res.status(500).json({ error: error.message || 'Failed to update document flags' });
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
        const { supabaseAdminClient } = require('../config/database');
        const db = supabaseAdminClient();
        // Try to find CV in candidate_documents table (case-insensitive search)
        const { data: cvDocs } = await db
            .from('candidate_documents')
            .select('*')
            .eq('candidate_id', id)
            .ilike('document_type', 'cv')
            .order('received_at', { ascending: false });
        let cvDoc = cvDocs && cvDocs.length > 0 ? cvDocs[0] : null;
        // If not found, try inbox_attachments table (check both candidate_id and linked_candidate_id)
        if (!cvDoc) {
            const { data: inboxDocs } = await db
                .from('inbox_attachments')
                .select('*')
                .or(`candidate_id.eq.${id},linked_candidate_id.eq.${id}`)
                .or('attachment_kind.ilike.cv,document_type.ilike.cv')
                .order('created_at', { ascending: false });
            if (inboxDocs && inboxDocs.length > 0) {
                cvDoc = {
                    storage_path: inboxDocs[0].storage_path,
                    file_name: inboxDocs[0].file_name || 'CV.pdf',
                    id: inboxDocs[0].id,
                    storage_bucket: inboxDocs[0].storage_bucket || 'documents'
                };
            }
        }
        if (!cvDoc || !cvDoc.storage_path) {
            return res.status(404).json({ error: 'CV not found for this candidate' });
        }
        // Use storage_bucket from the document record, fallback to 'documents'
        const bucket = cvDoc.storage_bucket || 'documents';
        // Generate signed URL for download
        try {
            const { data, error: urlError } = await db.storage
                .from(bucket)
                .createSignedUrl(cvDoc.storage_path, 300); // 5 minute expiry
            if (urlError || !data?.signedUrl) {
                console.error('Signed URL error:', urlError);
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
