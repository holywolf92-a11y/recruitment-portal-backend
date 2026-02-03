const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function createParsingJob(attachmentId, attachmentName) {
  try {
    console.log(`\nCreating parsing job for: ${attachmentName}`);
    
    // 1. Get attachment to verify it exists and get file hash
    const { data: attachment, error: attError } = await sb
      .from('inbox_attachments')
      .select('*')
      .eq('id', attachmentId)
      .single();
    
    if (attError || !attachment) {
      console.error('❌ Attachment not found');
      return;
    }
    
    console.log(`   File: ${attachment.file_name}`);
    console.log(`   Candidate: ${attachment.candidate_id}`);
    
    // 2. Check if job already exists
    const { data: existing } = await sb
      .from('parsing_jobs')
      .select('id')
      .eq('inbox_attachment_id', attachmentId)
      .eq('status', 'extracted')
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (existing && existing.length > 0) {
      console.log(`   ✅ Parsing job already exists: ${existing[0].id}`);
      return existing[0].id;
    }
    
    // 3. Create parsing job
    const { data: job, error: jobError } = await sb
      .from('parsing_jobs')
      .insert({
        inbox_attachment_id: attachmentId,
        status: 'queued'
      })
      .select()
      .single();
    
    if (jobError) {
      console.error('❌ Failed to create job:', jobError.message);
      return;
    }
    
    console.log(`   ✅ Parsing job created: ${job.id}`);
    return job.id;
  } catch (error) {
    console.error('Error:', error.message);
  }
}

async function main() {
  const attachments = [
    { id: '0a4a0050-a28a-457c-a65f-b631b9a768ab', name: 'Sharafat Updated.pdf (FL-2026-888)' },
    { id: 'c2d06014-201a-4ec0-9f20-614c485d8ede', name: 'Abdullah cv.pdf (FL-2026-887)' }
  ];
  
  console.log('Creating parsing jobs for uploaded CVs...');
  
  for (const att of attachments) {
    await createParsingJob(att.id, att.name);
  }
  
  console.log('\n✅ Parsing jobs created. They will be processed when the worker picks them up.');
  console.log('\nNote: The actual CV parsing will happen when:');
  console.log('- The BullMQ worker processes the job');
  console.log('- Python parser is called to extract data');
  console.log('- Profile photos are extracted using face detection');
}

main().catch(console.error);
