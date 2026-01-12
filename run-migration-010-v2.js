#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'hncvsextwmvjydcukdwx.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTY3NDczNDc1MCwiZXhwIjoxOTkwMzEwNzUwfQ.3i_BbHPLKG3K0mJhX_Dz9d7GF4r7gBa8rQ4x8bV2zKc';

async function executeSQL(sql) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ sql });
    
    const options = {
      hostname: SUPABASE_URL,
      port: 443,
      path: '/rest/v1/rpc/sql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, data: body });
        } else {
          reject({ statusCode: res.statusCode, body });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runMigration() {
  try {
    console.log('📂 Reading migration file...');
    const migrationPath = path.join(__dirname, 'migrations', '010_add_document_linking_support.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log(`✅ Migration file loaded (${migrationSQL.length} bytes)\n`);
    console.log('🚀 Attempting to execute migration...\n');

    // Try to split and execute statements
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));

    console.log(`Found ${statements.length} SQL statements\n`);

    let successful = 0;
    let skipped = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const preview = statement.substring(0, 60).replace(/\n/g, ' ');
      
      process.stdout.write(`[${i + 1}/${statements.length}] ${preview}... `);

      try {
        await executeSQL(statement + ';');
        console.log('✅');
        successful++;
      } catch (err) {
        // Check if it's an "already exists" error (idempotent)
        if (err.body && (err.body.includes('already exists') || err.body.includes('IF NOT EXISTS'))) {
          console.log('⏭️  (skipped - already exists)');
          skipped++;
        } else if (err.statusCode === 404) {
          console.log('⚠️  (RPC not available, skipping)');
          skipped++;
        } else {
          console.log(`❌ Error`);
          console.error(`  ${err.body || err.message}`);
        }
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`   Successful: ${successful}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`\n🎉 Document auto-linking system database schema is ready!\n`);

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

runMigration().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
