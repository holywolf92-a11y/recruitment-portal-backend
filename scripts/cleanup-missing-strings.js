/**
 * Cleanup script to replace "missing" string values with NULL
 * This fixes the issue where "missing" was stored as actual data
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Fields that should never have "missing" as a string value
const FIELDS_TO_CLEAN = [
  'name', 'position', 'nationality', 'country_of_interest',
  'phone', 'email', 'experience_years', 'date_of_birth',
  'passport_normalized', 'passport_expiry', 'father_name',
  'cnic_normalized', 'address', 'religion', 'marital_status',
  'salary_expectation', 'available_from', 'interview_date',
  'medical_expiry', 'driving_license', 'gcc_years'
];

async function cleanupMissingStrings() {
  console.log('🧹 Cleaning up "missing" string values in candidates table...\n');
  
  try {
    // Get all candidates
    const { data: candidates, error: fetchError } = await supabase
      .from('candidates')
      .select('id, candidate_code, name');
    
    if (fetchError) {
      console.error('❌ Error fetching candidates:', fetchError);
      return;
    }
    
    if (!candidates || candidates.length === 0) {
      console.log('ℹ️  No candidates found');
      return;
    }
    
    console.log(`📊 Found ${candidates.length} candidates to check\n`);
    
    let totalFixed = 0;
    let candidatesFixed = 0;
    
    for (const candidate of candidates) {
      // Get full candidate data
      const { data: fullCandidate, error: getError } = await supabase
        .from('candidates')
        .select('*')
        .eq('id', candidate.id)
        .single();
      
      if (getError || !fullCandidate) {
        console.warn(`⚠️  Could not fetch candidate ${candidate.candidate_code}:`, getError);
        continue;
      }
      
      // Check each field for "missing" string
      const updates = {};
      let hasUpdates = false;
      
      for (const field of FIELDS_TO_CLEAN) {
        const value = fullCandidate[field];
        if (typeof value === 'string' && value.toLowerCase() === 'missing') {
          updates[field] = null;
          hasUpdates = true;
          totalFixed++;
        }
      }
      
      if (hasUpdates) {
        console.log(`🔧 Fixing ${candidate.candidate_code} (${candidate.name}):`);
        for (const [field, newValue] of Object.entries(updates)) {
          console.log(`   - ${field}: "missing" → NULL`);
        }
        
        // Update candidate
        const { error: updateError } = await supabase
          .from('candidates')
          .update(updates)
          .eq('id', candidate.id);
        
        if (updateError) {
          console.error(`   ❌ Error updating: ${updateError.message}`);
        } else {
          candidatesFixed++;
          console.log(`   ✅ Fixed\n`);
        }
      }
    }
    
    console.log('='.repeat(60));
    console.log(`✅ Cleanup complete!`);
    console.log(`   - Candidates checked: ${candidates.length}`);
    console.log(`   - Candidates fixed: ${candidatesFixed}`);
    console.log(`   - Total fields fixed: ${totalFixed}`);
    console.log('='.repeat(60));
    
    // Recalculate missing fields for all candidates
    console.log('\n🔄 Recalculating missing_fields for all candidates...');
    
    const { calculateMissingFields } = await import('../src/services/progressiveDataCompletionService.ts');
    
    for (const candidate of candidates) {
      try {
        const { data: fullCandidate } = await supabase
          .from('candidates')
          .select('*')
          .eq('id', candidate.id)
          .single();
        
        if (fullCandidate) {
          const missingFields = calculateMissingFields(fullCandidate);
          await supabase
            .from('candidates')
            .update({ missing_fields: missingFields })
            .eq('id', candidate.id);
        }
      } catch (error) {
        console.warn(`⚠️  Could not recalculate missing fields for ${candidate.candidate_code}`);
      }
    }
    
    console.log('✅ Missing fields recalculated for all candidates');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

cleanupMissingStrings();
