/**
 * Check Farhan's data to see if "missing" is stored as a string
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

// Try to load .env file
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const envLocalPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hncvsextwmvjydcukdwx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                              process.env.SUPABASE_ANON_KEY ||
                              'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkFarhanData() {
  console.log('🔍 Checking Farhan\'s data (FL-2026-192)...\n');
  
  try {
    const { data: candidate, error } = await supabase
      .from('candidates')
      .select('*')
      .eq('candidate_code', 'FL-2026-192')
      .single();
    
    if (error) {
      console.error('❌ Error:', error);
      return;
    }
    
    if (!candidate) {
      console.error('❌ Candidate not found');
      return;
    }
    
    console.log('📊 Candidate Data:');
    console.log('='.repeat(60));
    console.log(`ID: ${candidate.id}`);
    console.log(`Name: ${candidate.name}`);
    console.log(`Position: ${candidate.position || 'NULL'}`);
    console.log(`Nationality: ${candidate.nationality || 'NULL'}`);
    console.log(`Country of Interest: ${candidate.country_of_interest || 'NULL'}`);
    console.log(`Phone: ${candidate.phone || 'NULL'}`);
    console.log(`Email: ${candidate.email || 'NULL'}`);
    console.log(`Experience Years: ${candidate.experience_years || 'NULL'}`);
    console.log(`Date of Birth: ${candidate.date_of_birth || 'NULL'}`);
    console.log(`Passport: ${candidate.passport_normalized || 'NULL'}`);
    console.log(`Passport Expiry: ${candidate.passport_expiry || 'NULL'}`);
    console.log(`Father Name: ${candidate.father_name || 'NULL'}`);
    console.log(`CNIC: ${candidate.cnic_normalized || 'NULL'}`);
    console.log(`Address: ${candidate.address || 'NULL'}`);
    console.log(`Missing Fields: ${JSON.stringify(candidate.missing_fields || [])}`);
    console.log('='.repeat(60));
    
    // Check for "missing" string values
    console.log('\n🔍 Checking for "missing" string values:');
    const fieldsToCheck = [
      'name', 'position', 'nationality', 'country_of_interest', 
      'phone', 'email', 'experience_years', 'date_of_birth',
      'passport_normalized', 'passport_expiry', 'father_name', 
      'cnic_normalized', 'address'
    ];
    
    const missingAsString = [];
    for (const field of fieldsToCheck) {
      const value = candidate[field];
      if (typeof value === 'string' && value.toLowerCase() === 'missing') {
        missingAsString.push(field);
        console.log(`⚠️  "${field}" has value "missing" (string)`);
      }
    }
    
    if (missingAsString.length === 0) {
      console.log('✅ No fields have "missing" as a string value');
    }
    
    // Check what calculateMissingFields would return
    console.log('\n📋 Missing Fields Calculation:');
    const { calculateMissingFields } = require('../src/services/progressiveDataCompletionService');
    const missingFields = calculateMissingFields(candidate);
    console.log(`Missing Fields: ${JSON.stringify(missingFields)}`);
    console.log(`Total Missing: ${missingFields.length}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkFarhanData();
