const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkJobOutput() {
  const jobIds = [
    { id: '22adfb96-3dbf-406c-8f32-f3487b9514bb', name: 'Sharafat' },
    { id: 'c7c29d40-17f4-4cee-86d0-260f5d571dcc', name: 'Abdullah' }
  ];

  for (const job of jobIds) {
    const { data, error } = await sb
      .from('parsing_jobs')
      .select('*')
      .eq('id', job.id)
      .single();
    
    if (error || !data) {
      console.log(`\n❌ ${job.name}: Job not found`);
      continue;
    }
    
    console.log(`\n${job.name}:`);
    console.log(`  Status: ${data.status}`);
    
    if (data.output) {
      const output = typeof data.output === 'string' ? JSON.parse(data.output) : data.output;
      
      if (output.candidate) {
        console.log(`  Candidate name: ${output.candidate.name}`);
        if (output.candidate.profile_photo_url) {
          console.log(`  ✅ Profile photo URL in output: ${output.candidate.profile_photo_url.substring(0, 80)}...`);
        } else {
          console.log(`  ❌ No profile_photo_url in candidate data`);
        }
        
        // Show first few keys
        const candidateKeys = Object.keys(output.candidate).sort();
        console.log(`  Candidate keys: ${candidateKeys.slice(0, 5).join(', ')}...`);
      } else {
        console.log(`  ❌ No candidate data in output`);
      }
    } else {
      console.log(`  ❌ No output`);
    }
  }
}

checkJobOutput().catch(console.error);
