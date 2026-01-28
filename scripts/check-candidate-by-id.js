// Script: check-candidate-by-id.js
// Purpose: Fetch a candidate record by id and print id, name, profile_photo_url

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const candidateId = process.argv[2];

if (!candidateId) {
  console.error('Usage: node check-candidate-by-id.js <candidateId>');
  process.exit(1);
}

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
  console.log(`🔍 Fetching candidate ${candidateId}...`);
  const { data, error } = await supabase
    .from('candidates')
    .select('id, name, profile_photo_url')
    .eq('id', candidateId);

  if (error) {
    console.error('❌ Error fetching candidate:', error);
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
