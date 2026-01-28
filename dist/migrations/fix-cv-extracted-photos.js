"use strict";
/**
 * Migration: Clear profile_photo_url for candidates where it points to CV-extracted images
 *
 * Problem: CV parser was setting profile_photo_url to the CV document's storage path
 * (e.g., documents/candidate_photos/{CV_UUID}/profile.jpeg)
 * This made the UI display the CV as the profile photo instead of showing initials.
 *
 * Solution: Set profile_photo_url to NULL for any candidate where it contains a CV document UUID.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixCVExtractedPhotos = fixCVExtractedPhotos;
const database_1 = require("../config/database");
async function fixCVExtractedPhotos() {
    const db = (0, database_1.supabaseAdminClient)();
    try {
        console.log('[Migration] Fetching candidates with potential CV-extracted photos...');
        // Get all candidates with profile_photo_url
        const { data: candidates, error: fetchError } = await db
            .from('candidates')
            .select('id, name, profile_photo_url')
            .not('profile_photo_url', 'is', null);
        if (fetchError) {
            console.error('[Migration] Error fetching candidates:', fetchError);
            return { success: false, error: fetchError.message };
        }
        if (!candidates || candidates.length === 0) {
            console.log('[Migration] No candidates found with profile_photo_url');
            return { success: true, fixed: 0, message: 'No candidates to fix' };
        }
        // Filter candidates with CV-extracted images
        const cvExtractedCandidates = candidates.filter((c) => {
            const url = (c.profile_photo_url || '').toLowerCase();
            // Pattern: documents/candidate_photos/{UUID}/ where UUID is 36 chars (UUID format)
            return url.includes('documents/candidate_photos/') &&
                /candidate_photos\/[a-f0-9\-]{36}\//.test(url);
        });
        if (cvExtractedCandidates.length === 0) {
            console.log('[Migration] No candidates with CV-extracted photos found');
            return { success: true, fixed: 0, message: 'No CV-extracted photos to fix' };
        }
        console.log(`[Migration] Found ${cvExtractedCandidates.length} candidates with CV-extracted photos`);
        console.log('[Migration] Candidates to fix:', cvExtractedCandidates.map((c) => `${c.name} (${c.id})`));
        // Clear profile_photo_url for these candidates
        const candidateIds = cvExtractedCandidates.map((c) => c.id);
        const { error: updateError } = await db
            .from('candidates')
            .update({ profile_photo_url: null })
            .in('id', candidateIds);
        if (updateError) {
            console.error('[Migration] Error updating candidates:', updateError);
            return { success: false, error: updateError.message };
        }
        console.log(`[Migration] ✓ Successfully cleared profile_photo_url for ${candidateIds.length} candidates`);
        return {
            success: true,
            fixed: candidateIds.length,
            candidates: cvExtractedCandidates.map((c) => ({ id: c.id, name: c.name }))
        };
    }
    catch (err) {
        console.error('[Migration] Error:', err);
        return { success: false, error: err.message };
    }
}
