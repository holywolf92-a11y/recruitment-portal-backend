"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quickApproveCandidateDocument = quickApproveCandidateDocument;
const database_1 = require("../config/database");
const documentCategories_1 = require("../config/documentCategories");
/**
 * Quick approve a pending document (pending_ai or needs_review)
 * This is a simplified approval for documents that just need human confirmation
 * without the full override process (no password required for pending documents)
 */
async function quickApproveCandidateDocument(req, res) {
    try {
        const { id } = req.params;
        const authUser = req.user;
        const userId = authUser?.id || 'system';
        if (!id) {
            return res.status(400).json({ error: 'Document ID is required' });
        }
        const db = (0, database_1.supabaseAdminClient)();
        // Fetch the document
        const { data: document, error: fetchError } = await db
            .from('candidate_documents')
            .select('*')
            .eq('id', id)
            .single();
        if (fetchError || !document) {
            return res.status(404).json({ error: 'Document not found' });
        }
        // Only allow quick approve for pending/needs_review documents
        const allowedStatuses = ['pending_ai', 'needs_review'];
        if (!allowedStatuses.includes(document.verification_status)) {
            return res.status(400).json({
                error: `Cannot quick approve document with status "${document.verification_status}". Only "pending_ai" and "needs_review" documents can be quick approved. For rejected documents, use the full override process.`,
            });
        }
        // Update document to verified
        const now = new Date().toISOString();
        // Prepare update data - only set overridden_by if we have a valid UUID
        const updateData = {
            verification_status: documentCategories_1.VERIFICATION_STATUS.VERIFIED,
            verification_source: 'manual_review', // Allowed values: ai_verification, admin_override, manual_review
            override_reason: 'Quick approved by admin',
            overridden_at: now,
            verification_completed_at: now,
            updated_at: now,
        };
        // Only set overridden_by if we have a valid user ID (not 'system')
        if (authUser?.id && authUser.id !== 'system') {
            updateData.overridden_by = authUser.id;
        }
        const { data: updatedDocument, error: updateError } = await db
            .from('candidate_documents')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();
        if (updateError || !updatedDocument) {
            return res.status(500).json({ error: `Failed to approve document: ${updateError?.message}` });
        }
        console.log(`[QuickApprove] Document ${id} approved by ${userId}`);
        // If this is a photo document, update the candidate's profile photo ONLY for image files
        if (updatedDocument.category === 'photos' && updatedDocument.candidate_id && updatedDocument.storage_path) {
            const mimeType = (updatedDocument.mime_type || '').toLowerCase();
            const isImage = mimeType.startsWith('image/');
            if (!isImage) {
                console.warn(`[QuickApprove] Skipping profile photo update for non-image photo document ${updatedDocument.id} (mime: ${mimeType || 'unknown'})`);
            }
            else {
                console.log(`[QuickApprove] Setting profile photo for candidate ${updatedDocument.candidate_id}`);
                const bucket = updatedDocument.storage_bucket || 'documents';
                const { error: photoUpdateError } = await db
                    .from('candidates')
                    .update({
                    profile_photo_bucket: bucket,
                    profile_photo_path: updatedDocument.storage_path,
                    profile_photo_url: null,
                    photo_received: true,
                    updated_at: now,
                })
                    .eq('id', updatedDocument.candidate_id);
                if (photoUpdateError) {
                    console.error(`[QuickApprove] Failed to update candidate profile photo:`, photoUpdateError);
                    // Don't fail the whole operation, just log the error
                }
                else {
                    console.log(`[QuickApprove] ✓ Profile photo updated for candidate ${updatedDocument.candidate_id} - path: ${updatedDocument.storage_path}`);
                }
            }
        }
        res.json({
            success: true,
            document: updatedDocument,
            message: 'Document approved successfully',
        });
    }
    catch (error) {
        console.error('[QuickApprove] Error approving document:', error);
        res.status(500).json({ error: error.message || 'Failed to approve document' });
    }
}
