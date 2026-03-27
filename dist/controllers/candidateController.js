"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCandidateController = createCandidateController;
exports.getCandidateController = getCandidateController;
exports.listCandidatesController = listCandidatesController;
exports.dailyStatsController = dailyStatsController;
exports.candidateDashboardStatsController = candidateDashboardStatsController;
exports.candidateBrowseMetadataController = candidateBrowseMetadataController;
exports.exportCandidatesController = exportCandidatesController;
exports.updateCandidateController = updateCandidateController;
exports.deleteCandidateController = deleteCandidateController;
exports.extractCandidateDataController = extractCandidateDataController;
exports.updateExtractionController = updateExtractionController;
exports.updateDocumentFlagsController = updateDocumentFlagsController;
exports.linkCandidatesCVController = linkCandidatesCVController;
exports.getExtractionHistoryController = getExtractionHistoryController;
exports.getCandidateCVDownloadController = getCandidateCVDownloadController;
exports.uploadCandidatePhotoController = uploadCandidatePhotoController;
exports.bulkUpdateCandidateStatusController = bulkUpdateCandidateStatusController;
exports.updateCandidateFieldManuallyController = updateCandidateFieldManuallyController;
exports.getMissingFieldsController = getMissingFieldsController;
exports.mergeCandidateController = mergeCandidateController;
exports.getCandidateMergeHistoryController = getCandidateMergeHistoryController;
exports.getMatchingMetricsController = getMatchingMetricsController;
// import { AuthRequest } from '../middleware/auth';
const candidateService_1 = require("../services/candidateService");
const progressiveDataCompletionService_1 = require("../services/progressiveDataCompletionService");
const linkCVService_1 = require("../services/linkCVService");
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
        // Filter out government emails
        if (candidateData.email && (0, progressiveDataCompletionService_1.isGovernmentEmail)(candidateData.email)) {
            console.log(`🚫 Filtered government email in manual candidate creation: ${candidateData.email}`);
            candidateData.email = undefined;
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
        if (!candidate) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        // Map passport_normalized to passport for frontend compatibility
        const mappedCandidate = {
            ...candidate,
            passport: candidate.passport_normalized || candidate.passport || null,
        };
        // Generate short-lived signed URL for profile photo (best-effort)
        try {
            if (mappedCandidate) {
                const db = (0, database_1.supabaseAdminClient)();
                let bucket = mappedCandidate.profile_photo_bucket || 'documents';
                let storagePath = mappedCandidate.profile_photo_path || null;
                // If we don't have an explicit storage path, try to derive from profile_photo_url
                if (!storagePath && mappedCandidate.profile_photo_url) {
                    const url = mappedCandidate.profile_photo_url;
                    const publicMarker = '/storage/v1/object/public/';
                    const signMarker = '/storage/v1/object/sign/';
                    if (url.includes(publicMarker)) {
                        const rest = url.substring(url.indexOf(publicMarker) + publicMarker.length);
                        const parts = rest.split('/');
                        bucket = parts.shift() || bucket;
                        storagePath = parts.join('/');
                    }
                    else if (url.includes(signMarker)) {
                        // Signed URL form: .../object/sign/<bucket>/<path>?token=...
                        const after = url.substring(url.indexOf(signMarker) + signMarker.length).split('?')[0];
                        const parts = after.split('/');
                        bucket = parts.shift() || bucket;
                        storagePath = parts.join('/');
                    }
                }
                if (storagePath) {
                    const ttlSeconds = 31536000; // 1 year (effectively permanent)
                    const { data: signedData, error: urlError } = await db.storage.from(bucket).createSignedUrl(storagePath, ttlSeconds);
                    if (!urlError && signedData && signedData.signedUrl) {
                        mappedCandidate.profile_photo_signed_url = signedData.signedUrl;
                    }
                }
            }
        }
        catch (e) {
            console.warn('Failed to generate profile photo signed URL:', e);
            // Don't fail the request if URL generation fails
        }
        res.json({ candidate: mappedCandidate });
    }
    catch (error) {
        console.error('Error fetching candidate:', error);
        res.status(500).json({ error: 'Failed to fetch candidate' });
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
            applied_from: req.query.applied_from,
            applied_to: req.query.applied_to,
            sort_by: req.query.sort_by,
            sort_order: req.query.sort_order || undefined,
            limit: req.query.limit ? parseInt(req.query.limit) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset) : undefined,
        };
        const result = await (0, candidateService_1.listCandidates)(filters, userId);
        // Only re-sign photo URLs that are NOT already signed (e.g. old public URLs).
        // Signed URLs use a 1-year TTL and are stored in profile_photo_url — no need to
        // re-call Supabase on every list request. Previously this made N HTTP calls to
        // Supabase per list request (one per candidate), generating significant Railway egress.
        const signMarker = '/storage/v1/object/sign/';
        const publicMarker = '/storage/v1/object/public/';
        const candidatesWithSignedUrls = await Promise.all(result.candidates.map(async (candidate) => {
            try {
                const storedUrl = candidate.profile_photo_url || '';
                // Already a signed URL — return as-is, no extra Supabase call needed
                if (storedUrl.includes(signMarker)) {
                    return { ...candidate, profile_photo_signed_url: storedUrl };
                }
                // Public URL or explicit storage path — needs one-time signing
                const db = (0, database_1.supabaseAdminClient)();
                let bucket = candidate.profile_photo_bucket || 'documents';
                let storagePath = candidate.profile_photo_path || null;
                if (!storagePath && storedUrl.includes(publicMarker)) {
                    const rest = storedUrl.substring(storedUrl.indexOf(publicMarker) + publicMarker.length);
                    const parts = rest.split('/');
                    bucket = parts.shift() || bucket;
                    storagePath = parts.join('/');
                }
                if (storagePath) {
                    const ttlSeconds = 31536000; // 1 year
                    const { data: signedData, error: urlError } = await db.storage.from(bucket).createSignedUrl(storagePath, ttlSeconds);
                    if (!urlError && signedData && signedData.signedUrl) {
                        return {
                            ...candidate,
                            profile_photo_url: signedData.signedUrl,
                            profile_photo_signed_url: signedData.signedUrl,
                        };
                    }
                }
                return candidate;
            }
            catch (e) {
                return candidate;
            }
        }));
        res.json({ ...result, candidates: candidatesWithSignedUrls });
        return;
    }
    catch (error) {
        console.error('Error listing candidates:', error);
        res.status(500).json({ error: 'Failed to fetch candidates' });
    }
}
async function dailyStatsController(req, res) {
    try {
        const userId = 'test-user-id';
        const filters = {
            search: req.query.search,
            position: req.query.position,
            country_of_interest: req.query.country_of_interest,
            documents: req.query.documents,
            applied_from: req.query.applied_from,
            applied_to: req.query.applied_to,
        };
        const stats = await (0, candidateService_1.getDailyStats)(filters, userId);
        res.json(stats);
    }
    catch (error) {
        console.error('Error fetching daily stats:', error);
        res.status(500).json({ error: 'Failed to fetch daily stats' });
    }
}
async function candidateDashboardStatsController(_req, res) {
    try {
        const userId = 'test-user-id';
        const stats = await (0, candidateService_1.getCandidateDashboardStats)(userId);
        res.json(stats);
    }
    catch (error) {
        console.error('Error fetching candidate dashboard stats:', error);
        res.status(500).json({ error: 'Failed to fetch candidate dashboard stats' });
    }
}
async function candidateBrowseMetadataController(_req, res) {
    try {
        const userId = 'test-user-id';
        const metadata = await (0, candidateService_1.getCandidateBrowseMetadata)(userId);
        res.json(metadata);
    }
    catch (error) {
        console.error('Error fetching candidate browse metadata:', error);
        res.status(500).json({ error: 'Failed to fetch candidate browse metadata' });
    }
}
async function exportCandidatesController(req, res) {
    try {
        const userId = 'test-user-id';
        const format = req.query.format || 'csv';
        if (format !== 'csv' && format !== 'xlsx') {
            return res.status(400).json({ error: 'Format must be csv or xlsx' });
        }
        const filters = {
            search: req.query.search,
            status: req.query.status,
            position: req.query.position,
            country_of_interest: req.query.country_of_interest,
            documents: req.query.documents,
            applied_from: req.query.applied_from,
            applied_to: req.query.applied_to,
            sort_by: req.query.sort_by,
            sort_order: req.query.sort_order || undefined,
        };
        const { buffer, filename } = await (0, candidateService_1.exportCandidates)(filters, format, userId);
        res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    }
    catch (error) {
        console.error('Error exporting candidates:', error);
        res.status(500).json({ error: 'Failed to export candidates' });
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
        // Check inbox_attachments for CVs (when candidate was created from CV inbox)
        // Check both candidate_id and linked_candidate_id fields
        // Also check attachment_kind and document_type for CV identification (matching CV download logic)
        const { data: inboxAttachments, error: inboxError } = await db
            .from('inbox_attachments')
            .select('attachment_type, attachment_kind, document_type, file_name, candidate_id, linked_candidate_id')
            .or(`candidate_id.eq.${id},linked_candidate_id.eq.${id}`);
        // Log inbox attachments found for debugging
        if (inboxAttachments && inboxAttachments.length > 0) {
            console.log(`[UpdateDocumentFlags] Found ${inboxAttachments.length} inbox attachments for candidate ${id}:`, inboxAttachments.map(a => ({
                type: a.attachment_type,
                kind: a.attachment_kind,
                doc_type: a.document_type,
                file: a.file_name
            })));
        }
        // Also check the old documents table for documents (legacy support)
        // Note: We don't filter by deleted_at since it might not exist in all schemas
        const { data: oldDocuments, error: oldDocsError } = await db
            .from('documents')
            .select('doc_type, file_name')
            .eq('candidate_id', id);
        // Log error but don't fail - old documents table might not exist in all deployments
        if (oldDocsError) {
            console.warn(`[UpdateDocumentFlags] Could not fetch old documents for candidate ${id} (this is OK if using new system only):`, oldDocsError.message);
        }
        // Combine all document sources
        const allDocs = [
            ...(documents || []).map(d => ({
                category: d.category,
                type: null,
                attachment_kind: null,
                document_type: null,
                file_name: d.file_name,
                source: 'candidate_documents'
            })),
            ...(inboxAttachments || []).map(d => ({
                category: null,
                type: d.attachment_type,
                attachment_kind: d.attachment_kind,
                document_type: d.document_type,
                file_name: d.file_name,
                source: 'inbox_attachments'
            })),
            ...(oldDocuments || []).map(d => ({
                category: null,
                type: d.doc_type,
                attachment_kind: null,
                document_type: null,
                file_name: d.file_name,
                source: 'documents'
            }))
        ];
        // Determine which flags to set based on actual documents
        const updateFlags = {};
        const now = new Date().toISOString();
        // Track what we found for logging
        const foundCategories = [];
        for (const doc of allDocs) {
            const category = (doc.category || '').toLowerCase();
            const docType = (doc.type || '').toLowerCase();
            const attachmentKind = (doc.attachment_kind || '').toLowerCase();
            const documentType = (doc.document_type || '').toLowerCase();
            const fileName = (doc.file_name || '').toLowerCase();
            // Check category first (new system - candidate_documents)
            if (category === 'cv_resume' || category === 'cv') {
                updateFlags.cv_received = true;
                updateFlags.cv_received_at = now;
                foundCategories.push('CV (from candidate_documents category)');
            }
            // Check attachment_kind from inbox_attachments (CVs from inbox) - this is the key field!
            else if (attachmentKind === 'cv') {
                updateFlags.cv_received = true;
                updateFlags.cv_received_at = now;
                foundCategories.push('CV (from inbox_attachments.attachment_kind)');
            }
            // Check attachment_type from inbox_attachments
            else if (docType === 'cv' || docType === 'CV') {
                updateFlags.cv_received = true;
                updateFlags.cv_received_at = now;
                foundCategories.push('CV (from inbox_attachments.attachment_type)');
            }
            // Check document_type from inbox_attachments
            else if (documentType === 'cv') {
                updateFlags.cv_received = true;
                updateFlags.cv_received_at = now;
                foundCategories.push('CV (from inbox_attachments.document_type)');
            }
            // Check doc_type (old documents table)
            else if (docType && (docType.includes('resume') || docType.includes('cv'))) {
                updateFlags.cv_received = true;
                updateFlags.cv_received_at = now;
                foundCategories.push('CV (from documents table)');
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
            if (category === 'cnic' || docType === 'cnic' || fileName.includes('cnic') || fileName.includes('id card')) {
                updateFlags.cnic_received = true;
                updateFlags.cnic_received_at = now;
                foundCategories.push('CNIC');
            }
            if (category === 'driving_license' || docType === 'driving_license' || fileName.includes('driving') || fileName.includes('license') || fileName.includes('dl')) {
                updateFlags.driving_license_received = true;
                updateFlags.driving_license_received_at = now;
                foundCategories.push('Driving License');
            }
            if (category === 'police_character_certificate' || docType === 'police_character_certificate' || fileName.includes('police') || fileName.includes('character') || fileName.includes('pcc')) {
                updateFlags.police_character_received = true;
                updateFlags.police_character_received_at = now;
                foundCategories.push('Police Character Certificate');
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
/**
 * Link existing CV from inbox_attachments to candidate_documents
 * POST /api/candidates/:id/link-cv
 */
async function linkCandidatesCVController(req, res) {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const document = await (0, linkCVService_1.linkExistingCVFromInbox)(id);
        res.json({
            success: true,
            message: 'CV linked successfully from inbox',
            document: {
                id: document.id,
                candidate_id: document.candidate_id,
                file_name: document.file_name,
                category: document.category,
                created_at: document.created_at,
            },
        });
    }
    catch (error) {
        console.error('Error linking CV:', error);
        res.status(error.statusCode || 500).json({
            error: error.message || 'Failed to link CV'
        });
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
            .neq('status', 'Deleted') // Exclude deleted candidates
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
            .createSignedUrl(storagePath, 31536000); // 1 year expiry
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
/**
 * Manual field update with source tracking
 * PATCH /api/candidates/:id/fields/:field
 */
async function updateCandidateFieldManuallyController(req, res) {
    try {
        const userId = 'test-user-id'; // TODO: Get from auth middleware
        const { id, field } = req.params;
        const { value } = req.body;
        if (!id || !field) {
            return res.status(400).json({ error: 'Candidate ID and field name are required' });
        }
        if (value === undefined || value === null) {
            return res.status(400).json({ error: 'Field value is required' });
        }
        // Import progressive completion service
        const { updateFieldManually, updateMissingFields } = await Promise.resolve().then(() => __importStar(require('../services/progressiveDataCompletionService')));
        // Update field manually (highest priority)
        await updateFieldManually(id, field, value, userId);
        // Recalculate missing fields
        await updateMissingFields(id);
        // Get updated candidate
        const updatedCandidate = await (0, candidateService_1.getCandidateById)(id, userId);
        // Map passport_normalized to passport for frontend compatibility
        const mappedCandidate = updatedCandidate ? {
            ...updatedCandidate,
            passport: updatedCandidate.passport_normalized || null,
        } : null;
        res.json({
            success: true,
            candidate: mappedCandidate,
            message: `Field "${field}" updated manually`,
        });
    }
    catch (error) {
        console.error('Error updating field manually:', error);
        if (error.message?.includes('not found')) {
            res.status(404).json({ error: 'Candidate not found' });
        }
        else {
            res.status(500).json({ error: error.message || 'Failed to update field' });
        }
    }
}
/**
 * Get missing fields for a candidate
 * GET /api/candidates/:id/missing-fields
 */
async function getMissingFieldsController(req, res) {
    try {
        const userId = 'test-user-id'; // TODO: Get from auth middleware
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        // Get candidate
        const candidate = await (0, candidateService_1.getCandidateById)(id, userId);
        // Calculate missing fields
        const { calculateMissingFields, EXCEL_BROWSER_FIELDS } = await Promise.resolve().then(() => __importStar(require('../services/progressiveDataCompletionService')));
        const missingFields = calculateMissingFields(candidate);
        // Get field sources
        const fieldSources = candidate.field_sources || {};
        // Map missing fields with their source info
        const missingFieldsWithInfo = missingFields.map(field => ({
            field,
            label: EXCEL_BROWSER_FIELDS[field] || field,
            source: fieldSources[field]?.source || null,
            canBeManuallyUpdated: true,
            hint: fieldSources[field]?.source === 'manual'
                ? 'Manually updated - will not be overwritten'
                : fieldSources[field]?.source
                    ? `Awaiting document (source: ${fieldSources[field].source})`
                    : 'Can be manually updated',
        }));
        res.json({
            missing_fields: missingFields,
            missing_fields_with_info: missingFieldsWithInfo,
            total_missing: missingFields.length,
        });
    }
    catch (error) {
        console.error('Error getting missing fields:', error);
        if (error.message?.includes('not found')) {
            res.status(404).json({ error: 'Candidate not found' });
        }
        else {
            res.status(500).json({ error: error.message || 'Failed to get missing fields' });
        }
    }
}
/**
 * POST /api/candidates/:id/merge
 * Merge another candidate (loserId in body) into this candidate (:id = winner).
 *
 * Body:
 *   - loserId       {string}  required  — candidate to be soft-deleted
 *   - strategy      {string}  optional  — 'winner_wins' | 'loser_wins' | 'manual' (default: winner_wins)
 *   - fieldOverrides {object} optional  — explicit field values (only with strategy='manual')
 *   - reason        {string}  optional  — human-readable explanation
 */
async function mergeCandidateController(req, res) {
    try {
        const winnerId = req.params.id;
        const { loserId, strategy, fieldOverrides, reason } = req.body;
        if (!winnerId)
            return res.status(400).json({ error: 'Winner candidate ID required in URL' });
        if (!loserId)
            return res.status(400).json({ error: 'loserId required in request body' });
        if (winnerId === loserId)
            return res.status(400).json({ error: 'Cannot merge a candidate with itself' });
        const allowedStrategies = ['winner_wins', 'loser_wins', 'manual'];
        if (strategy && !allowedStrategies.includes(strategy)) {
            return res.status(400).json({ error: `strategy must be one of: ${allowedStrategies.join(', ')}` });
        }
        const { mergeCandidates } = await Promise.resolve().then(() => __importStar(require('../services/mergeCandidateService')));
        const result = await mergeCandidates(winnerId, loserId, {
            strategy: strategy || 'winner_wins',
            fieldOverrides: strategy === 'manual' ? fieldOverrides : undefined,
            reviewReasons: reason ? [reason] : undefined,
            mergedBy: 'admin',
        });
        res.json({ success: true, merge: result });
    }
    catch (error) {
        console.error('Error merging candidates:', error);
        if (error.message?.includes('not found')) {
            res.status(404).json({ error: error.message });
        }
        else {
            res.status(500).json({ error: error.message || 'Failed to merge candidates' });
        }
    }
}
/**
 * GET /api/candidates/:id/merges
 * Returns the merge audit history for a candidate (as winner or former loser).
 */
async function getCandidateMergeHistoryController(req, res) {
    try {
        const { id } = req.params;
        if (!id)
            return res.status(400).json({ error: 'Candidate ID required' });
        const { getCandidateMergeHistory } = await Promise.resolve().then(() => __importStar(require('../services/mergeCandidateService')));
        const history = await getCandidateMergeHistory(id);
        res.json({ merges: history });
    }
    catch (error) {
        console.error('Error fetching merge history:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch merge history' });
    }
}
/**
 * GET /api/candidates/matching-metrics
 *
 * Returns governance-level matching health statistics for the admin dashboard:
 *   - Total active candidates
 *   - Total merges performed
 *   - Merge breakdown by strategy
 *   - Confidence score distribution (high / medium / low / unset)
 *   - Most common match signals across the candidate table
 */
async function getMatchingMetricsController(_req, res) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        // Run all queries in parallel
        const [{ count: totalActive }, { data: merges }, { data: confidenceRows },] = await Promise.all([
            db.from('candidates').select('*', { count: 'exact', head: true }).neq('status', 'Deleted'),
            db.from('candidate_merges').select('merge_strategy, merged_by, created_at'),
            db.from('candidates')
                .select('last_match_confidence, last_match_signals')
                .neq('status', 'Deleted')
                .not('last_match_confidence', 'is', null),
        ]);
        // Merge breakdown by strategy
        const mergesByStrategy = {};
        const mergesByMergedBy = {};
        for (const m of (merges ?? [])) {
            mergesByStrategy[m.merge_strategy] = (mergesByStrategy[m.merge_strategy] ?? 0) + 1;
            const actor = m.merged_by === 'system' ? 'system (auto)' : 'admin';
            mergesByMergedBy[actor] = (mergesByMergedBy[actor] ?? 0) + 1;
        }
        // Confidence score distribution
        const confidenceBuckets = { high: 0, medium: 0, low: 0 };
        const signalCounts = {};
        for (const row of (confidenceRows ?? [])) {
            const conf = parseFloat(row.last_match_confidence);
            if (conf >= 0.85)
                confidenceBuckets.high++;
            else if (conf >= 0.65)
                confidenceBuckets.medium++;
            else
                confidenceBuckets.low++;
            if (row.last_match_signals && typeof row.last_match_signals === 'object') {
                for (const signal of Object.keys(row.last_match_signals)) {
                    signalCounts[signal] = (signalCounts[signal] ?? 0) + 1;
                }
            }
        }
        // Name-only match count (manually reviewed, confidence < 0.85)
        const nameOnlyCount = (confidenceRows ?? []).filter((r) => {
            const sigs = r.last_match_signals;
            return sigs && Object.keys(sigs).length === 1 && 'name' in sigs;
        }).length;
        res.json({
            totals: {
                activeCandidates: totalActive ?? 0,
                totalMerges: merges?.length ?? 0,
            },
            merges: {
                byStrategy: mergesByStrategy,
                byActor: mergesByMergedBy,
            },
            confidence: {
                high: confidenceBuckets.high,
                medium: confidenceBuckets.medium,
                low: confidenceBuckets.low,
                nameOnlyManualReview: nameOnlyCount,
                withConfidenceData: (confidenceRows ?? []).length,
            },
            signals: signalCounts,
        });
    }
    catch (error) {
        console.error('Error fetching matching metrics:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch matching metrics' });
    }
}
