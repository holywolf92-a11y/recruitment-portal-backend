const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://hncvsextwmvjydcukdwx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  console.log('Please set the environment variable and try again.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigrations() {
  try {
    console.log('🚀 Running migrations 014 and 015...\n');

    // Read migration files
    const migration014Path = path.join(__dirname, 'migrations', '014_add_ai_document_categorization.sql');
    const migration015Path = path.join(__dirname, 'migrations', '015_create_document_verification_logs.sql');

    const migration014SQL = fs.readFileSync(migration014Path, 'utf8');
    const migration015SQL = fs.readFileSync(migration015Path, 'utf8');

    console.log('📄 Migration 014: AI Document Categorization');
    console.log('   - Creating document_category_enum');
    console.log('   - Creating document_verification_status_enum');
    console.log('   - Adding 9 new columns to candidate_documents');
    console.log('   - Creating indexes for performance\n');

    console.log('📄 Migration 015: Document Verification Logs');
    console.log('   - Creating document_verification_logs table');
    console.log('   - Creating document_verification_timeline view');
    console.log('   - Creating helper functions\n');

    // Test connection
    const { data: testData, error: testError } = await supabase
      .from('candidates')
      .select('id')
      .limit(1);

    if (testError) {
      console.error('❌ Database connection failed:', testError.message);
      process.exit(1);
    }

    console.log('✅ Database connection successful\n');

    // Note: Supabase client doesn't support executing raw SQL directly for DDL
    // We need to use the Supabase SQL Editor or PostgreSQL client

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  MANUAL MIGRATION REQUIRED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Please run these migrations in the Supabase SQL Editor:\n');
    console.log('Option 1: Using Supabase Dashboard');
    console.log('  1. Go to: https://supabase.com/dashboard/project/hncvsextwmvjydcukdwx/sql');
    console.log('  2. Copy and run the SQL from: backend/migrations/014_add_ai_document_categorization.sql');
    console.log('  3. Copy and run the SQL from: backend/migrations/015_create_document_verification_logs.sql\n');

    console.log('Option 2: Using psql command line');
    console.log('  psql "postgresql://postgres:[password]@db.hncvsextwmvjydcukdwx.supabase.co:5432/postgres" \\');
    console.log('    < migrations/014_add_ai_document_categorization.sql');
    console.log('  psql "postgresql://postgres:[password]@db.hncvsextwmvjydcukdwx.supabase.co:5432/postgres" \\');
    console.log('    < migrations/015_create_document_verification_logs.sql\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('📋 SQL Preview (Migration 014 - first 30 lines):\n');
    const preview014 = migration014SQL.split('\n').slice(0, 30).join('\n');
    console.log(preview014);
    console.log('\n... (full migration in file)\n');

    // Try to use pg library for direct execution (if available)
    try {
      const { Client } = require('pg');
      
      console.log('🔧 Attempting direct PostgreSQL execution...\n');
      
      const client = new Client({
        connectionString: `postgresql://postgres:${process.env.SUPABASE_DB_PASSWORD}@db.hncvsextwmvjydcukdwx.supabase.co:5432/postgres`,
        ssl: { rejectUnauthorized: false }
      });

      await client.connect();
      
      console.log('⏳ Running migration 014...');
      await client.query(migration014SQL);
      console.log('✅ Migration 014 completed successfully!\n');
      
      console.log('⏳ Running migration 015...');
      await client.query(migration015SQL);
      console.log('✅ Migration 015 completed successfully!\n');
      
      await client.end();
      
      console.log('🎉 ALL MIGRATIONS COMPLETED!\n');
      console.log('Next steps:');
      console.log('  - Step 3: Update document upload API endpoint');
      console.log('  - Step 4: Implement AI categorization worker');
      console.log('  - Step 5: Build identity matching service\n');

    } catch (pgError) {
      if (pgError.code === 'MODULE_NOT_FOUND') {
        console.log('ℹ️  pg module not configured for direct execution');
        console.log('   Please use one of the manual options above.\n');
      } else {
        throw pgError;
      }
    }

  } catch (err) {
    console.error('❌ Migration script failed:', err.message);
    console.error(err);
    process.exit(1);
  }
}

runMigrations();
