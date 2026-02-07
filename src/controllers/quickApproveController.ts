import { Request, Response } from 'express';
import { supabaseAdminClient } from '../config/database';
import { VERIFICATION_STATUS } from '../config/documentCategories';
import { progressiveDataCompletionService } from '../services/progressiveDataCompletionService';
import crypto from 'crypto';
import fetch from 'node-fetch';

const PY_URL = (process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-portal-python-parser-production.up.railway.app') as string;
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET || 'dev-hmac-secret';

/**
 * Sign request body with HMAC-SHA256
 */
function signHmac(body: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

/**
 * Call Python AI service to extract identity fields from document
 */
async function extractIdentityFromDocument(
  fileContent: string,
  fileName: string,
  mimeType: string
): Promise<any> {
  try {
    const requestBody = JSON.stringify({
      file_content: fileContent,
      file_name: fileName,
      mime_type: mimeType,
      operation: 'categorize_document',
    });

    const signature = signHmac(requestBody);

    const response = await fetch(`${PY_URL}/categorize-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HMAC-Signature': signature,
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI service error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    return result;
  } catch (error: any) {
    console.error('[QuickApprove] Identity extraction failed:', error);
    return null;
  }
}

/**
 * Quick approve a pending document (pending_ai or needs_review)
 * This is a simplified approval for documents that just need human confirmation
 * without the full override process (no password required for pending documents)
 * 
 * UPDATED: Now also extracts identity fields and enriches candidate data
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

    // Step 1: Extract identity fields if not already present
    let extractedIdentity = document.identity_fields;
    
    if (!extractedIdentity && document.storage_bucket && document.storage_path) {
      console.log(`[QuickApprove] Extracting identity fields from document ${id}`);
      
      try {
        // Download document from storage
        const { data: fileData, error: downloadError } = await db.storage
          .from(document.storage_bucket)
          .download(document.storage_path);

        if (!downloadError && fileData) {
          const arrayBuffer = await (fileData as Blob).arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const base64Content = buffer.toString('base64');
          
          // Call AI service to extract identity
          const aiResult = await extractIdentityFromDocument(
            base64Content,
            document.file_name || 'document',
            document.mime_type || 'application/pdf'
          );

          if (aiResult?.extracted_identity) {
            extractedIdentity = {
              name: aiResult.extracted_identity.name || null,
              father_name: aiResult.extracted_identity.father_name || null,
              cnic: aiResult.extracted_identity.cnic || null,
              passport_no: aiResult.extracted_identity.passport_no || null,
              email: aiResult.extracted_identity.email || null,
              phone: aiResult.extracted_identity.phone || null,
              date_of_birth: aiResult.extracted_identity.date_of_birth || aiResult.extracted_identity.dob || null,
              nationality: aiResult.extracted_identity.nationality || null,
              passport_expiry: aiResult.extracted_identity.passport_expiry || aiResult.extracted_identity.expiry_date || null,
              issue_date: aiResult.extracted_identity.issue_date || null,
            };
            console.log(`[QuickApprove] ✓ Identity extracted: nationality=${extractedIdentity.nationality}`);
          }
        }
      } catch (error) {
        console.error(`[QuickApprove] Error extracting identity:`, error);
        // Continue without extraction - won't fail the approval
      }
    }

    // Update document to verified
    const now = new Date().toISOString();
    
    // Prepare update data - only set overridden_by if we have a valid UUID
    const updateData: any = {
      verification_status: VERIFICATION_STATUS.VERIFIED,
      verification_source: 'manual_review', // Allowed values: ai_verification, admin_override, manual_review
      override_reason: 'Quick approved by admin',
      overridden_at: now,
      verification_completed_at: now,
      updated_at: now,
    };
    
    // Add extracted identity fields if we have them
    if (extractedIdentity) {
      updateData.identity_fields = extractedIdentity;
    }
    
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
    
    // Step 2: Enrich candidate data with extracted identity fields
    if (updatedDocument.candidate_id && extractedIdentity) {
      try {
        console.log(`[QuickApprove] Enriching candidate ${updatedDocument.candidate_id} with identity from document`);
        
        // Use progressiveDataCompletionService to populate candidate fields based on document type
        const enrichmentResult = await progressiveDataCompletionService.enrichCandidateFromDocument(
          updatedDocument.candidate_id,
          updatedDocument,
          extractedIdentity
        );
        
        if (enrichmentResult) {
          console.log(`[QuickApprove] ✓ Candidate enriched:`, enrichmentResult);
        }
      } catch (error) {
        console.error(`[QuickApprove] Error enriching candidate:`, error);
        // Don't fail the approval if enrichment fails
      }
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
