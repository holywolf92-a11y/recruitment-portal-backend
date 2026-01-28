import { Router } from 'express';
import { supabaseAdminClient } from '../config/database';

const router = Router();

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

    const db = supabaseAdminClient();

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

    const isPdf =
      (doc.mime_type || '').toLowerCase() === 'application/pdf' ||
      (doc.file_name || '').toLowerCase().endsWith('.pdf') ||
      (doc.storage_path || '').toLowerCase().endsWith('.pdf');
    if (isPdf) {
      return res.status(400).json({
        error: 'Selected document is a PDF. Use /api/documents/candidates/:candidateId/extract-photo-ai to extract a real image from the PDF.',
      });
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
        // Prefer stable storage refs; signed URLs expire.
        profile_photo_url: doc.storage_url || null,
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
      message: 'Profile photo set from document successfully',
      document: doc
    });

  } catch (error: any) {
    console.error('Error extracting photo:', error);
    res.status(500).json({ error: error.message || 'Failed to extract photo' });
  }
});

export default router;
