const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function compareAbbasKhanRecords() {
  console.log('🔍 Comparing All Abbas Khan Records\n');

  const { data: candidates } = await supabase
    .from('candidates')
    .select('id, candidate_code, name, email, phone, position, education, certifications, internships, previous_employment, experience_years, created_at, updated_at')
    .ilike('name', '%Abbas Khan%')
    .order('created_at', { ascending: true });

  if (!candidates || candidates.length === 0) {
    console.log('❌ No Abbas Khan records found');
    return;
  }

  console.log(`📊 Found ${candidates.length} record(s) with "Abbas Khan" in name\n`);
  console.log('═'.repeat(80));

  candidates.forEach((candidate, idx) => {
    console.log(`\nRecord ${idx + 1}:`);
    console.log('─'.repeat(80));
    console.log('ID:', candidate.id);
    console.log('Candidate Code:', candidate.candidate_code);
    console.log('Name:', candidate.name);
    console.log('Email:', candidate.email);
    console.log('Phone:', candidate.phone);
    console.log('Position:', candidate.position);
    console.log('Education:', candidate.education);
    console.log('Certifications:', candidate.certifications);
    console.log('Internships:', candidate.internships ? candidate.internships.substring(0, 60) + '...' : '(null)');
    console.log('Previous Employment:', candidate.previous_employment);
    console.log('Experience Years:', candidate.experience_years);
    console.log('Created At:', candidate.created_at);
    console.log('Updated At:', candidate.updated_at);
  });

  console.log('\n' + '═'.repeat(80));
  console.log('🔎 ANALYSIS:');
  console.log('─'.repeat(80));

  if (candidates.length > 1) {
    const rec1 = candidates[0];
    const rec2 = candidates[1];

    console.log('\nComparing Record 1 vs Record 2:');
    
    const isSameEmail = rec1.email && rec2.email && rec1.email.toLowerCase() === rec2.email.toLowerCase();
    const isSamePhone = rec1.phone && rec2.phone && rec1.phone === rec2.phone;
    const isSamePosition = rec1.position && rec2.position && rec1.position.toLowerCase() === rec2.position.toLowerCase();
    const isSameEducation = rec1.education && rec2.education && rec1.education.toLowerCase() === rec2.education.toLowerCase();

    console.log('Same Email:', isSameEmail ? '✅ YES' : '❌ NO', `(${rec1.email} vs ${rec2.email})`);
    console.log('Same Phone:', isSamePhone ? '✅ YES' : '❌ NO', `(${rec1.phone} vs ${rec2.phone})`);
    console.log('Same Position:', isSamePosition ? '✅ YES' : '❌ NO', `(${rec1.position} vs ${rec2.position})`);
    console.log('Same Education:', isSameEducation ? '✅ YES' : '❌ NO');

    if (isSameEmail && isSamePhone && isSamePosition) {
      console.log('\n🔴 VERDICT: DUPLICATE RECORD');
      console.log('These are the SAME candidate uploaded/created twice!');
      console.log('\n💡 RECOMMENDATION: Delete the older record (Record 1)');
      console.log(`   Delete ID: ${rec1.id}`);
      console.log(`   Keep ID: ${rec2.id}`);
    } else if (!isSameEmail && !isSamePhone) {
      console.log('\n🟢 VERDICT: DIFFERENT CANDIDATES');
      console.log('These appear to be different people with the same name!');
    } else {
      console.log('\n🟡 VERDICT: UNCLEAR - Partial Match');
      console.log('Could be duplicate with missing data, or different candidates');
    }
  }
}

compareAbbasKhanRecords();
