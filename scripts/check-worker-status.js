/**
 * Check if the document verification worker is actually running and processing jobs
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REDIS_URL = process.env.REDIS_URL;

console.log('🔍 Checking Worker Status and Queue...\n');
console.log('='.repeat(60));

async function checkPendingDocuments() {
  console.log('\n1️⃣  Checking Pending Documents in Database...');
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log('   ⚠️  Supabase credentials not set - skipping');
    return { count: 0, documents: [] };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: pendingDocs, error } = await supabase
      .from('candidate_documents')
      .select('id, file_name, verification_status, created_at, ai_processing_started_at, category')
      .eq('verification_status', 'pending_ai')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.log(`   ❌ Error: ${error.message}`);
      return { count: 0, documents: [] };
    }

    if (!pendingDocs || pendingDocs.length === 0) {
      console.log('   ✅ No pending documents');
      return { count: 0, documents: [] };
    }

    console.log(`   ⚠️  Found ${pendingDocs.length} pending document(s):`);
    pendingDocs.forEach((doc, i) => {
      const age = Math.floor((new Date() - new Date(doc.created_at)) / 60000);
      const started = doc.ai_processing_started_at ? '✅ processing' : '⏳ queued';
      console.log(`      ${i + 1}. ${doc.file_name}`);
      console.log(`         Status: ${started}, Age: ${age} minutes, Category: ${doc.category || 'N/A'}`);
    });
    
    return { count: pendingDocs.length, documents: pendingDocs };
  } catch (error) {
    console.log(`   ⚠️  Error: ${error.message}`);
    return { count: 0, documents: [] };
  }
}

async function checkRedisConnection() {
  console.log('\n2️⃣  Checking Redis Connection...');
  
  if (!REDIS_URL) {
    console.log('   ❌ REDIS_URL not set');
    return false;
  }

  try {
    const redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      connectTimeout: 5000,
    });

    await redis.ping();
    console.log('   ✅ Redis connection successful');
    
    // Check queue status
    const queue = new Queue('document-verification', { connection: redis });
    
    const waiting = await queue.getWaiting();
    const active = await queue.getActive();
    const completed = await queue.getCompleted();
    const failed = await queue.getFailed();
    
    console.log(`   📊 Queue Status:`);
    console.log(`      Waiting: ${waiting.length}`);
    console.log(`      Active: ${active.length}`);
    console.log(`      Completed: ${completed.length}`);
    console.log(`      Failed: ${failed.length}`);
    
    if (waiting.length > 0) {
      console.log(`\n   ⚠️  ${waiting.length} job(s) waiting in queue:`);
      waiting.slice(0, 5).forEach((job, i) => {
        console.log(`      ${i + 1}. Job ${job.id} - ${job.data.fileName || 'unknown'}`);
      });
    }
    
    if (active.length > 0) {
      console.log(`\n   ✅ ${active.length} job(s) currently processing:`);
      active.forEach((job, i) => {
        console.log(`      ${i + 1}. Job ${job.id} - ${job.data.fileName || 'unknown'}`);
      });
    }
    
    if (failed.length > 0) {
      console.log(`\n   ❌ ${failed.length} job(s) failed:`);
      failed.slice(0, 5).forEach((job, i) => {
        console.log(`      ${i + 1}. Job ${job.id} - ${job.failedReason || 'unknown error'}`);
      });
    }
    
    await redis.quit();
    return true;
  } catch (error) {
    console.log(`   ❌ Redis connection failed: ${error.message}`);
    return false;
  }
}

async function checkVerificationLogs() {
  console.log('\n3️⃣  Checking Recent Verification Logs...');
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log('   ⚠️  Supabase credentials not set - skipping');
    return;
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: logs, error } = await supabase
      .from('document_verification_logs')
      .select('event_type, event_status, created_at, error_message')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.log(`   ⚠️  Error: ${error.message}`);
      return;
    }

    if (!logs || logs.length === 0) {
      console.log('   ⚠️  No verification logs found');
      console.log('   💡 This suggests the worker has never processed any documents');
      return;
    }

    console.log(`   📋 Recent verification events (${logs.length}):`);
    logs.forEach((log, i) => {
      const age = Math.floor((new Date() - new Date(log.created_at)) / 60000);
      const status = log.event_status === 'success' ? '✅' : log.event_status === 'failure' ? '❌' : '⏳';
      console.log(`      ${i + 1}. ${status} ${log.event_type} (${age} min ago)`);
      if (log.error_message) {
        console.log(`         Error: ${log.error_message.substring(0, 100)}`);
      }
    });
  } catch (error) {
    console.log(`   ⚠️  Error: ${error.message}`);
  }
}

async function checkWorkerProcess() {
  console.log('\n4️⃣  Checking if Worker Process is Running...');
  
  console.log('   💡 To check if worker is running:');
  console.log('      1. Go to Railway Dashboard → Backend Service → Logs');
  console.log('      2. Look for: "Document Verification worker started"');
  console.log('      3. Look for: "[DocumentVerification] Processing job"');
  console.log('      4. If you see errors, check the error message');
  
  const RUN_WORKER = process.env.RUN_WORKER;
  const REDIS_URL = process.env.REDIS_URL;
  const PYTHON_URL = process.env.PYTHON_CV_PARSER_URL;
  const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET;
  
  console.log('\n   📋 Environment Check:');
  console.log(`      RUN_WORKER: ${RUN_WORKER || '❌ not set'}`);
  console.log(`      REDIS_URL: ${REDIS_URL ? '✅ set' : '❌ missing'}`);
  console.log(`      PYTHON_CV_PARSER_URL: ${PYTHON_URL ? '✅ set' : '❌ missing'}`);
  console.log(`      PYTHON_HMAC_SECRET: ${HMAC_SECRET ? '✅ set' : '❌ missing'}`);
  
  if (RUN_WORKER === 'true' && REDIS_URL && PYTHON_URL && HMAC_SECRET) {
    console.log('\n   ✅ All required variables are set');
    console.log('   💡 Worker should start automatically on backend restart');
  } else {
    console.log('\n   ⚠️  Some required variables are missing');
    console.log('   💡 Worker will not start until all are set');
  }
}

async function runDiagnostics() {
  const pending = await checkPendingDocuments();
  const redisOk = await checkRedisConnection();
  await checkVerificationLogs();
  await checkWorkerProcess();

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Summary:\n');
  
  console.log(`  Pending Documents: ${pending.count}`);
  console.log(`  Redis Connection: ${redisOk ? '✅ OK' : '❌ FAIL'}`);
  
  if (pending.count > 0 && redisOk) {
    console.log('\n⚠️  Documents are pending but Redis is working');
    console.log('   Possible issues:');
    console.log('   1. Worker process is not running (check Railway logs)');
    console.log('   2. Jobs are stuck in queue (check queue status above)');
    console.log('   3. Worker is crashing (check Railway logs for errors)');
    console.log('\n   💡 Action: Check Railway backend logs for worker errors');
  } else if (pending.count > 0 && !redisOk) {
    console.log('\n❌ Redis connection failed - worker cannot run');
    console.log('   Fix: Check REDIS_URL in Railway');
  } else if (pending.count === 0) {
    console.log('\n✅ No pending documents - everything is processed!');
  }
}

runDiagnostics().catch(console.error);
