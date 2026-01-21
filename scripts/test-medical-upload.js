const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

const BACKEND_URL = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
const MEDICAL_FILE_PATH = path.join(__dirname, '..', '..', 'sample_medical_muhammad_farhan.pdf');
const CANDIDATE_ID = 'e8248a6c-a814-48e0-83c4-b4a89139815f'; // Use existing candidate
const POLLING_INTERVAL = 2000; // 2 seconds
const MAX_POLL_ATTEMPTS = 15; // 30 seconds total for categorization

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testMedicalUpload() {
  log('\n🧪 ========================================', 'cyan');
  log('🧪 Medical File Upload Test', 'cyan');
  log('🧪 ========================================', 'cyan');
  log(`\n📍 Backend URL: ${BACKEND_URL}`, 'blue');
  log(`📁 File: ${path.basename(MEDICAL_FILE_PATH)}`, 'blue');

  // Check if file exists
  if (!fs.existsSync(MEDICAL_FILE_PATH)) {
    log(`\n❌ File not found: ${MEDICAL_FILE_PATH}`, 'red');
    process.exit(1);
  }

  const fileStats = fs.statSync(MEDICAL_FILE_PATH);
  const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
  log(`   Size: ${fileSizeMB} MB (${fileStats.size} bytes)`, 'blue');

  if (fileStats.size > 10 * 1024 * 1024) {
    log(`   ⚠️  File EXCEEDS 10MB limit!`, 'yellow');
  } else {
    log(`   ✅ File size is within limit`, 'green');
  }

  let documentId = null;
  let requestId = null;

  // Test 1: Upload Document
  log('\n🔍 Test 1: Upload Medical Document', 'cyan');
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(MEDICAL_FILE_PATH), path.basename(MEDICAL_FILE_PATH));
    formData.append('candidate_id', CANDIDATE_ID);
    formData.append('source', 'web');

    log(`   Uploading... (this may take a while for large files)`, 'blue');
    const startTime = Date.now();
    
    const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    log(`   Upload completed in ${duration} seconds`, 'blue');

    if (!response.ok) {
      const errorText = await response.text();
      log(`   ❌ Upload failed: ${response.status} ${errorText}`, 'red');
      process.exit(1);
    }

    const data = await response.json();
    documentId = data.document?.id;
    requestId = data.request_id;

    log(`   ✅ Upload successful!`, 'green');
    log(`   Document ID: ${documentId}`, 'blue');
    log(`   Request ID: ${requestId}`, 'blue');
    log(`   Initial status: ${data.document?.verification_status}`, 'blue');
    log(`   Category: ${data.document?.category || 'pending'}`, 'blue');

  } catch (error) {
    log(`   ❌ Upload error: ${error.message}`, 'red');
    if (error.message.includes('timeout') || error.message.includes('aborted')) {
      log(`   ⚠️  This appears to be a timeout issue`, 'yellow');
      log(`   Possible causes:`, 'yellow');
      log(`   - Railway proxy timeout (60s default)`, 'yellow');
      log(`   - Network connection too slow`, 'yellow');
      log(`   - File too large for current connection`, 'yellow');
    }
    process.exit(1);
  }

  // Test 2: Wait for Categorization
  log('\n🔍 Test 2: Wait for AI Categorization (max 30s)', 'cyan');
  try {
    let finalDocument = null;
    let attempts = 0;
    const pollStartTime = Date.now();

    while (attempts < MAX_POLL_ATTEMPTS) {
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
      
      const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${documentId}`);
      const data = await response.json();
      finalDocument = data.document;

      const currentStatus = finalDocument?.verification_status;
      const currentCategory = finalDocument?.category || 'pending';
      const elapsed = ((Date.now() - pollStartTime) / 1000).toFixed(1);

      log(`   Attempt ${attempts + 1}/${MAX_POLL_ATTEMPTS} (${elapsed}s): Status=${currentStatus}, Category=${currentCategory}`, 'blue');

      if (currentStatus !== 'pending_ai') {
        break;
      }
      attempts++;
    }

    const pollEndTime = Date.now();
    const pollDuration = ((pollEndTime - pollStartTime) / 1000).toFixed(1);

    if (finalDocument?.verification_status !== 'pending_ai') {
      log(`   ✅ Categorization completed in ${pollDuration}s`, 'green');
      log(`   Final status: ${finalDocument?.verification_status}`, 'blue');
      log(`   Final category: ${finalDocument?.category}`, 'blue');
      log(`   Confidence: ${finalDocument?.confidence || 'N/A'}`, 'blue');
      
      if (finalDocument?.category === 'medical_report') {
        log(`   ✅ Correctly categorized as medical report!`, 'green');
      } else {
        log(`   ⚠️  Category is: ${finalDocument?.category} (expected: medical_report)`, 'yellow');
      }
    } else {
      log(`   ⚠️  Categorization still pending after ${pollDuration}s`, 'yellow');
      log(`   This may take longer for large files`, 'yellow');
    }

  } catch (error) {
    log(`   ❌ Error checking status: ${error.message}`, 'red');
  }

  // Test 3: Verify Document Details
  log('\n🔍 Test 3: Verify Document Details', 'cyan');
  try {
    const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${documentId}`);
    const data = await response.json();
    const doc = data.document;

    log(`   ✅ Document retrieved successfully`, 'green');
    log(`   File name: ${doc.file_name}`, 'blue');
    log(`   File size: ${doc.file_size ? (doc.file_size / 1024).toFixed(2) + ' KB' : 'N/A'}`, 'blue');
    log(`   MIME type: ${doc.mime_type}`, 'blue');
    log(`   Category: ${doc.category || 'pending'}`, 'blue');
    log(`   Status: ${doc.verification_status}`, 'blue');
    log(`   Created: ${doc.created_at}`, 'blue');

  } catch (error) {
    log(`   ❌ Error retrieving document: ${error.message}`, 'red');
  }

  log('\n📊 ========================================', 'cyan');
  log('📊 Test Summary', 'cyan');
  log('📊 ========================================', 'cyan');
  log(`\n✅ Upload: Successful`, 'green');
  log(`📄 Document ID: ${documentId}`, 'blue');
  log(`🔗 View: ${BACKEND_URL}/api/documents/candidate-documents/${documentId}`, 'blue');
  log(`\n🎉 Test completed!`, 'green');
}

testMedicalUpload().catch((error) => {
  log(`\n❌ Test failed: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
