const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkRizwanAliParsing() {
  console.log('\n🔍 Checking Rizwan Ali CV parsing status...\n');

  try {
    // Find Rizwan Ali
    const { data: candidate, error: candError } = await sb
      .from('candidates')
      .select('*')
      .ilike('name', '%Rizwan Ali%')
      .single();

    if (candError || !candidate) {
      console.log('❌ Rizwan Ali not found');
      process.exit(1);
    }

    console.log(`✅ Found: ${candidate.name}`);
    console.log(`   Email: ${candidate.email}`);
    console.log(`   Current Nationality: ${candidate.nationality || 'Not set'}\n`);

    // Check inbox attachments
    const { data: inbox, error: inboxError } = await sb
      .from('inbox_attachments')
      .select('*')
      .eq('candidate_id', candidate.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (inbox && inbox.length > 0) {
      const doc = inbox[0];
      console.log(`📥 CV File: ${doc.file_name}`);
      console.log(`   Uploaded: ${new Date(doc.created_at).toLocaleString()}`);
      
      if (doc.extracted_data) {
        const data = typeof doc.extracted_data === 'string' ? JSON.parse(doc.extracted_data) : doc.extracted_data;
        console.log(`   Extracted Name: ${data.name || 'N/A'}`);
        console.log(`   Extracted Nationality: ${data.nationality || 'N/A'}`);
        console.log(`   Nationality Inferred From: ${data.nationality_inferred_from || 'N/A'}`);
        console.log(`   Confidence: ${data.extraction_confidence?.nationality?.toFixed(2) || 'N/A'}`);
        console.log(`   Education: ${data.education ? data.education.substring(0, 80) + '...' : 'N/A'}`);
        console.log(`   Languages: ${data.languages?.join(', ') || 'N/A'}`);
      }
    }

    // Check if there are any parsing jobs
    console.log('\n📋 Checking for parsing jobs related to this candidate...');
    const { data: files } = await sb
      .storage
      .from('documents')
      .list('candidates/' + candidate.id);

    if (files && files.length > 0) {
      console.log(`   Found ${files.length} files in storage`);
      files.slice(0, 3).forEach(f => {
        console.log(`   - ${f.name}`);
      });
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }

  process.exit(0);
}

checkRizwanAliParsing().catch(console.error);
