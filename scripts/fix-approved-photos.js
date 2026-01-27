/**
 * Fix candidates who have approved photos but missing profile_photo_url
 * This happens when photos were approved before the auto-update feature was deployed
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

async function fixApprovedPhotos() {
  console.log('🔍 Finding candidates with approved photos but no profile_photo_url...\n');

  // Find all verified photo documents where candidate has no profile_photo_url
  const { data: photoDocs, error: fetchError } = await supabase
    .from('candidate_documents')
    .select(`
      id,
      file_name,
      file_url,
      category,
      verification_status,
      candidate_id,
      candidates (
        id,
        name,
        profile_photo_url,
        photo_received
      )
    `)
    .eq('category', 'photos')
    .eq('verification_status', 'verified')
    .not('candidate_id', 'is', null);

  if (fetchError) {
    console.error('❌ Error fetching photo documents:', fetchError);
    return;
  }

  if (!photoDocs || photoDocs.length === 0) {
    console.log('✅ No photo documents found');
    return;
  }

  console.log(`📸 Found ${photoDocs.length} verified photo document(s)\n`);

  let fixedCount = 0;
  let alreadySetCount = 0;

  for (const doc of photoDocs) {
    const candidate = doc.candidates;
    
    if (!candidate) {
      console.log(`⚠️  Document ${doc.id} has no linked candidate`);
      continue;
    }

    console.log(`\n👤 ${candidate.name}`);
    console.log(`   Document: ${doc.file_name}`);
    console.log(`   Photo URL: ${doc.file_url}`);
    console.log(`   Current profile_photo_url: ${candidate.profile_photo_url || '(empty)'}`);

    // Check if profile_photo_url is already set
    if (candidate.profile_photo_url) {
      console.log(`   ✅ Already set - skipping`);
      alreadySetCount++;
      continue;
    }

    // Update candidate with photo URL
    console.log(`   🔄 Updating candidate...`);
    const { data: updated, error: updateError } = await supabase
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
      console.log(`   ❌ Failed to update:`, updateError.message);
      continue;
    }

    console.log(`   ✅ Fixed! Profile photo URL set`);
    fixedCount++;
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   Fixed: ${fixedCount} candidate(s)`);
  console.log(`   Already set: ${alreadySetCount} candidate(s)`);
  console.log(`   Total processed: ${photoDocs.length} photo document(s)`);
  console.log('='.repeat(60));

  if (fixedCount > 0) {
    console.log('\n✅ Photos should now appear in candidate cards and CVs!');
    console.log('💡 Refresh your browser to see the changes.');
  }
}

fixApprovedPhotos()
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Script failed:', err);
    process.exit(1);
  });
