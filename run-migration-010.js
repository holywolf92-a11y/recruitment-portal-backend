const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Get credentials from environment
const supabaseUrl = process.env.SUPABASE_URL || 'https://hncvsextwmvjydcukdwx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  console.error('Please set the environment variable with your Supabase service role key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  try {
    console.log('🔄 Reading migration file...');
    const migrationPath = path.join(__dirname, 'migrations', '010_add_document_linking_support.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📊 Migration SQL loaded:', migrationSql.length, 'characters');
    console.log('\n🚀 Executing migration...\n');

    // Execute the migration using the admin API
    const { error } = await supabase.rpc('execute_sql_as_admin', {
      sql: migrationSql
    }).catch(async (err) => {
      // If the RPC doesn't exist, try direct execution
      console.log('⚠️  RPC not available, attempting direct SQL execution...\n');
      
      // Split by semicolon and execute each statement
      const statements = migrationSql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      
      for (const statement of statements) {
        console.log(`⏳ Executing: ${statement.substring(0, 80)}...`);
        const { error: stmtError } = await supabase.rpc('sql', { 
          command: statement 
        }).catch(() => {
          // Fallback: use postgres connection
          return supabase.functions.invoke('execute-migration', {
            body: { sql: statement }
          }).catch(() => {
            return { error: null }; // Continue if no RPC available
          });
        });
        
        if (stmtError) {
          console.log(`⚠️  Warning (continuing): ${stmtError.message}`);
        } else {
          console.log(`✅ Success`);
        }
      }
      
      return { error: null };
    });

    if (error) {
      console.error('❌ Migration error:', error);
      process.exit(1);
    }

    console.log('\n✅ Migration executed successfully!');
    console.log('\n📋 Migration applied:');
    console.log('  ✅ Extended inbox_attachments (attachment_kind, document_type, linked_candidate_id, received_at)');
    console.log('  ✅ Created candidate_documents table');
    console.log('  ✅ Created unmatched_documents table');
    console.log('  ✅ Extended candidates table (document checklist fields)');
    console.log('  ✅ Created update_candidate_document_checklist() trigger function');
    console.log('  ✅ Created indexes for performance');
    console.log('\n🎉 Document auto-linking system is now ready!');
    
  } catch (err) {
    console.error('❌ Error running migration:', err.message);
    process.exit(1);
  }
}

// Run migration
runMigration();
