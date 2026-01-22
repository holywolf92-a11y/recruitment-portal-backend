/**
 * Clear all data from the database (preserves schema)
 * This script deletes all records from all tables in the correct order
 * to respect foreign key constraints.
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
  
  // Users (optional - comment out if you want to keep users)
  // 'users',
];

async function clearTable(tableName) {
  try {
    // First, get count before deletion
    const { count: beforeCount } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });
    
    // Try to delete all records using a condition that matches everything
    // We'll use a condition that should match all rows
    let deleted = false;
    
    // Method 1: Try deleting with a condition that matches all
    const { error: deleteError } = await supabase
      .from(tableName)
      .delete()
      .gte('created_at', '1970-01-01'); // This should match all records with created_at
    
    if (!deleteError) {
      deleted = true;
    } else {
      // Method 2: Try without any condition (if RLS allows)
      const { error: deleteError2 } = await supabase
        .from(tableName)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Match all except a non-existent ID
      
      if (!deleteError2) {
        deleted = true;
      } else {
        // Method 3: Use SQL function if available
        try {
          // Use Supabase's REST API directly for TRUNCATE
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
          
          if (response.ok) {
            deleted = true;
          } else {
            throw new Error(`SQL execution failed: ${response.statusText}`);
          }
        } catch (sqlError) {
          throw deleteError2 || deleteError || sqlError;
        }
      }
    }
    
    // Get count after deletion
    const { count: afterCount } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });
    
    return { 
      success: deleted, 
      before: beforeCount || 0, 
      after: afterCount || 0,
      deleted: (beforeCount || 0) - (afterCount || 0)
    };
  } catch (error) {
    return { 
      success: false, 
      error: error.message 
    };
  }
}

async function clearStorageBucket(bucketName = 'documents') {
  try {
    console.log(`\n🗑️  Clearing storage bucket: ${bucketName}...`);
    
    // List all files in the bucket
    const { data: files, error: listError } = await supabase.storage
      .from(bucketName)
      .list('', {
        limit: 1000,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' }
      });
    
    if (listError) {
      console.warn(`  ⚠️  Could not list files: ${listError.message}`);
      return { success: false, error: listError.message };
    }
    
    if (!files || files.length === 0) {
      console.log(`  ✅ Bucket is already empty`);
      return { success: true, deleted: 0 };
    }
    
    // Delete all files
    const pathsToDelete = files.map(file => file.name);
    
    // Delete in batches if needed
    const batchSize = 100;
    let deletedCount = 0;
    
    for (let i = 0; i < pathsToDelete.length; i += batchSize) {
      const batch = pathsToDelete.slice(i, i + batchSize);
      const { error: deleteError } = await supabase.storage
        .from(bucketName)
        .remove(batch);
      
      if (deleteError) {
        console.warn(`  ⚠️  Error deleting batch ${i / batchSize + 1}: ${deleteError.message}`);
      } else {
        deletedCount += batch.length;
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
      console.log(`  Clearing ${tableName}...`);
      const result = await clearTable(tableName);
      
      if (result.success) {
        console.log(`  ✅ ${tableName}: Deleted ${result.deleted || 0} records (${result.after || 0} remaining)`);
        results.tables[tableName] = { success: true, deleted: result.deleted || 0, remaining: result.after || 0 };
      } else {
        console.log(`  ❌ ${tableName}: Failed - ${result.error}`);
        results.tables[tableName] = { success: false, error: result.error };
        results.errors.push({ table: tableName, error: result.error });
      }
    } catch (error) {
      console.log(`  ❌ ${tableName}: Error - ${error.message}`);
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
  
  console.log(`  Tables cleared: ${successfulTables}/${TABLES_TO_CLEAR.length}`);
  if (failedTables > 0) {
    console.log(`  Failed tables: ${failedTables}`);
  }
  
  if (results.storage?.success) {
    console.log(`  Storage files deleted: ${results.storage.deleted || 0}`);
  } else {
    console.log(`  Storage: ⚠️  ${results.storage?.error || 'Unknown error'}`);
  }
  
  if (results.errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    results.errors.forEach(({ table, error }) => {
      console.log(`  - ${table}: ${error}`);
    });
  }
  
  console.log('\n✅ Data cleanup complete!');
  console.log('\nNote: Schema and tables are preserved. Only data was deleted.');
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
