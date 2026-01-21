/**
 * Backfill candidate document flags based on existing candidate_documents
 * This script updates cv_received, passport_received, etc. flags for all candidates
 * based on their actual documents in the candidate_documents table
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function backfillDocumentFlags() {
  console.log('\n🔄 Backfilling Candidate Document Flags');
  console.log('========================================\n');

  try {
    // Get all candidates
    const { data: candidates, error: candidatesError } = await supabase
      .from('candidates')
      .select('id, name');

    if (candidatesError) {
      throw new Error(`Failed to fetch candidates: ${candidatesError.message}`);
    }

    console.log(`📋 Found ${candidates.length} candidates\n`);

    let updated = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      // Get all verified documents for this candidate
      const { data: documents, error: docsError } = await supabase
        .from('candidate_documents')
        .select('category, verification_status')
        .eq('candidate_id', candidate.id)
        .in('verification_status', ['verified', 'needs_review']); // Include both verified and needs_review

      if (docsError) {
        console.error(`❌ Error fetching documents for ${candidate.name}:`, docsError.message);
        continue;
      }

      if (!documents || documents.length === 0) {
        skipped++;
        continue;
      }

      // Determine which flags to set based on document categories
      const updateFlags = {};
      const now = new Date().toISOString();

      for (const doc of documents) {
        const category = (doc.category || '').toLowerCase();

        if (category === 'cv_resume' || category === 'cv') {
          updateFlags.cv_received = true;
          updateFlags.cv_received_at = now;
        } else if (category === 'passport') {
          updateFlags.passport_received = true;
          updateFlags.passport_received_at = now;
        } else if (category === 'certificates' || category === 'certificate') {
          updateFlags.certificate_received = true;
          updateFlags.certificate_received_at = now;
        } else if (category === 'photos' || category === 'photo') {
          updateFlags.photo_received = true;
          updateFlags.photo_received_at = now;
        } else if (category === 'medical_reports' || category === 'medical') {
          updateFlags.medical_received = true;
          updateFlags.medical_received_at = now;
        }
      }

      if (Object.keys(updateFlags).length > 0) {
        const { error: updateError } = await supabase
          .from('candidates')
          .update(updateFlags)
          .eq('id', candidate.id);

        if (updateError) {
          console.error(`❌ Failed to update ${candidate.name}:`, updateError.message);
        } else {
          updated++;
          const flags = Object.keys(updateFlags).filter(k => k.endsWith('_received'));
          console.log(`✅ ${candidate.name}: ${flags.join(', ')}`);
        }
      } else {
        skipped++;
      }
    }

    console.log(`\n✅ Backfill Complete!`);
    console.log(`   Updated: ${updated} candidates`);
    console.log(`   Skipped: ${skipped} candidates (no documents)\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

backfillDocumentFlags();
