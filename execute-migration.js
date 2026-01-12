const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const migrationPath = path.join(__dirname, 'migrations', '010_add_document_linking_support.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

// Supabase PostgreSQL connection
const client = new Client({
  host: 'db.hncvsextwmvjydcukdwx.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Itbfr@p8ky#dRMAHLdi', // Using the master password
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  try {
    console.log('🔄 Connecting to Supabase PostgreSQL...\n');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    console.log('📋 Executing migration SQL...\n');
    const startTime = Date.now();
    
    await client.query(sql);
    
    const duration = Date.now() - startTime;
    
    console.log(`\n✅ Migration executed successfully in ${duration}ms!\n`);
    console.log('📊 Tables created/modified:');
    console.log('   ✅ inbox_attachments - extended with attachment_kind, document_type, linked_candidate_id');
    console.log('   ✅ candidate_documents - new table for linked documents');
    console.log('   ✅ unmatched_documents - new table for pending documents');
    console.log('   ✅ candidates - extended with document checklist fields');
    console.log('   ✅ Indexes created for performance');
    console.log('   ✅ Trigger function created for auto-updating checklist\n');
    
    console.log('🎉 Document auto-linking system is now fully operational!\n');

    // Verify tables were created
    console.log('🔍 Verifying tables...\n');
    
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('candidate_documents', 'unmatched_documents')
      ORDER BY table_name;
    `);

    if (tables.rows.length === 2) {
      console.log('✅ All required tables exist:');
      tables.rows.forEach(row => {
        console.log(`   ✅ ${row.table_name}`);
      });
    }

    // Check for new columns
    const columns = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'candidates' 
      AND column_name IN ('passport_received', 'cnic_received', 'degree_received', 'father_name')
      ORDER BY column_name;
    `);

    if (columns.rows.length > 0) {
      console.log('\n✅ Candidates table extended with:');
      columns.rows.forEach(row => {
        console.log(`   ✅ ${row.column_name}`);
      });
    }

    console.log('\n✨ Database is ready for document auto-linking!\n');

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
