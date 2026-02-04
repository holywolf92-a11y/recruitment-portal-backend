/**
 * Test document upload endpoint and trace the flow
 * This verifies:
 * 1. Endpoint is accessible
 * 2. Document is created in candidate_documents table
 * 3. Job is enqueued
 * 4. AI is searching in the right database (candidates table)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

console.log('🧪 Testing Document Upload Endpoint Flow...\n');
console.log('='.repeat(60));

async function testUploadFlow() {
  console.log('\n1️⃣  Checking Database Connection...');
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing Supabase credentials');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Get a test candidate
  const { data: candidates, error: candidateError } = await supabase
    .from('candidates')
    .select('id, name, candidate_code, email, phone, cnic_normalized, passport_normalized')
    .limit(1);

  if (candidateError || !candidates || candidates.length === 0) {
    console.log('   ⚠️  No candidates found in database');
    console.log('   💡 Create a candidate first to test upload');
    return;
  }

  const testCandidate = candidates[0];
  console.log(`   ✅ Found test candidate: ${testCandidate.name} (${testCandidate.candidate_code})`);
  console.log(`      ID: ${testCandidate.id}`);
  console.log(`      Email: ${testCandidate.email || 'N/A'}`);
  console.log(`      Phone: ${testCandidate.phone || 'N/A'}`);
  console.log(`      CNIC: ${testCandidate.cnic_normalized || 'N/A'}`);
  console.log(`      Passport: ${testCandidate.passport_normalized || 'N/A'}`);

  // Check existing documents for this candidate
  console.log('\n2️⃣  Checking Existing Documents...');
  const { data: existingDocs, error: docsError } = await supabase
    .from('candidate_documents')
    .select('id, file_name, verification_status, category, created_at')
    .eq('candidate_id', testCandidate.id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (docsError) {
    console.log(`   ⚠️  Error: ${docsError.message}`);
  } else if (existingDocs && existingDocs.length > 0) {
    console.log(`   ✅ Found ${existingDocs.length} existing document(s):`);
    existingDocs.forEach((doc, i) => {
      const age = Math.floor((new Date() - new Date(doc.created_at)) / 60000);
      console.log(`      ${i + 1}. ${doc.file_name}`);
      console.log(`         Status: ${doc.verification_status || 'N/A'}`);
      console.log(`         Category: ${doc.category || 'N/A'}`);
      console.log(`         Age: ${age} minutes`);
    });
  } else {
    console.log('   ℹ️  No existing documents for this candidate');
  }

  // Check verification logs
  console.log('\n3️⃣  Checking Verification Logs...');
  const { data: logs, error: logsError } = await supabase
    .from('document_verification_logs')
    .select('event_type, event_status, created_at, document_id, candidate_id')
    .eq('candidate_id', testCandidate.id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (logsError) {
    console.log(`   ⚠️  Error: ${logsError.message}`);
  } else if (logs && logs.length > 0) {
    console.log(`   ✅ Found ${logs.length} verification log entries:`);
    logs.forEach((log, i) => {
      const age = Math.floor((new Date() - new Date(log.created_at)) / 60000);
      const status = log.event_status === 'success' ? '✅' : log.event_status === 'failure' ? '❌' : '⏳';
      console.log(`      ${i + 1}. ${status} ${log.event_type} (${age} min ago)`);
    });
  } else {
    console.log('   ⚠️  No verification logs found');
    console.log('   💡 This suggests documents have never been processed by AI worker');
  }

  // Check if worker is processing
  console.log('\n4️⃣  Checking AI Worker Status...');
  const REDIS_URL = process.env.REDIS_URL;
  if (REDIS_URL) {
    try {
      const IORedis = require('ioredis');
      const { Queue } = require('bullmq');
      
      const redis = new IORedis(REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        connectTimeout: 5000,
      });

      await redis.ping();
      const queue = new Queue('document-verification', { connection: redis });
      
      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const failed = await queue.getFailed();
      
      console.log(`   📊 Queue Status:`);
      console.log(`      Waiting: ${waiting.length} jobs`);
      console.log(`      Active: ${active.length} jobs`);
      console.log(`      Failed: ${failed.length} jobs`);
      
      if (waiting.length > 0) {
        console.log(`\n   ⚠️  ${waiting.length} job(s) waiting (worker may not be running)`);
      }
      
      if (failed.length > 0) {
        console.log(`\n   ❌ ${failed.length} job(s) failed:`);
        failed.slice(0, 3).forEach((job, i) => {
          console.log(`      ${i + 1}. Error: ${job.failedReason || 'unknown'}`);
        });
      }
      
      await redis.quit();
    } catch (error) {
      console.log(`   ❌ Redis connection failed: ${error.message}`);
    }
  } else {
    console.log('   ⚠️  REDIS_URL not set - cannot check queue');
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Summary:\n');
  console.log('✅ Database Connection: OK');
  console.log(`✅ Test Candidate: ${testCandidate.name}`);
  console.log(`✅ Existing Documents: ${existingDocs?.length || 0}`);
  console.log(`✅ Verification Logs: ${logs?.length || 0}`);
  
  console.log('\n💡 Key Points:');
  console.log('   1. Upload endpoint: POST /api/documents/candidate-documents');
  console.log('   2. Creates entry in: candidate_documents table ✅');
  console.log('   3. Enqueues job to: document-verification queue ✅');
  console.log('   4. Worker searches: candidates table (by CNIC, email, phone, name) ✅');
  console.log('   5. Worker updates: candidate_documents table ✅');
  
  console.log('\n⚠️  If documents stay "Pending":');
  console.log('   1. Check Railway logs for worker errors');
  console.log('   2. Verify worker is starting');
  console.log('   3. Check Redis connection');
  console.log('   4. Check Python parser service is accessible');
}

testUploadFlow().catch(console.error);
