// Script: link-usman-photo.js
// Purpose: Find candidates named 'MUHAMMAD USMAN' and update null/.pdf profile_photo_url to the known JPEG URL

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// The JPEG URL found in logs
const jpegUrl = 'https://hncvsextwmvjydcukdwx.supabase.co/storage/v1/object/public/documents/candidate_photos/947c0a17-4842-434b-938f-8c657c55370c/profile.jpeg';

(async () => {
  console.log('🔍 Searching for candidates named "MUHAMMAD USMAN"...');
  const { data, error } = await supabase
    .from('candidates')
    .select('id, name, profile_photo_url')
    .ilike('name', '%MUHAMMAD USMAN%')
    .limit(50);

  if (error) {
    console.error('❌ Error querying candidates:', error);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('ℹ️ No candidates found with that name.');
    process.exit(0);
  }

  console.log(`Found ${data.length} candidate(s):`);
  for (const c of data) {
    console.log(`- ${c.id} | ${c.name} | profile_photo_url=${c.profile_photo_url}`);
  }

  // Filter candidates to update: profile_photo_url is null OR ends with .pdf
  const toUpdate = data.filter(c => !c.profile_photo_url || c.profile_photo_url.toLowerCase().endsWith('.pdf'));

  if (toUpdate.length === 0) {
    console.log('✅ No candidates need updating.');
    process.exit(0);
  }

  console.log(`Updating ${toUpdate.length} candidate(s) with JPEG URL...`);
  const ids = toUpdate.map(c => c.id);
  const { error: updateError } = await supabase
    .from('candidates')
    .update({ profile_photo_url: jpegUrl })
    .in('id', ids);

  if (updateError) {
    console.error('❌ Error updating candidates:', updateError);
    process.exit(1);
  }

  console.log('✅ Successfully updated candidate(s):');
  toUpdate.forEach(c => console.log('-', c.id));
  process.exit(0);
})();
