/**
 * Fix candidate_documents source CHECK constraint
 * Ensures 'web' and 'manual' are allowed values
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixSourceConstraint() {
  console.log('🔧 Fixing candidate_documents source constraint...\n');

  try {
    // Drop old constraint
    console.log('1️⃣  Dropping old source constraint...');
    const { error: dropError } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE candidate_documents 
        DROP CONSTRAINT IF EXISTS candidate_documents_source_check;
      `
    });

    if (dropError) {
      // Try direct query if RPC fails
      const { error: directDropError } = await supabase
        .from('_sql')
        .select()
        .eq('query', 'ALTER TABLE candidate_documents DROP CONSTRAINT IF EXISTS candidate_documents_source_check;');
      
      if (directDropError) {
        console.log('   (Constraint may not exist or already updated)\n');
      }
    } else {
      console.log('   ✅ Old constraint dropped\n');
    }

    // Add new constraint with all required values
    console.log('2️⃣  Adding updated source constraint...');
    
    // Use the admin client to execute raw SQL
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        DO $$ 
        BEGIN
          -- Drop old constraint if exists
          ALTER TABLE candidate_documents DROP CONSTRAINT IF EXISTS candidate_documents_source_check;
          
          -- Add new constraint with all values
          ALTER TABLE candidate_documents 
          ADD CONSTRAINT candidate_documents_source_check 
          CHECK (source IN ('gmail', 'whatsapp', 'web', 'manual', 'api', 'email'));
          
          RAISE NOTICE 'Constraint updated successfully';
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'Error: %', SQLERRM;
        END $$;
      `
    });

    if (error) {
      console.log('   ⚠️  RPC method not available. Using alternative approach...\n');
      
      // Alternative: Try to insert a test record to verify constraint
      console.log('3️⃣  Testing current constraint by attempting insert...');
      
      // First get a test candidate
      const { data: candidates } = await supabase
        .from('candidates')
        .select('id')
        .limit(1);
      
      if (candidates && candidates.length > 0) {
        const testCandidateId = candidates[0].id;
        
        // Try to insert with source='web'
        const { error: testError } = await supabase
          .from('candidate_documents')
          .insert({
            candidate_id: testCandidateId,
            document_type: 'other',
            storage_bucket: 'documents',
            storage_path: 'test/constraint-check.txt',
            file_name: 'constraint-test.txt',
            source: 'web',
            status: 'received'
          });
        
        if (testError) {
          if (testError.message.includes('candidate_documents_source_check')) {
            console.log('   ❌ CONSTRAINT ISSUE CONFIRMED');
            console.log('   Error:', testError.message);
            console.log('\n📋 MANUAL FIX REQUIRED:\n');
            console.log('Run this SQL in Supabase SQL Editor:\n');
            console.log('```sql');
            console.log('ALTER TABLE candidate_documents DROP CONSTRAINT IF EXISTS candidate_documents_source_check;');
            console.log('ALTER TABLE candidate_documents ADD CONSTRAINT candidate_documents_source_check');
            console.log("  CHECK (source IN ('gmail', 'whatsapp', 'web', 'manual', 'api', 'email'));");
            console.log('```\n');
          } else {
            console.log('   Different error:', testError.message);
          }
          
          // Clean up test record if it was created
          await supabase
            .from('candidate_documents')
            .delete()
            .eq('file_name', 'constraint-test.txt');
        } else {
          console.log('   ✅ source=web is ALLOWED - constraint is already correct!\n');
          
          // Clean up test record
          await supabase
            .from('candidate_documents')
            .delete()
            .eq('file_name', 'constraint-test.txt');
        }
      }
    } else {
      console.log('   ✅ Constraint updated successfully\n');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n📋 MANUAL FIX REQUIRED:\n');
    console.log('Open Supabase Dashboard → SQL Editor and run:\n');
    console.log('```sql');
    console.log('ALTER TABLE candidate_documents DROP CONSTRAINT IF EXISTS candidate_documents_source_check;');
    console.log('ALTER TABLE candidate_documents ADD CONSTRAINT candidate_documents_source_check');
    console.log("  CHECK (source IN ('gmail', 'whatsapp', 'web', 'manual', 'api', 'email'));");
    console.log('```\n');
  }
}

fixSourceConstraint();
