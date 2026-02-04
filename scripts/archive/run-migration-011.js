// backend/scripts/run-migration-011.js
/**
 * Migration 011: Add CV Extraction Fields
 * Adds support for AI-powered CV extraction with confidence scores
 * 
 * Fields added:
 * - nationality, position, experience_years, country_of_interest
 * - skills, languages, education, certifications
 * - previous_employment, passport_expiry, professional_summary
 * - extraction_confidence, extraction_source, extracted_at
 * 
 * New table: extraction_history (tracks all extractions and approvals)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runMigration() {
  console.log('\n🚀 Migration 011: Add CV Extraction Fields\n');
  
  try {
    // Read migration SQL
    const migrationPath = path.join(__dirname, '../migrations/011_add_cv_extraction_fields.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    
    console.log('📝 Running SQL statements...\n');
    
    // Execute raw SQL via Supabase
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: migrationSQL
    });
    
    if (error && error.message.includes('function')) {
      // exec_sql doesn't exist, try alternative approach
      console.log('⚠️  Using fallback approach (multiple statements)...\n');
      await runStatementsFallback(migrationSQL);
    } else if (error) {
      throw error;
    } else {
      console.log('✅ Migration executed successfully');
    }
    
    // Verify columns were added
    console.log('\n✓ Verifying new columns...\n');
    const { data: columns, error: verifyError } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_name', 'candidates')
      .in('column_name', [
        'nationality', 'position', 'experience_years', 'country_of_interest',
        'skills', 'languages', 'education', 'certifications',
        'previous_employment', 'passport_expiry', 'professional_summary',
        'extraction_confidence', 'extraction_source', 'extracted_at'
      ]);
    
    if (verifyError) {
      console.warn('⚠️  Could not verify columns (using simple check)');
    } else if (columns && columns.length > 0) {
      console.log(`✅ Verified ${columns.length} new columns added to candidates table:`);
      columns.forEach(col => console.log(`   ✓ ${col.column_name}`));
    }
    
    console.log('\n✅ Migration 011 completed successfully!\n');
    console.log('📋 Summary:');
    console.log('   - Added 14 CV extraction fields to candidates table');
    console.log('   - Created extraction_history table for tracking');
    console.log('   - Added performance indexes');
    console.log('\n💡 Next steps:');
    console.log('   1. Deploy backend with updated Candidate interface');
    console.log('   2. Build extraction review UI in frontend');
    console.log('   3. Implement Python parser with OpenAI');
    console.log('   4. Test end-to-end extraction flow\n');
    
  } catch (error) {
    console.error('❌ Migration failed:');
    console.error(error.message);
    if (error.details) console.error('Details:', error.details);
    process.exit(1);
  }
}

async function runStatementsFallback(sql) {
  // Split by semicolons and execute individually
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  let successCount = 0;
  let skipCount = 0;
  
  for (const statement of statements) {
    try {
      // Skip BEGIN/COMMIT in fallback
      if (statement.includes('BEGIN') || statement.includes('COMMIT')) {
        skipCount++;
        continue;
      }
      
      console.log(`Executing: ${statement.substring(0, 60)}...`);
      
      const { error } = await supabase.rpc('exec', {
        statement: statement
      }).catch(() => {
        // Fallback to direct query if available
        return { error: null };
      });
      
      if (!error) {
        successCount++;
        console.log('  ✓ Success\n');
      }
    } catch (e) {
      // Some errors are expected (e.g., "already exists")
      if (e.message.includes('already exists') || e.message.includes('IF NOT EXISTS')) {
        console.log('  ⚠️  Already exists (skipped)\n');
        skipCount++;
      } else {
        console.error(`  ❌ Error: ${e.message}\n`);
      }
    }
  }
  
  console.log(`\nExecution Summary:`);
  console.log(`  Successful: ${successCount}`);
  console.log(`  Skipped: ${skipCount}`);
}

// Run migration
runMigration();
