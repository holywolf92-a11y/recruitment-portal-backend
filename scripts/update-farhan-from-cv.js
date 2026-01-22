/**
 * Script to update Farhan's candidate record with data from his CV
 * CV contains: Father Name, CNIC, DOB, Marital Status, Religion, Nationality, Passport
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const CANDIDATE_ID = 'f6773426-f1e3-4e26-bfc7-ff385c118b4a';

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

async function updateFarhan() {
  console.log('\n🔧 Updating Farhan\'s candidate record with CV data...\n');
  
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
  console.log(`  Father Name: ${candidate.father_name || '❌ MISSING'}`);
  console.log(`  CNIC: ${candidate.cnic_normalized || '❌ MISSING'}`);
  console.log(`  Passport: ${candidate.passport_normalized || '❌ MISSING'}`);
  console.log(`  Date of Birth: ${candidate.date_of_birth || '❌ MISSING'}`);
  console.log(`  Marital Status: ${candidate.marital_status || '❌ MISSING'}`);
  console.log(`  Nationality: ${candidate.nationality || '❌ MISSING'}`);
  console.log('');
}

updateFarhan().catch(console.error);
