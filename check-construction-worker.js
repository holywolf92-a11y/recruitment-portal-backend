const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://ahgyfiahprfxbddjqdfq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFoZ3lmaWFocHJmeGJkZGpxZGZxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNDM0MzY5MSwiZXhwIjoyMDQ5OTE5NjkxfQ.gQd1cpcECJtMBM4LIBjsYLK7nHx48USkQb1-sNaAU5s'
);

async function checkConstructionWorker() {
  console.log('\n🔍 Searching for construction worker certificate...\n');
  
  // Search for documents with "construction" in verification results
  const { data: docs, error } = await supabase
    .from('candidate_documents')
    .select('id, candidate_id, document_type, document_source, original_filename, verification_result, created_at')
    .or('original_filename.ilike.%construction%,verification_result->>document_type.ilike.%construction%')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (!docs || docs.length === 0) {
    console.log('❌ No construction-related documents found');
    
    // Try broader search
    console.log('\n🔍 Trying broader certificate search...\n');
    const { data: certs } = await supabase
      .from('candidate_documents')
      .select('id, candidate_id, document_type, document_source, original_filename, verification_result, created_at')
      .eq('document_type', 'Certificate')
      .order('created_at', { ascending: false })
      .limit(10);
    
    console.log(`Found ${certs?.length || 0} recent certificates:`);
    certs?.forEach(doc => {
      console.log(`  - ${doc.original_filename || 'unnamed'} (Type: ${doc.document_type}, Source: ${doc.document_source})`);
    });
    return;
  }

  console.log(`Found ${docs.length} construction-related documents:\n`);
  
  for (const doc of docs) {
    console.log(`📄 Document ${doc.id}`);
    console.log(`   Candidate ID: ${doc.candidate_id}`);
    console.log(`   Type: ${doc.document_type}`);
    console.log(`   Source: ${doc.document_source}`);
    console.log(`   Filename: ${doc.original_filename}`);
    console.log(`   Created: ${new Date(doc.created_at).toLocaleString()}`);
    
    if (doc.verification_result) {
      const vr = doc.verification_result;
      console.log(`   Verified Type: ${vr.document_type || 'N/A'}`);
      console.log(`   Profession: ${vr.profession || 'N/A'}`);
    }
    
    // Get candidate details
    const { data: candidate } = await supabase
      .from('candidates')
      .select('name, profession, cv_received, certificate_received')
      .eq('id', doc.candidate_id)
      .single();
    
    if (candidate) {
      console.log(`\n   👤 Candidate: ${candidate.name}`);
      console.log(`   Profession: ${candidate.profession || 'NOT SET'}`);
      console.log(`   CV Received: ${candidate.cv_received ? '✅ Yes' : '❌ No'}`);
      console.log(`   Certificate Received: ${candidate.certificate_received ? '✅ Yes' : '❌ No'}`);
    }
    console.log('');
  }
}

checkConstructionWorker().then(() => process.exit(0));
