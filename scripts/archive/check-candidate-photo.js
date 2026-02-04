// Script: check-candidate-photo.js
// Purpose: Fetch candidate's profile_photo_url by id

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const candidateId = '947c0a17-4842-434b-938f-8c657c55370c';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
  console.log(`🔍 Checking candidate ${candidateId}...`);
  const { data, error } = await supabase
    .from('candidates')
    .select('id, name, profile_photo_url')
    .eq('id', candidateId);

  if (error) {
    console.error('❌ Error fetching candidate:', error.message || error);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('ℹ️ Candidate not found');
    process.exit(0);
  }

  console.log('✅ Candidate record:');
  console.log(JSON.stringify(data[0], null, 2));
  process.exit(0);
})();
