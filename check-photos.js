const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkPhotos() {
  const cids = [
    { id: 'cd9ea373-5a33-43c4-a5d6-66b3604bb351', name: 'Sharafat' },
    { id: '6685d2a8-11da-4775-a6c8-83f6d3a975a4', name: 'Abdullah' }
  ];

  for (const candidate of cids) {
    try {
      const { data, error } = await sb.storage.from('documents').list(`candidate_photos/${candidate.id}`);
      console.log(`\n${candidate.name} (${candidate.id}):`);
      if (error) {
        console.log('  Storage error:', error.message);
      } else {
        console.log(`  Files: ${data?.length || 0}`);
        data?.forEach(f => console.log(`    - ${f.name}`));
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
}

checkPhotos().catch(console.error);
