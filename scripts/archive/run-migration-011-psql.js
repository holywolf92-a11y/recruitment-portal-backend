#!/usr/bin/env node

/**
 * Migration 011: Add CV Extraction Fields - Using PSQL
 * This script executes the migration using psql directly via Supabase connection
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
const SUPABASE_PASSWORD = process.env.SUPABASE_PASSWORD || process.argv[2];

if (!SUPABASE_PASSWORD) {
  console.error('❌ Missing Supabase password');
  console.log('\nUsage: node run-migration-011-psql.js <SUPABASE_PASSWORD>');
  console.log('  or set SUPABASE_PASSWORD environment variable\n');
  process.exit(1);
}

// Supabase connection string format
const POSTGRES_HOST = 'db.hncvsextwmvjydcukdwx.supabase.co';
const POSTGRES_PORT = '5432';
const POSTGRES_DB = 'postgres';
const POSTGRES_USER = 'postgres';

// Read migration file
const migrationFile = path.join(__dirname, '..', 'migrations', '011_add_cv_extraction_fields.sql');

if (!fs.existsSync(migrationFile)) {
  console.error(`❌ Migration file not found: ${migrationFile}`);
  process.exit(1);
}

const migrationSQL = fs.readFileSync(migrationFile, 'utf-8');

console.log('\n🚀 Migration 011: Add CV Extraction Fields (via PSQL)\n');
console.log(`📍 Target: ${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`);
console.log(`👤 User: ${POSTGRES_USER}\n`);

try {
  // Execute SQL using psql
  console.log('⏳ Executing migration...\n');
  
  const psqlCommand = `echo "${migrationSQL.replace(/"/g, '\\"')}" | psql -h ${POSTGRES_HOST} -p ${POSTGRES_PORT} -U ${POSTGRES_USER} -d ${POSTGRES_DB} -w`;
  
  // Set PGPASSWORD env variable for authentication
  const env = { ...process.env, PGPASSWORD: SUPABASE_PASSWORD };
  
  const output = execSync(psqlCommand, {
    encoding: 'utf-8',
    env,
    stdio: 'pipe'
  });

  console.log('✅ Migration executed successfully!\n');
  if (output) {
    console.log('📋 Output:\n', output);
  }

  // Verify migration
  console.log('\n✓ Verifying columns were created...\n');
  
  const verifySQL = `SELECT column_name FROM information_schema.columns WHERE table_name='candidates' AND column_name IN ('nationality', 'position', 'experience_years', 'country_of_interest', 'skills', 'languages', 'education', 'certifications', 'previous_employment', 'passport_expiry', 'professional_summary', 'extraction_confidence', 'extraction_source', 'extracted_at');`;
  
  const verifyCommand = `echo "${verifySQL.replace(/"/g, '\\"')}" | psql -h ${POSTGRES_HOST} -p ${POSTGRES_PORT} -U ${POSTGRES_USER} -d ${POSTGRES_DB} -w -t`;
  
  const verifyOutput = execSync(verifyCommand, {
    encoding: 'utf-8',
    env,
    stdio: 'pipe'
  });

  const columns = verifyOutput
    .trim()
    .split('\n')
    .filter(col => col.trim())
    .map(col => col.trim());

  if (columns.length > 0) {
    console.log(`✅ SUCCESS! Found ${columns.length}/14 new columns:\n`);
    columns.forEach(col => {
      console.log(`   ✓ ${col}`);
    });
    console.log(`\n✨ Migration completed successfully!\n`);
  } else {
    console.log('⚠️  Warning: Could not verify columns were created');
    console.log('   Check Supabase dashboard to confirm\n');
  }

  process.exit(0);
} catch (error) {
  console.error('\n❌ Error executing migration:\n');
  console.error(error.message);
  console.log('\n📝 Troubleshooting:');
  console.log('   1. Verify password is correct');
  console.log('   2. Check that psql is installed: psql --version');
  console.log('   3. Verify network access to Supabase');
  console.log('   4. Try manual execution via Supabase dashboard:\n');
  console.log('      https://app.supabase.com/project/hncvsextwmvjydcukdwx/sql/new\n');
  process.exit(1);
}
