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
  const path = 'candidate_photos/947c0a17-4842-434b-938f-8c657c55370c/profile.jpeg';
  console.log('Generating signed URL for:', path);
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 60);
  if (error) {
    console.error('Error creating signed URL:', error);
    process.exit(1);
  }
  console.log('Signed URL:', data.signedUrl);
})();
