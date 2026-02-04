const {createClient} = require('@supabase/supabase-js');
require('dotenv').config();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  try {
    const candidates = ['FL-2026-889', 'FL-2026-890'];
    
    for (const code of candidates) {
      console.log(`\n=== Processing ${code} ===`);
      const {data: cand} = await sb.from('candidates').select('id,name').eq('candidate_code', code).single();
      
      if (!cand) {
        console.log(`Not found: ${code}`);
        continue;
      }
      
      console.log(`Found: ${cand.name} (${code})`);
      
      // Clear profile_photo_url to test extraction
      await sb.from('candidates').update({profile_photo_url: null}).eq('id', cand.id);
      console.log('✓ Cleared profile_photo_url');
      
      // Get parsing job
      const {data: jobs} = await sb.from('parsing_jobs').select('id,status').eq('candidate_id', cand.id);
      
      if (!jobs || jobs.length === 0) {
        console.log('Creating new parsing job...');
        const {error} = await sb.from('parsing_jobs').insert({
          candidate_id: cand.id, 
          status: 'queued'
        });
        if (error) console.log('Error:', error.message);
        else console.log('✓ Job created and queued');
      } else {
        console.log(`Requeuing job (current status: ${jobs[0].status})...`);
        const {error} = await sb.from('parsing_jobs')
          .update({status: 'queued'})
          .eq('id', jobs[0].id);
        if (error) console.log('Error:', error.message);
        else console.log(`✓ Job requeued`);
      }
    }
    console.log('\n✅ All jobs requeued - check Railway logs for [PHOTO_EXTRACT]');
  } catch (err) {
    console.log('Exception:', err.message);
  }
  process.exit(0);
})();
