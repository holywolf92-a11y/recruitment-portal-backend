const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function addAbbasCoursesToCertifications() {
  console.log('📚 Adding Abbas Khan Coursera courses to certifications...\n');

  const candidateCode = 'FL-2026-886';

  // Get current Abbas Khan record
  const { data: candidate } = await supabase
    .from('candidates')
    .select('id, name, certifications')
    .eq('candidate_code', candidateCode)
    .single();

  if (!candidate) {
    console.error('❌ Abbas Khan not found');
    return;
  }

  console.log('Current Candidate:', candidate.name);
  console.log('Current Certifications:', candidate.certifications || '(null)');
  console.log('\n');

  // List of Coursera courses from Abbas Khan's CV
  const courses = [
    'Power System Modelling and Fault Analysis (L&T EduTech, 2025)',
    'Load Flow Analysis (L&T EduTech, 2025)',
    'Power System Stability (L&T EduTech, 2025)',
    'Electric Power Systems (The State University of New York, 2025)',
    'Safety First EV Maintenance & Best Practices (Coursera Instructor Network, 2025)',
    'Electrical Power Distribution (L&T EduTech, 2024)'
  ];

  console.log('📋 Courses to Add:');
  courses.forEach((course, idx) => {
    console.log(`${idx + 1}. ${course}`);
  });

  // Combine with existing certifications if any
  const existingCerts = candidate.certifications && candidate.certifications !== '[]' 
    ? candidate.certifications.split(' | ') 
    : [];

  const allCertifications = [...existingCerts, ...courses];
  const uniqueCertifications = [...new Set(allCertifications)]; // Remove duplicates
  const certificationsString = uniqueCertifications.join(' | ');

  console.log('\n📊 BEFORE:');
  console.log('Certifications:', candidate.certifications || '(null)');

  // Update database
  const { error } = await supabase
    .from('candidates')
    .update({ certifications: certificationsString })
    .eq('candidate_code', candidateCode);

  if (error) {
    console.error('❌ Error updating:', error.message);
    return;
  }

  // Verify
  const { data: updated } = await supabase
    .from('candidates')
    .select('certifications')
    .eq('candidate_code', candidateCode)
    .single();

  console.log('\n✅ AFTER:');
  console.log('Certifications:');
  const certs = updated.certifications.split(' | ');
  certs.forEach((cert, idx) => {
    console.log(`  ${idx + 1}. ${cert}`);
  });

  console.log('\n✅ Abbas Khan certifications updated with 6 Coursera courses!');
}

addAbbasCoursesToCertifications();
