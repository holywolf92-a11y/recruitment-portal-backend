const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCertifications() {
  console.log('🔍 Checking certifications field for all candidates...\n');

  const { data, error } = await supabase
    .from('candidates')
    .select('candidate_code, name, certifications, internships, previous_employment')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log('📊 Sample Candidates:');
  console.log('─'.repeat(80));
  
  data.forEach((candidate, idx) => {
    console.log(`\n${idx + 1}. ${candidate.name} (${candidate.candidate_code})`);
    console.log('   Certifications:', candidate.certifications || '(empty)');
    console.log('   Internships:', candidate.internships ? candidate.internships.substring(0, 50) + '...' : '(empty)');
    console.log('   Work Experience:', candidate.previous_employment ? candidate.previous_employment.substring(0, 50) + '...' : '(empty)');
  });

  // Check for candidates with courses mentioned in previous_employment but not in certifications
  console.log('\n\n🔎 Checking for Courses in Previous Employment...');
  console.log('─'.repeat(80));
  
  const courseKeywords = ['course', 'certificate', 'certification', 'training', 'workshop', 'seminar'];
  
  data.forEach((candidate) => {
    if (candidate.previous_employment) {
      const empText = candidate.previous_employment.toLowerCase();
      const hasCourse = courseKeywords.some(keyword => empText.includes(keyword));
      const certText = (candidate.certifications || '').toLowerCase();
      const hasCert = certText.length > 2;
      
      if (hasCourse && !hasCert) {
        console.log(`\n⚠️  ${candidate.name} has courses in work experience but NO certifications!`);
        console.log('    Work Experience:', candidate.previous_employment);
      }
    }
  });
}

checkCertifications();
