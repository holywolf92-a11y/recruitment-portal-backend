const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://ahgyfiahprfxbddjqdfq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3Mi6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFoZ3lmaWFocHJmeGJkZGpxZGZxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNDM0MzY5MSwiZXhwIjoyMDQ5OTE5NjkxfQ.gQd1cpcECJtMBM4LIBjsYLK7nHx48USkQb1-sNaAU5s'
);

async function run() {
  const code = 'FL-2026-88';
  console.log(`\n🔎 Looking up candidate by code: ${code}\n`);

  const { data: candidates, error } = await supabase
    .from('candidates')
    .select('id, name, email, phone, position, cv_received, certificate_received, created_at, status, candidate_code')
    .eq('candidate_code', code)
    .limit(5);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (!candidates || candidates.length === 0) {
    console.log('❌ No candidate found for code', code);
    return;
  }

  for (const c of candidates) {
    console.log(`✅ Candidate: ${c.name} (${c.id})`);
    console.log(`   Email: ${c.email || 'N/A'}`);
    console.log(`   Phone: ${c.phone || 'N/A'}`);
    console.log(`   Position: ${c.position || 'NOT SET'}`);
    console.log(`   CV Received: ${c.cv_received ? '✅' : '❌'}`);
    console.log(`   Certificate Received: ${c.certificate_received ? '✅' : '❌'}`);
    console.log(`   Status: ${c.status || 'N/A'}`);
    console.log(`   Created: ${new Date(c.created_at).toLocaleString()}`);

    const { data: docs } = await supabase
      .from('candidate_documents')
      .select('id, document_type, document_source, original_filename, category, verification_status, created_at')
      .eq('candidate_id', c.id)
      .order('created_at', { ascending: false });

    console.log(`\n   Documents (${docs?.length || 0}):`);
    docs?.forEach(d => {
      console.log(`   - ${d.document_type || 'N/A'} | ${d.category || 'N/A'} | ${d.document_source || 'N/A'} | ${d.original_filename || 'unnamed'} | ${d.verification_status || 'N/A'}`);
    });
    console.log('');
  }
}

run().then(() => process.exit(0));
