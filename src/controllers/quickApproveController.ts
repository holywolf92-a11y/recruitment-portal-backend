import { Request, Response } from 'express';
import { supabaseAdminClient } from '../config/database';
import { VERIFICATION_STATUS } from '../config/documentCategories';

/**
 * Quick approve a pending document (pending_ai or needs_review)
 * 
 * This endpoint marks documents as verified and triggers the existing
 * enrichment pipeline to populate candidate data from extracted identity.
 * 
 * If the document doesn't have extracted_identity_json yet, it should be
 * reprocessed through the verification worker instead of using quick approve.
 */
export async function quickApproveCandidateDocument(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const authUser = (req as any).user;
    const userId = authUser?.id || 'system';

    if (!id) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    const db = supabaseAdminClient();

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
    
    // Prepare update data
    const updateData: any = {
      verification_status: VERIFICATION_STATUS.VERIFIED,
      verification_source: 'manual_review',
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
    
    // Step 2: Enrich candidate data using existing service if identity exists
    if (updatedDocument.candidate_id && updatedDocument.extracted_identity_json) {
      try {
        console.log(`[QuickApprove] Enriching candidate ${updatedDocument.candidate_id} with existing identity data`);
        
        // Use existing progressiveDataCompletionService
        const { enrichCandidateData } = await import('../services/progressiveDataCompletionService');
        
        // Determine source type based on document category (for tracking in field_sources)
        // With fallback chain, order doesn't matter - we only fill missing fields
        let documentSource: 'cv' | 'passport' | 'driving_license' | 'medical' | 'certificate' | 'other' = 'other';
        const category = updatedDocument.category?.toLowerCase();
        
        if (category === 'cv_resume' || category === 'cv') {
          documentSource = 'cv';
        } else if (category === 'passport') {
          documentSource = 'passport';
        } else if (category === 'cnic') {
          documentSource = 'passport'; // CNIC is identity document like passport
        } else if (category === 'driving_license') {
          documentSource = 'driving_license';
                } else if (category === 'degree' || category === 'education' || category?.includes('university') || category?.includes('school')) {
                  documentSource = 'certificate'; // Education docs as fallback for nationality
        } else if (category?.includes('medical')) {
          documentSource = 'medical';
        } else if (category?.includes('certif')) {
          documentSource = 'certificate';
        }
        
        // Map extracted identity to enrichment format
        const identity = updatedDocument.extracted_identity_json;
        const enrichmentData: Record<string, any> = {};
        
        if (identity.name) enrichmentData.name = identity.name;
        if (identity.father_name) enrichmentData.father_name = identity.father_name;
        if (identity.cnic) enrichmentData.cnic = identity.cnic;
        if (identity.passport_no) enrichmentData.passport_no = identity.passport_no;
        if (identity.nationality) enrichmentData.nationality = identity.nationality;
        if (identity.date_of_birth) enrichmentData.date_of_birth = identity.date_of_birth;
        if (identity.email) enrichmentData.email = identity.email;
        if (identity.phone) enrichmentData.phone = identity.phone;
        
        // Call existing enrichment service
        await enrichCandidateData(
          updatedDocument.candidate_id,
          enrichmentData,
          documentSource,
          updatedDocument.document_type || 'other',
          updatedDocument.id
        );
        
        console.log(`[QuickApprove] ✓ Candidate enriched using existing service`);
      } catch (error) {
        console.error(`[QuickApprove] Error enriching candidate:`, error);
        // Don't fail the approval if enrichment fails
      }
    } else if (updatedDocument.candidate_id && !updatedDocument.extracted_identity_json) {
      console.warn(`[QuickApprove] Document ${id} approved but has no extracted_identity_json - identity extraction may have been skipped`);
    }

    // If this is a photo document, update the candidate's profile photo ONLY for image files
    if (updatedDocument.category === 'photos' && updatedDocument.candidate_id && updatedDocument.storage_path) {
      const mimeType = (updatedDocument.mime_type || '').toLowerCase();
      const isImage = mimeType.startsWith('image/');

      if (!isImage) {
        console.warn(`[QuickApprove] Skipping profile photo update for non-image photo document ${updatedDocument.id} (mime: ${mimeType || 'unknown'})`);
      } else {
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
        } else {
          console.log(`[QuickApprove] ✓ Profile photo updated for candidate ${updatedDocument.candidate_id} - path: ${updatedDocument.storage_path}`);
        }
      }
    }

    res.json({
      success: true,
      document: updatedDocument,
      message: 'Document approved successfully',
    });
  } catch (error: any) {
    console.error('[QuickApprove] Error approving document:', error);
    res.status(500).json({ error: error.message || 'Failed to approve document' });
  }
}
