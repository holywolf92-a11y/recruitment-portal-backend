#!/usr/bin/env node

/**
 * 🚀 Migration 011: REST API EXECUTION
 * 
 * This executes SQL via Supabase's PostgREST endpoint which supports custom SQL
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SUPABASE_URL = 'https://hncvsextwmvjydcukdwx.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ';

const migrationFile = path.join(__dirname, '..', 'migrations', '011_add_cv_extraction_fields.sql');
const migrationSQL = fs.readFileSync(migrationFile, 'utf-8');

async function executeSQL(sql) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query: sql });
    
    const options = {
      hostname: 'hncvsextwmvjydcukdwx.supabase.co',
      port: 443,
      path: '/rest/v1/rpc/exec_sql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve({ success: true, data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 DATABASE MIGRATION 011: REST API EXECUTION');
  console.log('='.repeat(70) + '\n');

  try {
    console.log('⏳ Executing migration via Supabase REST API...\n');
    
    const result = await executeSQL(migrationSQL);
    
    console.log('✅ Migration executed successfully!\n');
    console.log('🔍 Verifying...\n');
    
    // Verify query
    const verifySQL = `SELECT column_name FROM information_schema.columns WHERE table_name='candidates' AND column_name IN ('nationality', 'position', 'experience_years', 'country_of_interest', 'skills', 'languages', 'education', 'certifications', 'previous_employment', 'passport_expiry', 'professional_summary', 'extraction_confidence', 'extraction_source', 'extracted_at');`;
    
    const verifyResult = await executeSQL(verifySQL);
    console.log('✨ Verification result:', verifyResult.data);
    console.log('\n✅ Migration completed!\n');

  } catch (error) {
    console.error('❌ Error:', error.message, '\n');
    console.log('📋 MIGRATION SQL (for manual execution):\n');
    console.log('='.repeat(70));
    console.log(migrationSQL);
    console.log('='.repeat(70));
  }
}

main();
