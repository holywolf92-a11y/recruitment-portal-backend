// Script: audit-profile-photos.js
// Purpose: Find and null out any candidate profile_photo_url ending with .pdf, log affected candidate IDs and names

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
  console.log('🔍 Auditing candidates with .pdf profile photos...');
  const { data, error } = await supabase
    .from('candidates')
    .select('id, name, profile_photo_url')
    .ilike('profile_photo_url', '%.pdf');

  if (error) {
    console.error('❌ Error fetching candidates:', error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('✅ No candidates with .pdf profile_photo_url found.');
    process.exit(0);
  }

  console.log(`Found ${data.length} candidate(s) with .pdf profile_photo_url:`);
  data.forEach(c => {
    console.log(`- ${c.id} | ${c.name} | ${c.profile_photo_url}`);
  });

  // Null out the profile_photo_url for these candidates
  const ids = data.map(c => c.id);
  const { error: updateError } = await supabase
    .from('candidates')
    .update({ profile_photo_url: null })
    .in('id', ids);

  if (updateError) {
    console.error('❌ Error updating candidates:', updateError.message);
    process.exit(1);
  }

  console.log('✅ Nullified profile_photo_url for affected candidates.');
  process.exit(0);
})();
