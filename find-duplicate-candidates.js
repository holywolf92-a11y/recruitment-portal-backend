const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findDuplicates() {
  console.log('🔍 Searching for potential duplicate candidates...\n');

  // Get all candidates
  const { data: allCandidates } = await supabase
    .from('candidates')
    .select('id, candidate_code, name, email, phone, created_at')
    .order('created_at', { ascending: false });

  if (!allCandidates) {
    console.log('❌ Error fetching candidates');
    return;
  }

  console.log(`📊 Total candidates: ${allCandidates.length}\n`);

  // Group by email
  const byEmail = {};
  const byPhone = {};
  const byName = {};

  allCandidates.forEach(c => {
    if (c.email) {
      const email = c.email.toLowerCase();
      if (!byEmail[email]) byEmail[email] = [];
      byEmail[email].push(c);
    }
    if (c.phone) {
      if (!byPhone[c.phone]) byPhone[c.phone] = [];
      byPhone[c.phone].push(c);
    }
    if (c.name) {
      const name = c.name.toLowerCase();
      if (!byName[name]) byName[name] = [];
      byName[name].push(c);
    }
  });

  console.log('🔴 DUPLICATE CHECK:\n');

  // Find duplicates
  let duplicateCount = 0;

  console.log('By Email:');
  Object.entries(byEmail).forEach(([email, records]) => {
    if (records.length > 1) {
      console.log(`\n  ${email} - ${records.length} records:`);
      records.forEach(r => {
        console.log(`    ${r.candidate_code} (${r.name})`);
      });
      duplicateCount += records.length - 1;
    }
  });

  console.log('\n\nBy Phone:');
  let phoneCount = 0;
  Object.entries(byPhone).forEach(([phone, records]) => {
    if (records.length > 1) {
      console.log(`\n  ${phone} - ${records.length} records:`);
      records.forEach(r => {
        console.log(`    ${r.candidate_code} (${r.name})`);
      });
      phoneCount += records.length - 1;
    }
  });

  console.log('\n\nBy Name (exact match):');
  let nameCount = 0;
  Object.entries(byName).forEach(([name, records]) => {
    if (records.length > 1) {
      console.log(`\n  "${name}" - ${records.length} records:`);
      records.forEach(r => {
        console.log(`    ${r.candidate_code} | Email: ${r.email || '(none)'} | Phone: ${r.phone || '(none)'}`);
      });
      nameCount += records.length - 1;
    }
  });

  console.log('\n' + '═'.repeat(80));
  console.log(`\n📋 SUMMARY:`);
  console.log(`  Email duplicates: ${duplicateCount}`);
  console.log(`  Phone duplicates: ${phoneCount}`);
  console.log(`  Name duplicates: ${nameCount}`);
  console.log(`  Total duplicate records: ${duplicateCount + phoneCount + nameCount}`);

  if (duplicateCount === 0 && phoneCount === 0 && nameCount === 0) {
    console.log('\n✅ No obvious duplicates found!');
  }
}

findDuplicates();
