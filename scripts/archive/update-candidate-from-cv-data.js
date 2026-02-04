/**
 * Script to update candidate with data from CV
 * Updates candidate a45331bf-c434-4018-af2a-f44eafd1ebbc (Farhan) with CV data
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Please set these in .env.local or environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const CANDIDATE_ID = 'a45331bf-c434-4018-af2a-f44eafd1ebbc'; // New Farhan candidate

// Data from Farhan's CV
const CV_DATA = {
  father_name: 'Ghulam Rasool',
  cnic: '42301-1000204-7',
  date_of_birth: '1983-10-13', // 13 October 1983
  marital_status: 'Married',
  nationality: 'Pakistani',
  passport: 'AE8942046',
};

function normalizeCNIC(cnic) {
  if (!cnic) return null;
  // Remove dashes and spaces, keep only digits
  return cnic.replace(/[-\s]/g, '');
}

function normalizePassport(passport) {
  if (!passport) return null;
  return passport.trim().toUpperCase();
}

async function updateCandidate() {
  console.log('\n🔧 Updating candidate with CV data...\n');
  console.log(`Candidate ID: ${CANDIDATE_ID}\n`);
  
  // Normalize identifiers
  const cnicNormalized = normalizeCNIC(CV_DATA.cnic);
  const passportNormalized = normalizePassport(CV_DATA.passport);
  
  const updates = {
    father_name: CV_DATA.father_name,
    cnic_normalized: cnicNormalized,
    passport_normalized: passportNormalized,
    date_of_birth: CV_DATA.date_of_birth,
    marital_status: CV_DATA.marital_status,
    nationality: CV_DATA.nationality,
    updated_at: new Date().toISOString(),
  };
  
  console.log('Updating with:');
  console.log(JSON.stringify(updates, null, 2));
  console.log('');
  
  const { data, error } = await supabase
    .from('candidates')
    .update(updates)
    .eq('id', CANDIDATE_ID)
    .select();
  
  if (error) {
    console.error('❌ Error updating candidate:', error);
    process.exit(1);
  }
  
  if (!data || data.length === 0) {
    console.error('❌ Candidate not found');
    process.exit(1);
  }
  
  const candidate = data[0];
  
  console.log('✅ Successfully updated candidate record!');
  console.log('\nUpdated fields:');
  console.log(`  Name: ${candidate.name || '❌ MISSING'}`);
  console.log(`  Email: ${candidate.email || '❌ MISSING'}`);
  console.log(`  Father Name: ${candidate.father_name || '❌ MISSING'}`);
  console.log(`  CNIC: ${candidate.cnic_normalized || '❌ MISSING'}`);
  console.log(`  Passport: ${candidate.passport_normalized || '❌ MISSING'}`);
  console.log(`  Date of Birth: ${candidate.date_of_birth || '❌ MISSING'}`);
  console.log(`  Marital Status: ${candidate.marital_status || '❌ MISSING'}`);
  console.log(`  Nationality: ${candidate.nationality || '❌ MISSING'}`);
  console.log('');
}

updateCandidate().catch(console.error);
