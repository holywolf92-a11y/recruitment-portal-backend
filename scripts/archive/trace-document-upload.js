/**
 * Trace document upload flow to verify endpoint and database connections
 * This script simulates the upload flow and checks each step
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log('🔍 Tracing Document Upload Flow...\n');
console.log('='.repeat(60));

async function checkDocumentUploadFlow() {
  console.log('\n1️⃣  Checking Recent Document Uploads...');
  
  try {
    // Check candidate_documents table (new system)
    const { data: recentDocs, error: docsError } = await supabase
      .from('candidate_documents')
      .select('id, candidate_id, file_name, verification_status, category, created_at, ai_processing_started_at, ai_processing_completed_at')
      .order('created_at', { ascending: false })
      .limit(5);

    if (docsError) {
      console.log(`   ❌ Error: ${docsError.message}`);
      return;
    }

    if (!recentDocs || recentDocs.length === 0) {
      console.log('   ⚠️  No documents found in candidate_documents table');
      console.log('   💡 This suggests documents are not being uploaded via new endpoint');
      return;
    }

    console.log(`   ✅ Found ${recentDocs.length} recent document(s) in candidate_documents:`);
    recentDocs.forEach((doc, i) => {
      const age = Math.floor((new Date() - new Date(doc.created_at)) / 60000);
      console.log(`\n   ${i + 1}. ${doc.file_name}`);
      console.log(`      ID: ${doc.id}`);
      console.log(`      Candidate ID: ${doc.candidate_id}`);
      console.log(`      Status: ${doc.verification_status || 'N/A'}`);
      console.log(`      Category: ${doc.category || 'N/A'}`);
      console.log(`      Age: ${age} minutes`);
      console.log(`      AI Started: ${doc.ai_processing_started_at ? '✅ Yes' : '❌ No'}`);
      console.log(`      AI Completed: ${doc.ai_processing_completed_at ? '✅ Yes' : '❌ No'}`);
      
      if (doc.verification_status === 'pending_ai' && !doc.ai_processing_started_at) {
        console.log(`      ⚠️  STATUS: Queued but not processing`);
      } else if (doc.verification_status === 'pending_ai' && doc.ai_processing_started_at) {
        console.log(`      ⚠️  STATUS: Processing but not completed`);
      } else if (doc.verification_status === 'verified') {
        console.log(`      ✅ STATUS: Verified`);
      }
    });

    // Check if candidate exists for these documents
    console.log('\n2️⃣  Verifying Candidate Records...');
    for (const doc of recentDocs) {
      const { data: candidate, error: candidateError } = await supabase
        .from('candidates')
        .select('id, name, candidate_code, email, phone')
        .eq('id', doc.candidate_id)
        .maybeSingle();

      if (candidateError) {
        console.log(`   ❌ Error checking candidate ${doc.candidate_id}: ${candidateError.message}`);
      } else if (!candidate) {
        console.log(`   ⚠️  Candidate ${doc.candidate_id} NOT FOUND in database!`);
        console.log(`      Document: ${doc.file_name}`);
        console.log(`      💡 This is a problem - document is linked to non-existent candidate`);
      } else {
        console.log(`   ✅ Candidate found: ${candidate.name} (${candidate.candidate_code})`);
      }
    }

    // Check verification logs
    console.log('\n3️⃣  Checking Verification Logs...');
    const { data: logs, error: logsError } = await supabase
      .from('document_verification_logs')
      .select('event_type, event_status, created_at, document_id, candidate_id')
      .order('created_at', { ascending: false })
      .limit(10);

    if (logsError) {
      console.log(`   ⚠️  Error: ${logsError.message}`);
    } else if (!logs || logs.length === 0) {
      console.log('   ⚠️  No verification logs found');
      console.log('   💡 This suggests the worker has never processed any documents');
    } else {
      console.log(`   ✅ Found ${logs.length} verification log entries`);
      logs.slice(0, 5).forEach((log, i) => {
        const age = Math.floor((new Date() - new Date(log.created_at)) / 60000);
        const status = log.event_status === 'success' ? '✅' : log.event_status === 'failure' ? '❌' : '⏳';
        console.log(`      ${i + 1}. ${status} ${log.event_type} (${age} min ago)`);
        if (log.document_id) {
          console.log(`         Document: ${log.document_id}`);
        }
      });
    }

    // Check if documents are in the right table
    console.log('\n4️⃣  Checking Database Tables...');
    
    // Check old documents table (should be empty or minimal)
    const { count: oldDocsCount } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true });
    
    console.log(`   candidate_documents (new): ${recentDocs.length} recent documents`);
    console.log(`   documents (old): ${oldDocsCount || 0} total documents`);
    
    if (oldDocsCount > 0) {
      console.log(`   ⚠️  Old documents table still has ${oldDocsCount} documents`);
      console.log(`   💡 This is OK if they're legacy, but new uploads should use candidate_documents`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function checkQueueStatus() {
  console.log('\n5️⃣  Checking Job Queue Status...');
  
  const REDIS_URL = process.env.REDIS_URL;
  if (!REDIS_URL) {
    console.log('   ⚠️  REDIS_URL not set - cannot check queue');
    return;
  }

  try {
    const IORedis = require('ioredis');
    const { Queue } = require('bullmq');
    
    const redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      connectTimeout: 5000,
    });

    await redis.ping();
    console.log('   ✅ Redis connected');
    
    const queue = new Queue('document-verification', { connection: redis });
    
    const waiting = await queue.getWaiting();
    const active = await queue.getActive();
    const completed = await queue.getCompleted();
    const failed = await queue.getFailed();
    
    console.log(`   📊 Queue Status:`);
    console.log(`      Waiting: ${waiting.length} jobs`);
    console.log(`      Active: ${active.length} jobs`);
    console.log(`      Completed: ${completed.length} jobs`);
    console.log(`      Failed: ${failed.length} jobs`);
    
    if (waiting.length > 0) {
      console.log(`\n   ⚠️  ${waiting.length} job(s) waiting in queue (worker may not be running):`);
      waiting.slice(0, 3).forEach((job, i) => {
        console.log(`      ${i + 1}. Job ${job.id}`);
        console.log(`         Document: ${job.data.fileName || 'unknown'}`);
        console.log(`         Candidate: ${job.data.candidateId || 'unknown'}`);
      });
    }
    
    if (failed.length > 0) {
      console.log(`\n   ❌ ${failed.length} job(s) failed:`);
      failed.slice(0, 3).forEach((job, i) => {
        console.log(`      ${i + 1}. Job ${job.id}`);
        console.log(`         Error: ${job.failedReason || 'unknown'}`);
      });
    }
    
    await redis.quit();
  } catch (error) {
    console.log(`   ❌ Redis connection failed: ${error.message}`);
    console.log('   💡 Worker cannot process jobs without Redis');
  }
}

async function runTrace() {
  await checkDocumentUploadFlow();
  await checkQueueStatus();

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Summary:\n');
  console.log('✅ Checked:');
  console.log('   - Documents in candidate_documents table');
  console.log('   - Candidate records exist');
  console.log('   - Verification logs');
  console.log('   - Job queue status');
  console.log('\n💡 Next Steps:');
  console.log('   1. Check Railway logs for worker errors');
  console.log('   2. Verify worker is starting');
  console.log('   3. Check if jobs are being queued');
  console.log('   4. Check if jobs are being processed');
}

runTrace().catch(console.error);
