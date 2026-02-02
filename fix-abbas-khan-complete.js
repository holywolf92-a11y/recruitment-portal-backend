const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixAbbasKhanComplete() {
  console.log('🔧 COMPREHENSIVE FIX: Abbas Khan (FL-2026-886)\n');

  const candidateCode = 'FL-2026-886';

  // Get all Abbas Khan records
  const { data: candidates } = await supabase
    .from('candidates')
    .select('id, candidate_code, name, education, certifications, internships, previous_employment, experience_years')
    .eq('candidate_code', candidateCode)
    .order('created_at', { ascending: false });

  if (!candidates || candidates.length === 0) {
    console.error('❌ No candidates found');
    return;
  }

  console.log(`📊 Found ${candidates.length} record(s) for Abbas Khan\n`);

  for (const candidate of candidates) {
    console.log(`Processing ID: ${candidate.id}`);
    console.log('─'.repeat(60));
    
    // Extract internships from previous_employment
    const previousEmp = candidate.previous_employment || '';
    const interneePattern = /Internee Engineer at [^;]*/g;
    const interneeMatches = previousEmp.match(interneePattern) || [];
    
    // Clean up previous_employment - keep only real work
    let cleanedEmployment = previousEmp
      .split(';')
      .map(e => e.trim())
      .filter(e => e && !e.toLowerCase().includes('internee'))
      .join('; ');
    
    // Format internships from matches
    let internshipsValue = null;
    if (interneeMatches.length > 0) {
      internshipsValue = interneeMatches.map(m => m.trim()).join(' | ');
    }
    
    // Fix certifications - empty array to null
    let certificationsValue = null;
    if (candidate.certifications && candidate.certifications !== '[]' && candidate.certifications !== '') {
      certificationsValue = candidate.certifications;
    }
    
    console.log('\n📊 BEFORE:');
    console.log('Education:', candidate.education);
    console.log('Certifications:', candidate.certifications);
    console.log('Internships:', candidate.internships);
    console.log('Previous Employment:', previousEmp.substring(0, 80) + '...');
    console.log('Experience Years:', candidate.experience_years);
    
    // Update
    const { error } = await supabase
      .from('candidates')
      .update({
        education: candidate.education,
        certifications: certificationsValue,
        internships: internshipsValue,
        previous_employment: cleanedEmployment || null,
        experience_years: 2  // Only E&I Engineer role = ~2 years since 2024 to present
      })
      .eq('id', candidate.id);

    if (error) {
      console.error('❌ Error updating:', error.message);
      continue;
    }

    // Verify
    const { data: updated } = await supabase
      .from('candidates')
      .select('education, certifications, internships, previous_employment, experience_years')
      .eq('id', candidate.id)
      .single();

    console.log('\n✅ AFTER:');
    console.log('Education:', updated.education);
    console.log('Certifications:', updated.certifications || '(null)');
    console.log('Internships:', updated.internships);
    console.log('Previous Employment:', updated.previous_employment);
    console.log('Experience Years:', updated.experience_years);
    console.log('\n');
  }

  console.log('✅ Abbas Khan data fixed completely!');
  console.log('\n📋 Final Structure:');
  console.log('─'.repeat(60));
  console.log('Education: BS Electrical Engineering details');
  console.log('Certifications: null (none on CV)');
  console.log('Internships: 3 internee engineer positions');
  console.log('Work Experience: E&I Engineer at Dewan Cement Limited');
  console.log('Experience Years: 2 (only real work)');
}

fixAbbasKhanComplete();
