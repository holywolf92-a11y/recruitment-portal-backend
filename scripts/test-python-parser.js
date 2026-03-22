/**
 * Test Python Parser Service Connection
 * Checks if the Python parser is running and can process documents
 */

require('dotenv').config();
const crypto = require('crypto');

const PY_URL = process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-python-parser-production.up.railway.app';
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET;

console.log('🔍 Testing Python Parser Service...\n');
console.log('='.repeat(60));

// Check environment variables
console.log('\n📋 Environment Variables:');
console.log(`  PYTHON_CV_PARSER_URL: ${PY_URL ? '✅ Set' : '❌ Missing'}`);
console.log(`  PYTHON_HMAC_SECRET: ${HMAC_SECRET ? '✅ Set' : '❌ Missing'}`);

if (!HMAC_SECRET) {
  console.error('\n❌ PYTHON_HMAC_SECRET is required but not set!');
  console.error('   Set it in Railway Dashboard → Backend Service → Variables');
  process.exit(1);
}

// Sign request body with HMAC-SHA256
function signHmac(body) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

async function testHealthCheck() {
  console.log('\n🏥 Testing Health Check...');
  try {
    const response = await fetch(`${PY_URL}/health`, {
      method: 'GET',
    });

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      console.log('  ✅ Python parser is running');
      console.log(`  Status: ${response.status}`);
      if (data) {
        console.log(`  Response: ${JSON.stringify(data)}`);
      }
      return true;
    } else {
      console.log(`  ⚠️  Health check returned ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log(`  ❌ Health check failed: ${error.message}`);
    return false;
  }
}

async function testCategorizeDocument() {
  console.log('\n📄 Testing Document Categorization...');
  
  // Create a minimal test document (small base64 encoded PDF)
  // This is a minimal valid PDF structure
  const minimalPDF = Buffer.from(
    '%PDF-1.4\n' +
    '1 0 obj\n' +
    '<< /Type /Catalog /Pages 2 0 R >>\n' +
    'endobj\n' +
    '2 0 obj\n' +
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n' +
    'endobj\n' +
    '3 0 obj\n' +
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\n' +
    'endobj\n' +
    'xref\n' +
    '0 4\n' +
    '0000000000 65535 f \n' +
    '0000000009 00000 n \n' +
    '0000000058 00000 n \n' +
    '0000000115 00000 n \n' +
    'trailer\n' +
    '<< /Size 4 /Root 1 0 R >>\n' +
    'startxref\n' +
    '174\n' +
    '%%EOF'
  ).toString('base64');

  const requestBody = JSON.stringify({
    file_content: minimalPDF,
    file_name: 'test-passport.pdf',
    mime_type: 'application/pdf',
    operation: 'categorize_document',
  });

  const signature = signHmac(requestBody);

  try {
    console.log(`  Calling: ${PY_URL}/categorize-document`);
    console.log(`  File: test-passport.pdf (${minimalPDF.length} chars base64)`);
    
    const response = await fetch(`${PY_URL}/categorize-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HMAC-Signature': signature,
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`  ❌ Request failed: ${response.status} ${response.statusText}`);
      console.log(`  Error: ${errorText.substring(0, 200)}`);
      return false;
    }

    const result = await response.json();
    console.log('  ✅ Document categorization successful!');
    console.log(`  Category: ${result.category || 'N/A'}`);
    console.log(`  Confidence: ${result.confidence || 'N/A'}`);
    console.log(`  Success: ${result.success}`);
    
    if (result.error) {
      console.log(`  ⚠️  Error in response: ${result.error}`);
    }
    
    return result.success === true;
  } catch (error) {
    console.log(`  ❌ Request failed: ${error.message}`);
    if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      console.log('  💡 The Python parser service may not be running or URL is incorrect');
    }
    return false;
  }
}

async function checkBackendWorkerStatus() {
  console.log('\n🔧 Checking Backend Worker Configuration...');
  
  const RUN_WORKER = process.env.RUN_WORKER;
  const REDIS_URL = process.env.REDIS_URL;
  
  console.log(`  RUN_WORKER: ${RUN_WORKER || 'not set'}`);
  console.log(`  REDIS_URL: ${REDIS_URL ? '✅ Set' : '❌ Missing'}`);
  
  if (RUN_WORKER !== 'true') {
    console.log('  ⚠️  RUN_WORKER is not set to "true" - worker will not start');
  }
  
  if (!REDIS_URL) {
    console.log('  ⚠️  REDIS_URL is missing - worker cannot start');
  }
  
  return RUN_WORKER === 'true' && REDIS_URL;
}

async function checkPendingDocuments() {
  console.log('\n📊 Checking Pending Documents...');
  
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: pendingDocs, error } = await supabase
      .from('candidate_documents')
      .select('id, file_name, verification_status, created_at')
      .eq('verification_status', 'pending_ai')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.log(`  ❌ Error checking documents: ${error.message}`);
      return;
    }

    if (!pendingDocs || pendingDocs.length === 0) {
      console.log('  ✅ No pending documents found');
      return;
    }

    console.log(`  ⚠️  Found ${pendingDocs.length} pending document(s):`);
    pendingDocs.forEach((doc, i) => {
      const age = new Date() - new Date(doc.created_at);
      const ageMinutes = Math.floor(age / 60000);
      console.log(`    ${i + 1}. ${doc.file_name} (${ageMinutes} minutes ago)`);
    });
    
    console.log('\n  💡 These documents are waiting for AI verification');
    console.log('     Use the "Reprocess" button or check if worker is running');
  } catch (error) {
    console.log(`  ⚠️  Could not check documents: ${error.message}`);
  }
}

async function runTests() {
  const healthOk = await testHealthCheck();
  const categorizeOk = await testCategorizeDocument();
  const workerConfigOk = await checkBackendWorkerStatus();
  await checkPendingDocuments();

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 Test Summary:\n');
  
  console.log(`  Health Check: ${healthOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Categorization: ${categorizeOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Worker Config: ${workerConfigOk ? '✅ OK' : '⚠️  ISSUES'}`);

  if (!healthOk || !categorizeOk) {
    console.log('\n❌ Python parser service is not working correctly!');
    console.log('\n🔧 Troubleshooting:');
    console.log('  1. Check Railway Dashboard → Python Parser Service');
    console.log('  2. Verify service is deployed and running');
    console.log('  3. Check service logs for errors');
    console.log('  4. Verify PYTHON_CV_PARSER_URL is correct');
    console.log('  5. Verify PYTHON_HMAC_SECRET matches between services');
  } else if (!workerConfigOk) {
    console.log('\n⚠️  Python parser works, but backend worker is not configured!');
    console.log('\n🔧 Fix:');
    console.log('  1. Set RUN_WORKER=true in Railway');
    console.log('  2. Set REDIS_URL in Railway');
    console.log('  3. Restart backend service');
  } else {
    console.log('\n✅ All systems operational!');
    console.log('   If documents are still pending, check:');
    console.log('   - Railway backend logs for worker errors');
    console.log('   - Redis connection');
    console.log('   - Job queue status');
  }
}

runTests().catch(console.error);
