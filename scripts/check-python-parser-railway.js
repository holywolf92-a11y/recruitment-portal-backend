/**
 * Check Python Parser Service Status on Railway
 * Tests if the service is running and accessible
 */

const PYTHON_PARSER_URL = 'https://recruitment-python-parser-production.up.railway.app';
const PYTHON_HMAC_SECRET = 'Itbfr/p8ky/dRMAHLdi/DIiQRLEJtm2SqyNfwuXa3r0=';

console.log('🔍 Checking Python Parser Service on Railway...\n');
console.log('='.repeat(60));
console.log(`\n📍 Service URL: ${PYTHON_PARSER_URL}\n`);

async function testRootEndpoint() {
  console.log('1️⃣  Testing Root Endpoint (/)...');
  try {
    const response = await fetch(`${PYTHON_PARSER_URL}/`, {
      method: 'GET',
    });

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      console.log('   ✅ Service is running!');
      console.log(`   Status: ${response.status}`);
      if (data.service) {
        console.log(`   Service: ${data.service}`);
        console.log(`   Version: ${data.version || 'N/A'}`);
        console.log(`   Status: ${data.status || 'N/A'}`);
      }
      return true;
    } else {
      console.log(`   ⚠️  Service returned ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Connection failed: ${error.message}`);
    if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      console.log('   💡 Service may be down or URL is incorrect');
    }
    return false;
  }
}

async function testHealthEndpoint() {
  console.log('\n2️⃣  Testing Health Endpoint (/health)...');
  try {
    const response = await fetch(`${PYTHON_PARSER_URL}/health`, {
      method: 'GET',
    });

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      console.log('   ✅ Health check passed!');
      console.log(`   Status: ${data.status || 'ok'}`);
      return true;
    } else {
      console.log(`   ⚠️  Health check returned ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Health check failed: ${error.message}`);
    return false;
  }
}

async function testCategorizeEndpoint() {
  console.log('\n3️⃣  Testing Categorize Document Endpoint (/categorize-document)...');
  
  const crypto = require('crypto');
  
  // Create minimal test PDF
  const minimalPDF = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 1\ntrailer\n<< /Size 1 /Root 1 0 R >>\nstartxref\n9\n%%EOF'
  ).toString('base64');

  const requestBody = JSON.stringify({
    file_content: minimalPDF,
    file_name: 'test-passport.pdf',
    mime_type: 'application/pdf',
    operation: 'categorize_document',
  });

  const signature = crypto.createHmac('sha256', PYTHON_HMAC_SECRET).update(requestBody).digest('hex');

  try {
    const response = await fetch(`${PYTHON_PARSER_URL}/categorize-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HMAC-Signature': signature,
      },
      body: requestBody,
    });

    if (response.ok) {
      const result = await response.json();
      console.log('   ✅ Categorization endpoint works!');
      console.log(`   Category: ${result.category || 'N/A'}`);
      console.log(`   Confidence: ${result.confidence || 'N/A'}`);
      console.log(`   Success: ${result.success}`);
      return true;
    } else {
      const errorText = await response.text();
      console.log(`   ❌ Request failed: ${response.status}`);
      console.log(`   Error: ${errorText.substring(0, 200)}`);
      
      if (response.status === 401 || response.status === 403) {
        console.log('   💡 HMAC signature may be incorrect');
      }
      return false;
    }
  } catch (error) {
    console.log(`   ❌ Request failed: ${error.message}`);
    return false;
  }
}

async function checkBackendConfiguration() {
  console.log('\n4️⃣  Checking Backend Configuration...');
  
  require('dotenv').config();
  
  const RUN_WORKER = process.env.RUN_WORKER;
  const REDIS_URL = process.env.REDIS_URL;
  const PYTHON_URL = process.env.PYTHON_CV_PARSER_URL;
  const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET;
  
  console.log(`   RUN_WORKER: ${RUN_WORKER || '❌ not set'}`);
  console.log(`   REDIS_URL: ${REDIS_URL ? '✅ set' : '❌ missing'}`);
  console.log(`   PYTHON_CV_PARSER_URL: ${PYTHON_URL ? '✅ set' : '❌ missing'}`);
  console.log(`   PYTHON_HMAC_SECRET: ${HMAC_SECRET ? '✅ set' : '❌ missing'}`);
  
  if (RUN_WORKER !== 'true') {
    console.log('\n   ⚠️  RUN_WORKER is not "true" - worker will not start');
  }
  
  if (!REDIS_URL) {
    console.log('\n   ⚠️  REDIS_URL is missing - worker cannot connect to queue');
  }
  
  if (!PYTHON_URL) {
    console.log('\n   ⚠️  PYTHON_CV_PARSER_URL is missing - worker cannot call parser');
  }
  
  if (!HMAC_SECRET) {
    console.log('\n   ⚠️  PYTHON_HMAC_SECRET is missing - requests will fail authentication');
  }
  
  const allSet = RUN_WORKER === 'true' && REDIS_URL && PYTHON_URL && HMAC_SECRET;
  return allSet;
}

async function checkPendingJobs() {
  console.log('\n5️⃣  Checking Pending Document Verification Jobs...');
  
  try {
    const { createClient } = require('@supabase/supabase-js');
    require('dotenv').config();
    
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.log('   ⚠️  Supabase credentials not set - skipping');
      return;
    }
    
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Check pending documents
    const { data: pendingDocs, error: docsError } = await supabase
      .from('candidate_documents')
      .select('id, file_name, verification_status, created_at, ai_processing_started_at')
      .eq('verification_status', 'pending_ai')
      .order('created_at', { ascending: false })
      .limit(5);

    if (docsError) {
      console.log(`   ⚠️  Error: ${docsError.message}`);
      return;
    }

    if (!pendingDocs || pendingDocs.length === 0) {
      console.log('   ✅ No pending documents');
      return;
    }

    console.log(`   ⚠️  Found ${pendingDocs.length} pending document(s):`);
    pendingDocs.forEach((doc, i) => {
      const age = Math.floor((new Date() - new Date(doc.created_at)) / 60000);
      const started = doc.ai_processing_started_at ? 'processing' : 'queued';
      console.log(`      ${i + 1}. ${doc.file_name} (${age} min ago, ${started})`);
    });
    
  } catch (error) {
    console.log(`   ⚠️  Could not check: ${error.message}`);
  }
}

async function runDiagnostics() {
  const rootOk = await testRootEndpoint();
  const healthOk = await testHealthEndpoint();
  const categorizeOk = await testCategorizeEndpoint();
  const configOk = await checkBackendConfiguration();
  await checkPendingJobs();

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Diagnostic Summary:\n');
  
  console.log(`  Python Service Root: ${rootOk ? '✅ RUNNING' : '❌ DOWN'}`);
  console.log(`  Python Service Health: ${healthOk ? '✅ OK' : '❌ FAIL'}`);
  console.log(`  Categorization Endpoint: ${categorizeOk ? '✅ WORKING' : '❌ FAIL'}`);
  console.log(`  Backend Configuration: ${configOk ? '✅ COMPLETE' : '⚠️  INCOMPLETE'}`);

  console.log('\n' + '='.repeat(60));
  
  if (!rootOk || !healthOk) {
    console.log('\n❌ Python parser service is NOT running!');
    console.log('\n🔧 Action Required:');
    console.log('   1. Go to Railway Dashboard');
    console.log('   2. Check Python Parser service status');
    console.log('   3. Check service logs for errors');
    console.log('   4. Verify service is deployed');
  } else if (!categorizeOk) {
    console.log('\n⚠️  Python service is running but categorization is failing!');
    console.log('\n🔧 Check:');
    console.log('   1. HMAC_SECRET matches between backend and Python service');
    console.log('   2. Python service logs for errors');
    console.log('   3. OpenAI API key is set in Python service');
  } else if (!configOk) {
    console.log('\n⚠️  Python service works, but backend worker is not configured!');
    console.log('\n🔧 Fix in Railway Dashboard → Backend Service → Variables:');
    console.log('   1. Set RUN_WORKER=true');
    console.log('   2. Set REDIS_URL (from Railway Redis service)');
    console.log('   3. Set PYTHON_CV_PARSER_URL');
    console.log('   4. Set PYTHON_HMAC_SECRET');
    console.log('   5. Restart backend service');
  } else {
    console.log('\n✅ All systems operational!');
    console.log('\n💡 If documents are still pending:');
    console.log('   - Check Railway backend logs for worker errors');
    console.log('   - Verify Redis connection');
    console.log('   - Check job queue status');
    console.log('   - Use "Reprocess" button to manually trigger');
  }
}

runDiagnostics().catch(console.error);
