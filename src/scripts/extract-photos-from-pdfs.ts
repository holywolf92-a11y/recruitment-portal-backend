/**
 * Extract profile photos from PDF documents and save as images
 * 
 * This script:
 * 1. Finds candidates with PDF profile photos (other_documents/*.pdf)
 * 2. Reclassifies those documents as 'photos' category
 * 3. Updates candidate profile_photo fields to point to them
 */

import { supabaseAdminClient } from '../config/database';

async function extractPhotosFromPDFs() {
  const db = supabaseAdminClient();

  try {
    console.log('[Extract Photos] Fetching candidates with PDF profile photos...');

    // Get candidates with profile_photo_url pointing to PDFs
    const { data: candidates, error: fetchError } = await db
      .from('candidates')
      .select('id, name, profile_photo_url, profile_photo_path')
      .not('profile_photo_url', 'is', null);

    if (fetchError) {
      console.error('[Extract Photos] Error fetching candidates:', fetchError);
      return { success: false, error: fetchError.message };
    }

    if (!candidates || candidates.length === 0) {
      console.log('[Extract Photos] No candidates found');
      return { success: true, extracted: 0 };
    }

    // Filter candidates with PDF profile photos
    const pdfCandidates = candidates.filter((c: any) => {
      const url = (c.profile_photo_url || '').toLowerCase();
      const path = (c.profile_photo_path || '').toLowerCase();
      return url.includes('.pdf') || path.includes('.pdf');
    });

    if (pdfCandidates.length === 0) {
      console.log('[Extract Photos] No PDF profile photos found');
      return { success: true, extracted: 0 };
    }

    console.log(`[Extract Photos] Found ${pdfCandidates.length} candidates with PDF photos`);

    let extracted = 0;
    const errors: any[] = [];

    for (const candidate of pdfCandidates) {
      try {
        console.log(`[Extract Photos] Processing ${candidate.name} (${candidate.id})...`);

        // Parse storage path from profile_photo_url or use profile_photo_path
        let storagePath = candidate.profile_photo_path;
        let storageUrl = candidate.profile_photo_url;
        
        if (!storagePath && candidate.profile_photo_url) {
          const url: string = candidate.profile_photo_url;
          const publicMarker = '/storage/v1/object/public/';
          const signMarker = '/storage/v1/object/sign/';
          if (url.includes(publicMarker)) {
            const rest = url.substring(url.indexOf(publicMarker) + publicMarker.length);
            const parts = rest.split('/');
            parts.shift(); // Remove bucket name
            storagePath = parts.join('/');
          } else if (url.includes(signMarker)) {
            const after = url.substring(url.indexOf(signMarker) + signMarker.length).split('?')[0];
            const parts = after.split('/');
            parts.shift(); // Remove bucket name
            storagePath = parts.join('/');
          }
        }

        if (!storagePath) {
          console.warn(`[Extract Photos] No storage path for ${candidate.name}`);
          continue;
        }

        // Find the document in candidate_documents
        const { data: docs, error: docsError } = await db
          .from('candidate_documents')
          .select('*')
          .eq('candidate_id', candidate.id)
          .ilike('storage_path', `%${storagePath.split('/').pop()}%`)
          .limit(1);

        if (docsError || !docs || docs.length === 0) {
          console.warn(`[Extract Photos] No document found for ${candidate.name}`);
          continue;
        }

        const doc = docs[0];

        // Update document category to 'photos'
        const { error: updateDocError } = await db
          .from('candidate_documents')
          .update({ 
            category: 'photos',
            verification_status: 'verified'
          })
          .eq('id', doc.id);

        if (updateDocError) {
          console.error(`[Extract Photos] Failed to update document for ${candidate.name}:`, updateDocError);
          errors.push({ candidate: candidate.name, error: 'Update doc failed' });
          continue;
        }

        // Update candidate with photo fields
        const { error: updateCandidateError } = await db
          .from('candidates')
          .update({
            profile_photo_path: doc.storage_path,
            profile_photo_url: doc.storage_url || storageUrl,
            profile_photo_bucket: doc.storage_bucket || 'documents',
            photo_received: true,
            photo_received_at: new Date().toISOString()
          })
          .eq('id', candidate.id);

        if (updateCandidateError) {
          console.error(`[Extract Photos] Failed to update candidate ${candidate.name}:`, updateCandidateError);
          errors.push({ candidate: candidate.name, error: 'Update candidate failed' });
          continue;
        }

        console.log(`[Extract Photos] ✓ Set photo for ${candidate.name}`);
        extracted++;

      } catch (err: any) {
        console.error(`[Extract Photos] Error processing ${candidate.name}:`, err);
        errors.push({ candidate: candidate.name, error: err.message });
      }
    }

    console.log(`[Extract Photos] Complete: ${extracted} photos extracted`);
    if (errors.length > 0) {
      console.log('[Extract Photos] Errors:', errors);
    }

    return { success: true, extracted, errors };

  } catch (err: any) {
    console.error('[Extract Photos] Fatal error:', err);
    return { success: false, error: err.message };
  }
}

// Run if executed directly
if (require.main === module) {
  extractPhotosFromPDFs()
    .then(result => {
      console.log('[Extract Photos] Result:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error('[Extract Photos] Fatal error:', err);
      process.exit(1);
    });
}

export { extractPhotosFromPDFs };
