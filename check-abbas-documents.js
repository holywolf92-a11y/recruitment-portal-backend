const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAbbasDocuments() {
  console.log('📄 Checking Abbas Khan documents and extracted data...\n');

  // Get candidate
  const { data: candidate } = await supabase
    .from('candidates')
    .select('id, candidate_code, name')
    .eq('candidate_code', 'FL-2026-886')
    .single();

  console.log('📋 Candidate:', candidate.name);
  console.log('Code:', candidate.candidate_code);
  console.log('ID:', candidate.id);
  console.log('\n');

  // Get CV documents
  const { data: docs } = await supabase
    .from('documents')
    .select('id, original_filename, category, extracted_data')
    .eq('candidate_id', candidate.id)
    .eq('category', 'cv')
    .order('created_at', { ascending: false });

  if (!docs || docs.length === 0) {
    console.log('❌ No CV documents found');
    return;
  }

  console.log(`📄 Found ${docs.length} CV document(s)\n`);

  docs.forEach((doc, idx) => {
    console.log(`\nDocument ${idx + 1}: ${doc.original_filename}`);
    console.log('─'.repeat(60));
    
    if (doc.extracted_data) {
      console.log('✅ Extracted Data Available:');
      const data = doc.extracted_data;
      
      if (data.certifications) {
        console.log('\n📚 Certifications:');
        console.log(JSON.stringify(data.certifications, null, 2));
      }
      
      if (data.internships) {
        console.log('\n🎓 Internships:');
        console.log(JSON.stringify(data.internships, null, 2));
      }
      
      if (data.experience) {
        console.log('\n💼 Experience:');
        console.log(JSON.stringify(data.experience, null, 2));
      }
      
      if (data.education) {
        console.log('\n📖 Education:');
        console.log(JSON.stringify(data.education, null, 2));
      }
    } else {
      console.log('ℹ️  No extracted data');
    }
  });
}

checkAbbasDocuments();
