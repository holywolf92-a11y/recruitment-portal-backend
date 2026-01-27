import { Request, Response } from 'express';
import { supabaseAdminClient } from '../config/database';
import { VERIFICATION_STATUS } from '../config/documentCategories';

/**
 * Quick approve a pending document (pending_ai or needs_review)
 * This is a simplified approval for documents that just need human confirmation
 * without the full override process (no password required for pending documents)
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
    const { data: updatedDocument, error: updateError } = await db
      .from('candidate_documents')
      .update({
        verification_status: VERIFICATION_STATUS.VERIFIED,
        verification_source: 'manual_approval',
        override_reason: 'Quick approved by admin',
        overridden_by: userId,
        overridden_at: now,
        verification_completed_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError || !updatedDocument) {
      return res.status(500).json({ error: `Failed to approve document: ${updateError?.message}` });
    }

    console.log(`[QuickApprove] Document ${id} approved by ${userId}`);

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
