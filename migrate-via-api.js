const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = 'https://hncvsextwmvjydcukdwx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTY3NDczNDc1MCwiZXhwIjoxOTkwMzEwNzUwfQ.3i_BbHPLKG3K0mJhX_Dz9d7GF4r7gBa8rQ4x8bV2zKc';

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  try {
    console.log('📂 Reading migration file...');
    const migrationPath = path.join(__dirname, 'migrations', '010_add_document_linking_support.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log(`✅ Migration file loaded (${migrationSQL.length} bytes)\n`);
    console.log('🚀 Executing migration through Supabase REST API...\n');

    // Split SQL by statements (simple regex-based)
    const statements = migrationSQL
      .split(/;[\r\n]+/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));

    console.log(`📋 Found ${statements.length} SQL statements\n`);

    let executed = 0;

    // Try using the query method which should work with Supabase
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i] + ';';
      const preview = stmt.substring(0, 70).replace(/\n/g, ' ').trim();
      
      process.stdout.write(`[${i + 1}/${statements.length}] ${preview}... `);

      try {
        // Use Supabase PostgreSQL directly via rpc if available
        const result = await supabase.rpc('sql_execute', { sql: stmt }).then(
          () => ({ success: true }),
          (err) => {
            // If RPC not available, that's OK - try with direct query
            return { needsFallback: true, error: err };
          }
        );

        if (result.success) {
          console.log('✅');
          executed++;
        } else if (result.needsFallback) {
          console.log('⚠️  (RPC unavailable)');
          // Don't count as executed since we couldn't verify
        }
      } catch (err) {
        // Check if it's idempotent (IF NOT EXISTS, etc.)
        const msg = err.message || '';
        if (msg.includes('already exists') || msg.includes('does not exist')) {
          console.log('⏭️  (idempotent)');
          executed++;
        } else {
          console.log(`❌ ${msg.substring(0, 40)}`);
        }
      }
    }

    console.log(`\n📊 Migration Result:`);
    console.log(`   Executed: ${executed}/${statements.length} statements\n`);
    
    // Try to verify using data queries
    console.log('🔍 Verifying new tables...\n');

    try {
      const { data: tables, error: tablesError } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public')
        .in('table_name', ['candidate_documents', 'unmatched_documents']);

      if (!tablesError && tables && tables.length > 0) {
        console.log('✅ New tables found:');
        tables.forEach(t => console.log(`   ✅ ${t.table_name}`));
      } else {
        console.log('⚠️  Could not verify tables via API');
        console.log('   (This is normal - RPC may not be available for information_schema)');
      }
    } catch (err) {
      console.log('⚠️  Could not verify tables');
    }

    console.log('\n🎉 Migration execution attempted!');
    console.log('\n📋 Important: Verify manually at Supabase dashboard:');
    console.log('   https://supabase.com/dashboard/project/hncvsextwmvjydcukdwx/editor\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

runMigration();
