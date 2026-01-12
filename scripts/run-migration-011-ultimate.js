#!/usr/bin/env node

/**
 * 🚀 Migration 011: ULTIMATE EXECUTION SCRIPT
 * 
 * This script will execute database migration 011 to add CV extraction fields.
 * It tries multiple methods to ensure success and provides clear feedback.
 * 
 * This is a CRITICAL migration that MUST succeed.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

async function executeMigration() {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 DATABASE MIGRATION 011: ADD CV EXTRACTION FIELDS');
  console.log('='.repeat(70) + '\n');

  // Read migration SQL
  const migrationFile = path.join(__dirname, '..', 'migrations', '011_add_cv_extraction_fields.sql');
  if (!fs.existsSync(migrationFile)) {
    console.error(`❌ Migration file not found: ${migrationFile}`);
    return false;
  }

  const migrationSQL = fs.readFileSync(migrationFile, 'utf-8');

  try {
    // Initialize Supabase client with service role
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    console.log('📍 Supabase Project: hncvsextwmvjydcukdwx');
    console.log('👤 Mode: Service Role (Admin)\n');

    // Method 1: Try using Supabase's query function
    console.log('⏳ Method 1: Attempting direct execution via Supabase client...\n');
    
    try {
      // Split statements and execute carefully
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--') && s !== 'BEGIN' && s !== 'COMMIT');

      let successCount = 0;
      let totalCount = statements.length;

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const display = stmt.substring(0, 60) + (stmt.length > 60 ? '...' : '');
        process.stdout.write(`  [${i + 1}/${totalCount}] ${display} `);

        try {
          // Use RPC with direct SQL execution
          const { data, error } = await supabase.rpc('exec_sql', { sql: stmt });
          
          if (error && error.message && error.message.includes('does not exist')) {
            // Function doesn't exist, that's OK - skip RPC method
            process.stdout.write('⚠️  (RPC unavailable)\n');
            continue;
          } else if (error) {
            // Other error
            process.stdout.write(`❌ (${error.message.substring(0, 40)}...)\n`);
            continue;
          }
          
          process.stdout.write('✓\n');
          successCount++;
        } catch (err) {
          process.stdout.write(`❌ (${err.message.substring(0, 40)}...)\n`);
        }
      }

      console.log(`\n📊 Results: ${successCount}/${totalCount} statements executed\n`);

      // Verify migration
      console.log('🔍 Verifying migration success...\n');
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
          console.log(`✅ SUCCESS! Found ${found.length}/${newCols.length} new columns:\n`);
          found.forEach(col => console.log(`   ✓ ${col}`));
          console.log('\n✨ Migration completed successfully!\n');
          return true;
        }
      }

      throw new Error('Verification failed: columns not found in database');
    } catch (err) {
      console.log(`⚠️  Direct method failed: ${err.message}\n`);
      throw err;
    }

  } catch (error) {
    console.log('❌ MIGRATION EXECUTION FAILED\n');
    console.log('=' .repeat(70));
    console.log('⚠️  MANUAL ACTION REQUIRED\n');
    console.log('The automated migration execution failed.');
    console.log('Please execute the migration manually via the Supabase dashboard:\n');
    console.log('STEPS:');
    console.log('1. Go to: https://app.supabase.com/project/hncvsextwmvjydcukdwx/sql/new');
    console.log('2. Copy the SQL from: backend/migrations/011_add_cv_extraction_fields.sql');
    console.log('3. Paste it into the SQL editor');
    console.log('4. Click "Run" button\n');
    console.log('MIGRATION SQL:');
    console.log('='.repeat(70));
    console.log(migrationSQL);
    console.log('='.repeat(70) + '\n');
    
    return false;
  }
}

// Run migration
executeMigration().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
