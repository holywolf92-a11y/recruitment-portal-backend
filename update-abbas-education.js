const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function updateAbbasEducation() {
  console.log('📚 Updating Abbas Khan education from CV...\n');

  const candidateCode = 'FL-2026-886';
  
  // The education from CV
  const education = 'BS Electrical Engineering (Power) - COMSATS UNIVERSITY ISLAMABAD (ABBOTTABAD CAMPUS) - Abbottabad, Pakistan - 2020-2024 (CGPA: 3.01/4.00)';

  const { error } = await supabase
    .from('candidates')
    .update({ 
      education: education
    })
    .eq('candidate_code', candidateCode);

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log('✅ Education updated successfully!\n');

  // Verify
  const { data } = await supabase
    .from('candidates')
    .select('candidate_code, name, education, certifications, internships, previous_employment')
    .eq('candidate_code', candidateCode)
    .single();

  console.log('📊 Abbas Khan (FL-2026-886) - Updated Data:');
  console.log('─'.repeat(60));
  console.log('Name:', data.name);
  console.log('Education:', data.education);
  console.log('Certifications:', data.certifications || '(none)');
  console.log('Internships:', data.internships);
  console.log('Previous Employment:', data.previous_employment);
  console.log('\n✅ All fields now populated correctly!');
}

updateAbbasEducation();
