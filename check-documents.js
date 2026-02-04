const {createClient} = require('@supabase/supabase-js');
require('dotenv').config();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  try {
    console.log('Checking document_inbox...');
    const {data: docs} = await sb.from('document_inbox')
      .select('id, candidate_id, file_name, created_at')
      .in('file_name', ['CV_maryam.pdf', 'Dr Rasheed Ahmed CV 5204.docx.pdf'])
      .order('created_at', {ascending: false});
    
    console.log(`\nFound ${docs?.length || 0} documents:`);
    if (docs) {
      docs.forEach(d => {
        console.log(`  ${d.file_name} - candidate_id=${d.candidate_id}`);
      });
    }
    
    // Get Maryam and Rasheed's candidates
    const {data: cands} = await sb.from('candidates')
      .select('id, candidate_code, name')
      .in('candidate_code', ['FL-2026-889', 'FL-2026-890']);
    
    console.log(`\nCandidates:`);
    cands?.forEach(c => {
      console.log(`  ${c.candidate_code} - ${c.name} (id=${c.id.substring(0,8)}...)`);
    });
    
  } catch (err) {
    console.log('Error:', err.message);
  }
  process.exit(0);
})();
