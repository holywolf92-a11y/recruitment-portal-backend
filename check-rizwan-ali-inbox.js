const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkRizwanAliInbox() {
  console.log('\n🔍 Checking Rizwan Ali inbox attachments...\n');

  try {
    // First get the candidate ID
    const { data: candidate, error: candError } = await sb
      .from('candidates')
      .select('id, name, email')
      .ilike('name', '%Rizwan Ali%')
      .single();

    if (candError) {
      console.error('❌ Error finding candidate:', candError.message);
      process.exit(1);
    }

    if (!candidate) {
      console.log('❌ Rizwan Ali not found');
      process.exit(1);
    }

    console.log(`✅ Found candidate: ${candidate.name} (${candidate.email})\n`);

    // Check inbox_attachments
    const { data: inboxDocs, error: inboxError } = await sb
      .from('inbox_attachments')
      .select('*')
      .eq('candidate_id', candidate.id)
      .order('created_at', { ascending: false });

    if (inboxError) {
      console.error('❌ Error querying inbox:', inboxError.message);
    } else if (inboxDocs && inboxDocs.length > 0) {
      console.log(`📥 Found ${inboxDocs.length} inbox attachment(s):\n`);
      
      inboxDocs.forEach((doc, index) => {
        console.log(`${index + 1}. File: ${doc.file_name || 'N/A'}`);
        console.log(`   File URL: ${doc.file_url || 'N/A'}`);
        console.log(`   Status: ${doc.status || 'N/A'}`);
        console.log(`   Created: ${new Date(doc.created_at).toLocaleString()}`);
        console.log(`   Type: ${doc.document_type || 'N/A'}`);
        
        if (doc.extracted_data) {
          const data = typeof doc.extracted_data === 'string' ? JSON.parse(doc.extracted_data) : doc.extracted_data;
          console.log(`   Extracted Name: ${data.name || 'N/A'}`);
          console.log(`   Extracted Email: ${data.email || 'N/A'}`);
        }
        console.log('');
      });
    } else {
      console.log('❌ No inbox attachments found for Rizwan Ali');
    }

    // Also check parsing_jobs for Rizwan Ali
    console.log('\n📋 Checking parsing jobs...\n');
    const { data: jobs, error: jobError } = await sb
      .from('parsing_jobs')
      .select('*')
      .eq('candidate_id', candidate.id)
      .order('created_at', { ascending: false });

    if (jobError) {
      console.error('Error querying jobs:', jobError.message);
    } else if (jobs && jobs.length > 0) {
      console.log(`Found ${jobs.length} parsing job(s):\n`);
      jobs.forEach((job, i) => {
        console.log(`${i + 1}. Status: ${job.status}`);
        console.log(`   Created: ${new Date(job.created_at).toLocaleString()}`);
        console.log(`   File: ${job.input_file_name || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('No parsing jobs found');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }

  process.exit(0);
}

checkRizwanAliInbox().catch(console.error);
