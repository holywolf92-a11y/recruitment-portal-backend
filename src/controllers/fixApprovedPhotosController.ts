import { Request, Response } from 'express';
import { supabaseAdminClient } from '../config/database';

/**
 * Fix candidates who have approved photos but missing profile_photo_url
 * This happens when photos were approved before the auto-update feature was deployed
 */
export async function fixApprovedPhotos(req: Request, res: Response) {
  try {
    console.log('[FixApprovedPhotos] Starting fix...');
    const db = supabaseAdminClient();

    // Find all verified photo documents
    const { data: photoDocs, error: fetchError } = await db
      .from('candidate_documents')
      .select(`
        id,
        file_name,
        file_url,
        category,
        verification_status,
        candidate_id
      `)
      .eq('category', 'photos')
      .eq('verification_status', 'verified')
      .not('candidate_id', 'is', null);

    if (fetchError) {
      console.error('[FixApprovedPhotos] Error fetching photos:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch photo documents' });
    }

    if (!photoDocs || photoDocs.length === 0) {
      return res.json({
        success: true,
        message: 'No verified photo documents found',
        fixed: 0,
        alreadySet: 0,
        total: 0,
      });
    }

    console.log(`[FixApprovedPhotos] Found ${photoDocs.length} verified photo document(s)`);

    let fixedCount = 0;
    let alreadySetCount = 0;
    const fixedCandidates = [];

    for (const doc of photoDocs) {
      // Get candidate info
      const { data: candidate, error: candidateError } = await db
        .from('candidates')
        .select('id, name, profile_photo_url, photo_received')
        .eq('id', doc.candidate_id)
        .single();

      if (candidateError || !candidate) {
        console.error(`[FixApprovedPhotos] No candidate found for doc ${doc.id}`);
        continue;
      }

      // Skip if already set
      if (candidate.profile_photo_url) {
        console.log(`[FixApprovedPhotos] ${candidate.name} - already has photo URL`);
        alreadySetCount++;
        continue;
      }

      // Update candidate with photo URL
      console.log(`[FixApprovedPhotos] Fixing ${candidate.name}...`);
      const { data: updated, error: updateError } = await db
        .from('candidates')
        .update({
          profile_photo_url: doc.file_url,
          photo_received: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidate.id)
        .select('id, name, profile_photo_url')
        .single();

      if (updateError) {
        console.error(`[FixApprovedPhotos] Failed to update ${candidate.name}:`, updateError);
        continue;
      }

      console.log(`[FixApprovedPhotos] ✓ Fixed ${candidate.name}`);
      fixedCount++;
      fixedCandidates.push({
        id: updated.id,
        name: updated.name,
        photo_url: updated.profile_photo_url,
        document: doc.file_name,
      });
    }

    console.log(`[FixApprovedPhotos] Summary: Fixed ${fixedCount}, Already set ${alreadySetCount}, Total ${photoDocs.length}`);

    res.json({
      success: true,
      message: `Fixed ${fixedCount} candidate(s)`,
      fixed: fixedCount,
      alreadySet: alreadySetCount,
      total: photoDocs.length,
      candidates: fixedCandidates,
    });
  } catch (error: any) {
    console.error('[FixApprovedPhotos] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to fix approved photos' });
  }
}
