/**
 * Simple script to clear all data using SQL TRUNCATE
 * This version uses direct SQL execution via Supabase REST API
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Tables to clear in order (child tables first, then parent tables)
const TABLES_TO_CLEAR = [
  // Child tables (with foreign keys) - delete first
  'document_verification_logs',
  'unmatched_documents',
  'candidate_documents',
  'documents',
  'parsing_jobs',
  'inbox_attachments',
  'communication_log',
  'job_candidate_matches',
  'cv_versions',
  'share_links',
  'candidate_timeline',
  'form_submissions',
  'idempotency_keys',
  'audit_log',
  
  // Parent tables
  'candidates',
  'inbox_messages',
  'job_orders',
  'employers',
  'communication_templates',
  'matching_runs',
  
  // Users (optional - uncomment if you want to clear users too)
  // 'users',
];

async function truncateTable(tableName) {
  try {
    // Use Supabase REST API to execute SQL directly
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        query: `TRUNCATE TABLE ${tableName} CASCADE;`
      })
    });

    if (!response.ok) {
      // Fallback: Try using delete with a condition
      const { count: beforeCount } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      const { error } = await supabase
        .from(tableName)
        .delete()
        .gte('created_at', '1970-01-01');
      
      if (error) {
        throw error;
      }
      
      const { count: afterCount } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      return { 
        success: true, 
        method: 'delete',
        deleted: (beforeCount || 0) - (afterCount || 0),
        remaining: afterCount || 0
      };
    }
    
    return { success: true, method: 'truncate', deleted: null, remaining: 0 };
  } catch (error) {
    // Last resort: try simple delete
    try {
      const { count: beforeCount } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      const { error: deleteError } = await supabase
        .from(tableName)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      
      if (deleteError) {
        throw deleteError;
      }
      
      const { count: afterCount } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      return { 
        success: true, 
        method: 'delete-fallback',
        deleted: (beforeCount || 0) - (afterCount || 0),
        remaining: afterCount || 0
      };
    } catch (fallbackError) {
      return { 
        success: false, 
        error: error.message || fallbackError.message 
      };
    }
  }
}

async function clearStorageBucket(bucketName = 'documents') {
  try {
    console.log(`\n🗑️  Clearing storage bucket: ${bucketName}...`);
    
    // List all files recursively
    async function listAllFiles(path = '', allFiles = []) {
      const { data: files, error } = await supabase.storage
        .from(bucketName)
        .list(path, {
          limit: 1000,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' }
        });
      
      if (error) throw error;
      
      if (!files || files.length === 0) {
        return allFiles;
      }
      
      for (const file of files) {
        if (file.id) {
          // It's a file
          allFiles.push(path ? `${path}/${file.name}` : file.name);
        } else {
          // It's a folder, recurse
          await listAllFiles(path ? `${path}/${file.name}` : file.name, allFiles);
        }
      }
      
      return allFiles;
    }
    
    const allFiles = await listAllFiles();
    
    if (allFiles.length === 0) {
      console.log(`  ✅ Bucket is already empty`);
      return { success: true, deleted: 0 };
    }
    
    // Delete all files in batches
    const batchSize = 100;
    let deletedCount = 0;
    
    for (let i = 0; i < allFiles.length; i += batchSize) {
      const batch = allFiles.slice(i, i + batchSize);
      const { error } = await supabase.storage
        .from(bucketName)
        .remove(batch);
      
      if (error) {
        console.warn(`  ⚠️  Error deleting batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      } else {
        deletedCount += batch.length;
        process.stdout.write(`  Deleted ${deletedCount}/${allFiles.length} files...\r`);
      }
    }
    
    console.log(`  ✅ Deleted ${deletedCount} files from storage`);
    return { success: true, deleted: deletedCount };
  } catch (error) {
    console.warn(`  ⚠️  Could not clear storage: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function clearAllData() {
  console.log('🧹 Starting data cleanup...\n');
  console.log('⚠️  WARNING: This will delete ALL data from the database!');
  console.log('   Schema and tables will be preserved.\n');
  console.log('='.repeat(60));
  
  const results = {
    tables: {},
    storage: null,
    errors: []
  };
  
  // Clear tables
  console.log('\n📊 Clearing database tables...\n');
  
  for (const tableName of TABLES_TO_CLEAR) {
    try {
      process.stdout.write(`  Clearing ${tableName}...`);
      const result = await truncateTable(tableName);
      
      if (result.success) {
        const method = result.method || 'unknown';
        const deleted = result.deleted !== null ? result.deleted : 'all';
        const remaining = result.remaining || 0;
        console.log(` ✅ (${method}, ${deleted} deleted, ${remaining} remaining)`);
        results.tables[tableName] = { success: true, ...result };
      } else {
        console.log(` ❌ Failed: ${result.error}`);
        results.tables[tableName] = { success: false, error: result.error };
        results.errors.push({ table: tableName, error: result.error });
      }
    } catch (error) {
      console.log(` ❌ Error: ${error.message}`);
      results.tables[tableName] = { success: false, error: error.message };
      results.errors.push({ table: tableName, error: error.message });
    }
  }
  
  // Clear storage buckets
  console.log('\n📦 Clearing storage buckets...');
  const storageResult = await clearStorageBucket('documents');
  results.storage = storageResult;
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Summary:\n');
  
  const successfulTables = Object.values(results.tables).filter(r => r.success).length;
  const failedTables = Object.values(results.tables).filter(r => !r.success).length;
  
  console.log(`  ✅ Tables cleared: ${successfulTables}/${TABLES_TO_CLEAR.length}`);
  if (failedTables > 0) {
    console.log(`  ❌ Failed tables: ${failedTables}`);
  }
  
  if (results.storage?.success) {
    console.log(`  ✅ Storage files deleted: ${results.storage.deleted || 0}`);
  } else {
    console.log(`  ⚠️  Storage: ${results.storage?.error || 'Unknown error'}`);
  }
  
  if (results.errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    results.errors.forEach(({ table, error }) => {
      console.log(`  - ${table}: ${error}`);
    });
  }
  
  console.log('\n✅ Data cleanup complete!');
  console.log('\nNote: Schema and tables are preserved. Only data was deleted.');
  console.log('You can now start fresh with a clean database.');
}

// Run the cleanup
clearAllData()
  .then(() => {
    console.log('\n🎉 All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
