/**
 * Fix Profile Photo URL if it points to a PDF (CV) instead of image.
 * Usage: node fix-profile-photo-pdf.js FL-2026-897
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run(candidateCode) {
  if (!candidateCode) {
    console.error('❌ Candidate code required. Example: FL-2026-897');
    process.exit(1);
  }

  const { data: candidate, error } = await supabase
    .from('candidates')
    .select('id, candidate_code, name, profile_photo_url, profile_photo_bucket, profile_photo_path')
    .eq('candidate_code', candidateCode)
    .maybeSingle();

  if (error) {
    console.error('❌ Failed to fetch candidate:', error.message);
    process.exit(1);
  }

  if (!candidate) {
    console.error('❌ Candidate not found:', candidateCode);
    process.exit(1);
  }

  const url = (candidate.profile_photo_url || '').toString();
  const isPdf = url.toLowerCase().includes('.pdf');

  console.log(`Candidate: ${candidate.candidate_code} - ${candidate.name}`);
  console.log('Current profile_photo_url:', url || '(empty)');

  if (!url || !isPdf) {
    console.log('✅ No PDF profile photo URL found. No changes needed.');
    return;
  }

  const { error: updateError } = await supabase
    .from('candidates')
    .update({
      profile_photo_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidate.id);

  if (updateError) {
    console.error('❌ Failed to clear profile_photo_url:', updateError.message);
    process.exit(1);
  }

  console.log('✅ Cleared PDF profile_photo_url. You can now re-extract or upload a proper profile photo.');
}

run(process.argv[2]);
