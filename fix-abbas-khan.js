const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixAbbasKhan() {
  console.log('🔧 Fixing Abbas Khan (FL-2026-886) data...\n');

  const candidateCode = 'FL-2026-886';

  // First, get current data
  const { data: candidate } = await supabase
    .from('candidates')
    .select('id, previous_employment, internships, certifications')
    .eq('candidate_code', candidateCode)
    .single();

  console.log('📊 BEFORE:');
  console.log('Previous Employment:', candidate.previous_employment);
  console.log('Internships:', candidate.internships);
  console.log('Certifications:', candidate.certifications);
  console.log('\n');

  // Fix previous_employment - remove internship entries
  const previousEmployment = candidate.previous_employment || '';
  const internships = candidate.internships || '';
  
  // Extract only real work experience (E&I Engineer at Dewan Cement Limited)
  const cleanedEmployment = 'E&I Engineer at Dewan Cement Limited';

  // Keep internships as is (already correct)
  const cleanedInternships = internships.replace(/,/g, ' | ');

  // Fix certifications - convert empty array to null
  const cleanedCertifications = (candidate.certifications === '[]' || candidate.certifications === '') ? null : candidate.certifications;

  // Update the database
  const { error } = await supabase
    .from('candidates')
    .update({
      previous_employment: cleanedEmployment,
      internships: cleanedInternships,
      certifications: cleanedCertifications
    })
    .eq('candidate_code', candidateCode);

  if (error) {
    console.error('❌ Error updating:', error.message);
    return;
  }

  console.log('✅ UPDATED SUCCESSFULLY!\n');

  // Verify the update
  const { data: updated } = await supabase
    .from('candidates')
    .select('previous_employment, internships, certifications, education')
    .eq('candidate_code', candidateCode)
    .single();

  console.log('📊 AFTER:');
  console.log('─'.repeat(60));
  console.log('Education:', updated.education || '(not extracted from CV)');
  console.log('Certifications:', updated.certifications || '(none)');
  console.log('Internships:', updated.internships);
  console.log('Previous Employment:', updated.previous_employment);
  console.log('\n');

  console.log('✅ Abbas Khan data fixed!');
  console.log('\n📝 Summary:');
  console.log('   • Removed internships from Previous Employment');
  console.log('   • Formatted internships with | separator');
  console.log('   • Cleaned up empty certifications array');
  console.log('\n⚠️  Note: Education field is null - not in original CV');
}

fixAbbasKhan();
