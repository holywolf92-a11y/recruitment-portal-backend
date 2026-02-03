const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

console.log('🔍 Checking Maryam job...\n');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

sb.from('parsing_jobs')
  .select('id, status, created_at')
  .eq('id', 'a0408194-c772-43ef-8fb2-6334c42eeec1')
  .then(({ data, error }) => {
    if (error) {
      console.log('❌ Error:', error.message);
    } else if (data && data.length > 0) {
      console.log('✅ Job found!');
      console.log('Status:', data[0].status);
      console.log('Created:', data[0].created_at);
    } else {
      console.log('❌ Job not found');
    }
    process.exit(0);
  })
  .catch(err => {
    console.log('❌ Exception:', err.message);
    process.exit(0);
  });

setTimeout(() => {
  console.log('❌ Timeout');
  process.exit(0);
}, 5000);

