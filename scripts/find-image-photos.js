// Script: find-image-photos.js
// Purpose: Find candidates with image profile_photo_url (jpeg/jpg/png/webp/gif)

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
  console.log('🔍 Searching for candidates with image profile_photo_url...');
  const orQuery = [
    "profile_photo_url.ilike.%25.jpeg",
    "profile_photo_url.ilike.%25.jpg",
    "profile_photo_url.ilike.%25.png",
    "profile_photo_url.ilike.%25.webp",
    "profile_photo_url.ilike.%25.gif"
  ].join(',');

  const { data, error } = await supabase
    .from('candidates')
    .select('id, name, profile_photo_url, created_at')
    .or(orQuery)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('❌ Error querying candidates:', error);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('✅ No candidates found with image profile_photo_url.');
    process.exit(0);
  }

  console.log(`Found ${data.length} candidate(s):`);
  data.forEach(c => {
    console.log(`- ${c.id} | ${c.name} | ${c.profile_photo_url} | created_at=${c.created_at}`);
  });
  process.exit(0);
})();
