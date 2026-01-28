// Script: list-candidate-photos.js
// Purpose: List files under documents/candidate_photos/<candidateId>

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const candidateId = process.argv[2] || '947c0a17-4842-434b-938f-8c657c55370c';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
  const path = `candidate_photos/${candidateId}`;
  console.log(`🔍 Listing objects at: documents/${path}`);
  try {
    const { data, error } = await supabase.storage.from('documents').list(path);
    if (error) {
      console.error('❌ Supabase storage error:', error);
      process.exit(1);
    }
    if (!data || data.length === 0) {
      console.log('ℹ️ No objects found in that folder.');
      process.exit(0);
    }
    console.log(`✅ Found ${data.length} object(s):`);
    data.forEach(item => console.log('-', item.name || item.path || JSON.stringify(item)));
    process.exit(0);
  } catch (e) {
    console.error('❌ Unexpected error:', e);
    process.exit(1);
  }
})();
