const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAbbasAllDocs() {
  console.log('📄 Checking all Abbas Khan documents...\n');

  const { data: docs } = await supabase
    .from('documents')
    .select('id, original_filename, category, candidate_id, extracted_data')
    .ilike('original_filename', '%abbas%')
    .order('created_at', { ascending: false })
    .limit(5);

  if (!docs || docs.length === 0) {
    console.log('❌ No documents found for Abbas Khan');
    return;
  }

  console.log(`📄 Found ${docs.length} document(s)\n`);

  docs.forEach((doc, idx) => {
    console.log(`${idx + 1}. ${doc.original_filename}`);
    console.log(`   Category: ${doc.category}`);
    console.log(`   Candidate ID: ${doc.candidate_id || '(none)'}`);
    
    if (doc.extracted_data) {
      console.log('   ✅ Has extracted data');
      const data = doc.extracted_data;
      if (data.certifications) {
        console.log(`      Certifications: ${JSON.stringify(data.certifications).substring(0, 60)}`);
      }
      if (data.experience) {
        console.log(`      Experience entries: ${Array.isArray(data.experience) ? data.experience.length : 'N/A'}`);
        if (Array.isArray(data.experience)) {
          data.experience.forEach((exp, i) => {
            console.log(`        ${i+1}. ${exp.title} at ${exp.company}`);
          });
        }
      }
    }
  });
}

checkAbbasAllDocs();
