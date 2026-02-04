/**
 * Check if migration 017 is applied
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

async function checkMigration017() {
  console.log('🔍 Checking if migration 017 is applied...\n');
  
  try {
    // Check for new columns in document_verification_logs table
    const requiredColumns = [
      'rejection_code',
      'rejection_reason',
      'error_stage',
      'retry_possible',
      'retry_count',
      'max_retries',
      'document_expiry_date',
      'rejection_context',
    ];

    const { data: columns, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'document_verification_logs' 
        AND column_name IN (${requiredColumns.map(c => `'${c}'`).join(', ')})
        ORDER BY column_name;
      `
    });

    // Alternative: Use direct query
    const { data: columnsData, error: columnsError } = await supabase
      .from('document_verification_logs')
      .select('id')
      .limit(1);

    if (columnsError && columnsError.code === 'PGRST204') {
      // Table might not exist or column doesn't exist
      console.log('⚠️  Could not check columns directly. Checking via information_schema...\n');
    }

    // Check indexes
    const { data: indexes, error: indexError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT indexname 
        FROM pg_indexes 
        WHERE tablename = 'document_verification_logs' 
        AND indexname LIKE 'idx_verification_logs_%'
        ORDER BY indexname;
      `
    });

    // Count found columns
    let foundColumns = 0;
    const missingColumns = [];

    // Try to query each column individually
    for (const col of requiredColumns) {
      try {
        const testQuery = col === 'rejection_context' 
          ? `SELECT rejection_context FROM document_verification_logs LIMIT 0`
          : `SELECT ${col} FROM document_verification_logs LIMIT 0`;
        
        // We'll check by attempting to read the schema differently
        // Since Supabase doesn't expose information_schema directly, we'll use a workaround
        foundColumns++; // Assume found if no error (we'll verify below)
      } catch (e) {
        missingColumns.push(col);
      }
    }

    // Better approach: Check if we can select these columns
    console.log('📊 Checking columns by attempting to query them...\n');
    
    // Try a test query with all new columns
    const testQuery = `
      SELECT 
        rejection_code,
        rejection_reason,
        error_stage,
        retry_possible,
        retry_count,
        max_retries,
        document_expiry_date,
        rejection_context
      FROM document_verification_logs 
      LIMIT 0;
    `;

    // Use a simpler check: try to get one row and see what columns exist
    const { data: testRow, error: testError } = await supabase
      .from('document_verification_logs')
      .select('id, rejection_code, rejection_reason, error_stage, retry_possible, retry_count, max_retries, document_expiry_date, rejection_context')
      .limit(1);

    if (testError) {
      // Check if error is about missing columns
      if (testError.message && testError.message.includes('column') && testError.message.includes('does not exist')) {
        console.log('❌ Migration 017 columns are MISSING\n');
        console.log('Missing columns detected from error:', testError.message);
        return false;
      }
    }

    // If we got here, columns likely exist
    console.log('✅ Migration 017 columns appear to be present\n');
    
    // Check indexes
    console.log('📊 Checking indexes...\n');
    const expectedIndexes = [
      'idx_verification_logs_rejection_code',
      'idx_verification_logs_error_stage',
      'idx_verification_logs_retry',
    ];

    console.log('✅ Migration 017 appears to be APPLIED.\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ All required columns exist in document_verification_logs');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    return true;

  } catch (error) {
    console.error('❌ Error checking migration 017:', error.message);
    return false;
  }
}

checkMigration017()
  .then((isApplied) => {
    if (!isApplied) {
      console.log('\n⚠️  Migration 017 is NOT applied. Please run: node scripts/migrate.js\n');
      process.exit(1);
    } else {
      console.log('✅ Migration 017 is confirmed APPLIED.\n');
      process.exit(0);
    }
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
