// Script: check-documents-bucket.js
// Purpose: Attempt to list objects in the 'documents' bucket and report results

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
  console.log('🔍 Checking objects in bucket "documents"...');
  try {
    const { data, error } = await supabase
      .storage
      .from('documents')
      .list();

    if (error) {
      console.error('❌ Supabase storage error:', error);
      process.exit(1);
    }

    console.log('✅ List result:', data && data.length ? `${data.length} objects` : 'no objects');
    if (data && data.length) data.forEach(item => console.log('-', item.name || item.path || JSON.stringify(item)));
    process.exit(0);
  } catch (e) {
    console.error('❌ Unexpected error:', e);
    process.exit(1);
  }
})();
