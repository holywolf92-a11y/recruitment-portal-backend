const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'postgresql://postgres:MonsterBurger123!!@db.hncvsextwmvjydcukdwx.supabase.co:5432/postgres';

async function runMigration(filename) {
    const client = new Client({
        connectionString: connectionString,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        console.log(`\n📂 Reading migration file: ${filename}...`);
        const migrationPath = path.join(__dirname, '..', 'migrations', filename);
        if (!fs.existsSync(migrationPath)) {
            console.error(`❌ File not found: ${migrationPath}`);
            return;
        }
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        console.log(`✅ Migration file loaded (${migrationSQL.length} bytes)`);

        await client.connect();
        console.log('🚀 Connected to PostgreSQL database');

        console.log(`⏳ Executing ${filename}...`);
        
        // Use a single query for the whole file
        // pg Client.query can handle multiple statements if they are separated by semicolons
        await client.query(migrationSQL);
        
        console.log(`✅ ${filename} executed successfully!`);

    } catch (err) {
        console.error(`❌ Error executing ${filename}:`, err.message);
        if (err.detail) console.error(`   Detail: ${err.detail}`);
    } finally {
        await client.end();
    }
}

async function runAll() {
    await runMigration('010_add_document_linking_support.sql');
    await runMigration('011_add_cv_extraction_fields.sql');
    await runMigration('014_add_ai_document_categorization.sql');
    await runMigration('015_create_document_verification_logs.sql');
    await runMigration('016_add_universal_rejection_details.sql');
    await runMigration('017_add_rejection_details_to_logs.sql');
    console.log('\nAll migrations completed!');
}

runAll();
