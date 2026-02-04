const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkCandidateDocuments() {
  console.log('\n🔍 Checking Documents for MR. MUHAMMAD ADNAN\n');
  console.log('='.repeat(80));
  
  try {
    // Find candidate
    const { data: candidates, error: candidateError } = await supabase
      .from('candidates')
      .select('id, name, candidate_code, position')
      .ilike('name', '%MUHAMMAD ADNAN%')
      .limit(5);
    
    if (candidateError) {
      console.error('❌ Error finding candidate:', candidateError.message);
      return;
    }
    
    if (!candidates || candidates.length === 0) {
      console.log('⚠️  No candidate found with name containing "MUHAMMAD ADNAN"');
      return;
    }
    
    console.log(`\n📋 Found ${candidates.length} candidate(s):\n`);
    candidates.forEach((c, i) => {
      console.log(`${i + 1}. ${c.name} (${c.candidate_code || 'N/A'}) - Position: ${c.position || 'N/A'}`);
    });
    
    // Check documents for each candidate
    for (const candidate of candidates) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`\n📄 Documents for: ${candidate.name} (ID: ${candidate.id})\n`);
      
      const { data: documents, error: docsError } = await supabase
        .from('candidate_documents')
        .select('*')
        .eq('candidate_id', candidate.id)
        .order('created_at', { ascending: false });
      
      if (docsError) {
        console.error(`❌ Error fetching documents: ${docsError.message}`);
        continue;
      }
      
      if (!documents || documents.length === 0) {
        console.log('   ⚠️  No documents found for this candidate');
        continue;
      }
      
      console.log(`   Found ${documents.length} document(s):\n`);
      
      // Group by status
      const byStatus = {
        pending_ai: [],
        verified: [],
        needs_review: [],
        rejected_mismatch: [],
        failed: [],
      };
      
      documents.forEach(doc => {
        const status = doc.verification_status || 'unknown';
        if (byStatus[status]) {
          byStatus[status].push(doc);
        }
      });
      
      // Display by status
      Object.entries(byStatus).forEach(([status, docs]) => {
        if (docs.length > 0) {
          console.log(`   📊 ${status.toUpperCase()} (${docs.length}):`);
          docs.forEach(doc => {
            const category = doc.category || doc.detected_category || 'unknown';
            const fileName = doc.file_name || 'N/A';
            const reason = doc.rejection_reason || doc.verification_reason_code || '';
            const confidence = doc.confidence ? `(${(doc.confidence * 100).toFixed(0)}%)` : '';
            
            console.log(`      • ${fileName}`);
            console.log(`        Category: ${category} ${confidence}`);
            if (reason) {
              console.log(`        Reason: ${reason}`);
            }
            if (doc.extracted_identity_json) {
              const identity = doc.extracted_identity_json;
              const hasIdentity = Object.values(identity).some(v => v !== null && v !== undefined && v !== '');
              console.log(`        Identity Fields: ${hasIdentity ? '✅ Extracted' : '❌ None'}`);
              if (hasIdentity) {
                const fields = Object.entries(identity)
                  .filter(([k, v]) => v !== null && v !== undefined && v !== '')
                  .map(([k]) => k)
                  .join(', ');
                console.log(`        Fields: ${fields}`);
              }
            }
            console.log('');
          });
        }
      });
      
      // Check verification logs
      console.log(`\n   📝 Verification Logs:\n`);
      const { data: logs, error: logsError } = await supabase
        .from('document_verification_logs')
        .select('*')
        .in('document_id', documents.map(d => d.id))
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (logsError) {
        console.log(`      ⚠️  Could not fetch logs: ${logsError.message}`);
      } else if (logs && logs.length > 0) {
        logs.forEach((log, i) => {
          const doc = documents.find(d => d.id === log.document_id);
          const docName = doc?.file_name || log.document_id;
          console.log(`      ${i + 1}. ${docName}`);
          console.log(`         Event: ${log.event_type} | Status: ${log.event_status}`);
          console.log(`         Verification Status: ${log.verification_status || 'N/A'}`);
          console.log(`         Reason: ${log.reason_code || 'N/A'}`);
          if (log.metadata) {
            console.log(`         Metadata: ${JSON.stringify(log.metadata).substring(0, 100)}...`);
          }
          console.log(`         Time: ${log.created_at}`);
          console.log('');
        });
      } else {
        console.log('      ⚠️  No verification logs found');
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('\n✅ Check Complete!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

checkCandidateDocuments();
