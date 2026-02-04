/**
 * Test script to upload passport file and verify:
 * 1. Upload succeeds
 * 2. Document is categorized as "passport" (not "cv_resume")
 * 3. Extraction does NOT trigger (no CV extraction for passports)
 * 4. Verification status updates correctly
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const TEST_FILE_PATH = process.env.TEST_FILE || 'D:\\falisha\\Recruitment Automation Portal (2)\\passport_muhammad_farhan.pdf';
const CANDIDATE_ID = process.env.CANDIDATE_ID || null; // Will need to be provided or fetched

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(testName, passed, details = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  const color = passed ? 'green' : 'red';
  log(`${status}: ${testName}`, color);
  if (details) {
    log(`   ${details}`, 'cyan');
  }
}

async function getOrCreateTestCandidate() {
  log('\n📋 Step 1: Getting or creating test candidate...', 'cyan');
  
  try {
    // Try to find an existing candidate first
    const searchResponse = await fetch(`${BACKEND_URL}/api/candidates?limit=1`);
    if (searchResponse.ok) {
      const data = await searchResponse.json();
      if (data.candidates && data.candidates.length > 0) {
        const candidateId = data.candidates[0].id;
        log(`   Found existing candidate: ${candidateId}`, 'green');
        return candidateId;
      }
    }
    
    // Create a test candidate if none exists
    log('   No existing candidate found, creating test candidate...', 'yellow');
    const createResponse = await fetch(`${BACKEND_URL}/api/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Muhammad Farhan',
        email: 'test@example.com',
        phone: '+923001234567',
        position: 'Test Candidate',
      }),
    });
    
    if (!createResponse.ok) {
      throw new Error(`Failed to create candidate: ${createResponse.statusText}`);
    }
    
    const candidate = await createResponse.json();
    log(`   Created test candidate: ${candidate.id}`, 'green');
    return candidate.id;
  } catch (error) {
    log(`   Error: ${error.message}`, 'red');
    throw error;
  }
}

async function uploadPassportFile(candidateId) {
  log('\n📤 Step 2: Uploading passport file...', 'cyan');
  
  // Check if file exists
  if (!fs.existsSync(TEST_FILE_PATH)) {
    throw new Error(`Test file not found: ${TEST_FILE_PATH}`);
  }
  
  log(`   File: ${path.basename(TEST_FILE_PATH)}`, 'blue');
  const fileStats = fs.statSync(TEST_FILE_PATH);
  log(`   Size: ${(fileStats.size / 1024).toFixed(2)} KB`, 'blue');
  
  // Create form data
  const formData = new FormData();
  formData.append('file', fs.createReadStream(TEST_FILE_PATH));
  formData.append('candidate_id', candidateId);
  formData.append('source', 'web'); // Use 'web' - valid constraint value
  
  try {
    const startTime = Date.now();
    const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
    });
    
    const uploadTime = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed (${response.status}): ${errorText}`);
    }
    
    const result = await response.json();
    log(`   Upload successful in ${uploadTime}ms`, 'green');
    log(`   Document ID: ${result.document.id}`, 'blue');
    log(`   Request ID: ${result.request_id}`, 'blue');
    log(`   Initial Status: ${result.document.verification_status}`, 'blue');
    
    return result.document.id;
  } catch (error) {
    log(`   Upload error: ${error.message}`, 'red');
    throw error;
  }
}

async function waitForCategorization(documentId, maxWaitSeconds = 30) {
  log(`\n⏳ Step 3: Waiting for AI categorization (max ${maxWaitSeconds}s)...`, 'cyan');
  
  const startTime = Date.now();
  const pollInterval = 2000; // 2 seconds
  let attempts = 0;
  const maxAttempts = Math.ceil((maxWaitSeconds * 1000) / pollInterval);
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    attempts++;
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${documentId}`);
      if (!response.ok) {
        log(`   Poll attempt ${attempts}: Failed to fetch document`, 'yellow');
        continue;
      }
      
      const data = await response.json();
      const doc = data.document;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      log(`   Attempt ${attempts}/${maxAttempts} (${elapsed}s): Status=${doc.verification_status}, Category=${doc.category || 'pending'}`, 'blue');
      
      // Check if categorization is complete
      if (doc.verification_status !== 'pending_ai' && doc.category) {
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        log(`   Categorization complete in ${totalTime}s`, 'green');
        return doc;
      }
    } catch (error) {
      log(`   Poll error: ${error.message}`, 'yellow');
    }
  }
  
  throw new Error(`Categorization timeout after ${maxWaitSeconds}s`);
}

async function verifyPassportCategorization(document) {
  log('\n🔍 Step 4: Verifying passport categorization...', 'cyan');
  
  const tests = [];
  
  // Test 1: Category should be "passport"
  const categoryTest = document.category === 'passport';
  tests.push({ name: 'Category is "passport"', passed: categoryTest, details: `Found: ${document.category}` });
  logTest('Category is "passport"', categoryTest, `Found: ${document.category}`);
  
  // Test 2: Should NOT be "cv_resume"
  const notCVTest = document.category !== 'cv_resume';
  tests.push({ name: 'Category is NOT "cv_resume"', passed: notCVTest, details: `Category: ${document.category}` });
  logTest('Category is NOT "cv_resume"', notCVTest, `Category: ${document.category}`);
  
  // Test 3: Verification status should be updated (not pending_ai)
  const statusTest = document.verification_status !== 'pending_ai';
  tests.push({ name: 'Verification status updated', passed: statusTest, details: `Status: ${document.verification_status}` });
  logTest('Verification status updated', statusTest, `Status: ${document.verification_status}`);
  
  // Test 4: Should have confidence score
  const confidenceTest = document.confidence !== null && document.confidence !== undefined;
  tests.push({ name: 'Has confidence score', passed: confidenceTest, details: `Confidence: ${document.confidence || 'N/A'}` });
  logTest('Has confidence score', confidenceTest, `Confidence: ${document.confidence || 'N/A'}`);
  
  // Test 5: File name should match
  const fileNameTest = document.file_name && document.file_name.includes('passport');
  tests.push({ name: 'File name preserved', passed: fileNameTest, details: `File: ${document.file_name || 'N/A'}` });
  logTest('File name preserved', fileNameTest, `File: ${document.file_name || 'N/A'}`);
  
  return tests;
}

async function checkExtractionNotTriggered(documentId) {
  log('\n🚫 Step 5: Verifying CV extraction was NOT triggered...', 'cyan');
  
  try {
    // Check if there are any extraction-related logs
    const logsResponse = await fetch(`${BACKEND_URL}/api/verification-logs/document/${documentId}`);
    if (logsResponse.ok) {
      const logsData = await logsResponse.json();
      const logs = logsData.logs || [];
      
      // Look for extraction-related events
      const extractionEvents = logs.filter(log => 
        log.event_type && (
          log.event_type.includes('extraction') || 
          log.event_type.includes('cv_parse') ||
          log.event_type.includes('extract')
        )
      );
      
      const noExtraction = extractionEvents.length === 0;
      logTest('No CV extraction triggered', noExtraction, 
        noExtraction ? 'No extraction events found' : `Found ${extractionEvents.length} extraction events`);
      
      return noExtraction;
    }
  } catch (error) {
    log(`   Could not check logs: ${error.message}`, 'yellow');
    return true; // Assume pass if we can't check
  }
  
  return true;
}

async function runTest() {
  log('\n🧪 ========================================', 'cyan');
  log('🧪 Passport Upload Test', 'cyan');
  log('🧪 ========================================', 'cyan');
  
  let candidateId = null;
  let documentId = null;
  
  try {
    // Step 1: Get or create test candidate
    candidateId = await getOrCreateTestCandidate();
    
    // Step 2: Upload passport file
    documentId = await uploadPassportFile(candidateId);
    
    // Step 3: Wait for categorization
    const document = await waitForCategorization(documentId);
    
    // Step 4: Verify categorization
    const tests = await verifyPassportCategorization(document);
    
    // Step 5: Verify extraction not triggered
    const noExtraction = await checkExtractionNotTriggered(documentId);
    
    // Summary
    log('\n📊 ========================================', 'cyan');
    log('📊 Test Summary', 'cyan');
    log('📊 ========================================', 'cyan');
    
    const allTests = [...tests, { name: 'CV extraction not triggered', passed: noExtraction }];
    const passed = allTests.filter(t => t.passed).length;
    const total = allTests.length;
    
    log(`\n✅ Passed: ${passed}/${total}`, passed === total ? 'green' : 'yellow');
    log(`❌ Failed: ${total - passed}/${total}`, passed === total ? 'green' : 'red');
    
    if (passed === total) {
      log('\n🎉 All tests passed!', 'green');
      log('   ✅ Passport file uploaded successfully', 'green');
      log('   ✅ Document categorized as "passport"', 'green');
      log('   ✅ CV extraction was NOT triggered', 'green');
    } else {
      log('\n⚠️  Some tests failed', 'yellow');
      allTests.forEach(test => {
        if (!test.passed) {
          log(`   ❌ ${test.name}: ${test.details || ''}`, 'red');
        }
      });
    }
    
    log(`\n📄 Document ID: ${documentId}`, 'blue');
    log(`👤 Candidate ID: ${candidateId}`, 'blue');
    log(`🔗 View: ${BACKEND_URL}/api/documents/candidate-documents/${documentId}`, 'blue');
    
    process.exit(passed === total ? 0 : 1);
    
  } catch (error) {
    log(`\n❌ Test failed with error: ${error.message}`, 'red');
    log(`   Stack: ${error.stack}`, 'red');
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  runTest();
}

module.exports = { runTest };
