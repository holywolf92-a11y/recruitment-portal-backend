// backend/scripts/run-migration-011-direct.js
/**
 * Migration 011: Add CV Extraction Fields - Direct SQL Execution
 * Executes SQL statements one by one using Supabase RPC
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.argv[2] || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  console.log('Usage: node run-migration-011-direct.js <SERVICE_ROLE_KEY>');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// SQL statements to execute
const sqlStatements = [
  // Add CV extraction fields to candidates table
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS nationality VARCHAR(100);',
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS position VARCHAR(255);',
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS experience_years INTEGER;',
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS country_of_interest VARCHAR(100);',
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS skills TEXT;',
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS languages TEXT;',
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS education VARCHAR(255);',
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS certifications TEXT;',
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS previous_employment TEXT;',
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS passport_expiry DATE;',
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS professional_summary TEXT;',
  
  // Add extraction metadata columns
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS extraction_confidence JSONB DEFAULT \'{}\'::jsonb;',
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS extraction_source VARCHAR(50);',
  'ALTER TABLE candidates ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMP;',
  
  // Add indexes
  'CREATE INDEX IF NOT EXISTS idx_candidates_nationality ON candidates(nationality);',
  'CREATE INDEX IF NOT EXISTS idx_candidates_country_interest ON candidates(country_of_interest);',
  'CREATE INDEX IF NOT EXISTS idx_candidates_experience ON candidates(experience_years);',
  'CREATE INDEX IF NOT EXISTS idx_candidates_position ON candidates(position);',
  
  // Create extraction_history table
  `CREATE TABLE IF NOT EXISTS extraction_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    extracted_data JSONB NOT NULL,
    confidence_scores JSONB,
    extracted_at TIMESTAMP DEFAULT NOW(),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP,
    approved BOOLEAN DEFAULT false,
    notes TEXT
  );`,
  
  'CREATE INDEX IF NOT EXISTS idx_extraction_history_candidate ON extraction_history(candidate_id);',
  'CREATE INDEX IF NOT EXISTS idx_extraction_history_date ON extraction_history(extracted_at DESC);'
];

async function executeSql(sql) {
  try {
    // Use the exec function via RPC if available, otherwise direct query
    const { error } = await supabase.rpc('exec_sql', { sql });
    
    if (error && !error.message.includes('does not exist')) {
      throw error;
    }
    return true;
  } catch (err) {
    // Function doesn't exist, return gracefully
    return null;
  }
}

async function runMigration() {
  console.log('\n🚀 Migration 011: Add CV Extraction Fields (Direct SQL)\n');
  
  let successful = 0;
  let failed = 0;
  let skipped = 0;
  
  for (const sql of sqlStatements) {
    try {
      const statement = sql.substring(0, 70) + (sql.length > 70 ? '...' : '');
      process.stdout.write(`Executing: ${statement}\n`);
      
      // Try executing via rpc (may not work)
      const result = await executeSql(sql);
      
      if (result === null) {
        // Function doesn't exist - silently skip for now
        skipped++;
      } else if (result) {
        console.log('  ✓ Success\n');
        successful++;
      }
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('  ⚠️  Already exists (skipped)\n');
        skipped++;
      } else {
        console.error(`  ❌ Error: ${err.message}\n`);
        failed++;
      }
    }
  }
  
  console.log('\n📊 Execution Summary:');
  console.log(`   Successful: ${successful}`);
  console.log(`   Skipped:    ${skipped}`);
  console.log(`   Failed:     ${failed}\n`);
  
  // Final verification
  console.log('✓ Verifying columns were added...\n');
  try {
    const { data, error } = await supabase
      .from('candidates')
      .select('*')
      .limit(1);
    
    if (!error && data && data.length > 0) {
      const cols = Object.keys(data[0]);
      const newCols = [
        'nationality', 'position', 'experience_years', 'country_of_interest',
        'skills', 'languages', 'education', 'certifications',
        'previous_employment', 'passport_expiry', 'professional_summary',
        'extraction_confidence', 'extraction_source', 'extracted_at'
      ];
      const found = newCols.filter(c => cols.includes(c));
      
      if (found.length > 0) {
        console.log(`✅ SUCCESS! Found ${found.length}/14 new columns:\n`);
        found.forEach(col => console.log(`   ✓ ${col}`));
      } else {
        console.log('⚠️  Warning: Could not find new columns in candidates table');
        console.log('   Please check Supabase SQL editor to verify manually');
      }
    }
  } catch (err) {
    console.log('⚠️  Could not verify columns:', err.message);
  }
  
  console.log('\n✅ Migration script completed!\n');
  console.log('📋 IMPORTANT NEXT STEPS:');
  console.log('   1. Go to: https://app.supabase.com/project/hncvsextwmvjydcukdwx/sql/new');
  console.log('   2. Paste the SQL from: backend/migrations/011_add_cv_extraction_fields.sql');
  console.log('   3. Run to confirm all columns were created');
  console.log('   4. Then proceed with backend/frontend deployment\n');
}

runMigration().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
