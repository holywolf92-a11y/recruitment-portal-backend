/**
 * Comprehensive Endpoint Test: Document Upload System
 * 
 * Tests:
 * 1. Upload endpoint availability
 * 2. Document upload with validation
 * 3. Document retrieval
 * 4. Document listing
 * 5. Status updates after categorization
 * 6. Error handling
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
const TEST_FILE_PATH = process.env.TEST_FILE || path.join(__dirname, '..', '..', 'passport_muhammad_farhan.pdf');

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
  return passed;
}

const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

async function testBackendHealth() {
  log('\n🔍 Test 1: Backend Health Check', 'cyan');
  
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      timeout: 5000,
    });
    
    const isHealthy = response.ok || response.status === 404; // 404 is ok if health endpoint doesn't exist
    const passed = logTest('Backend is reachable', isHealthy, 
      isHealthy ? `Status: ${response.status}` : `Failed: ${response.status}`);
    
    if (passed) testResults.passed++;
    else testResults.failed++;
    testResults.tests.push({ name: 'Backend Health', passed });
    
    return isHealthy;
  } catch (error) {
    const passed = logTest('Backend is reachable', false, `Error: ${error.message}`);
    testResults.failed++;
    testResults.tests.push({ name: 'Backend Health', passed });
    return false;
  }
}

async function getOrCreateTestCandidate() {
  log('\n🔍 Test 2: Get or Create Test Candidate', 'cyan');
  
  try {
    // Try to find an existing candidate
    const searchResponse = await fetch(`${BACKEND_URL}/api/candidates?limit=1`, {
      timeout: 10000,
    });
    
    if (searchResponse.ok) {
      const data = await searchResponse.json();
      if (data.candidates && data.candidates.length > 0) {
        const candidateId = data.candidates[0].id;
        const passed = logTest('Candidate found', true, `ID: ${candidateId}`);
        testResults.passed++;
        testResults.tests.push({ name: 'Get Candidate', passed });
        return candidateId;
      }
    }
    
    // Create test candidate
    const createResponse = await fetch(`${BACKEND_URL}/api/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Candidate',
        email: 'test@example.com',
        phone: '+923001234567',
        position: 'Test Position',
      }),
      timeout: 10000,
    });
    
    if (!createResponse.ok) {
      throw new Error(`Failed to create candidate: ${createResponse.statusText}`);
    }
    
    const candidate = await createResponse.json();
    const passed = logTest('Candidate created', true, `ID: ${candidate.id}`);
    testResults.passed++;
    testResults.tests.push({ name: 'Create Candidate', passed });
    return candidate.id;
  } catch (error) {
    const passed = logTest('Get/Create Candidate', false, `Error: ${error.message}`);
    testResults.failed++;
    testResults.tests.push({ name: 'Get/Create Candidate', passed });
    throw error;
  }
}

async function testDocumentUpload(candidateId) {
  log('\n🔍 Test 3: Document Upload Endpoint', 'cyan');
  
  // Check if file exists
  if (!fs.existsSync(TEST_FILE_PATH)) {
    const passed = logTest('Test file exists', false, `File not found: ${TEST_FILE_PATH}`);
    testResults.failed++;
    testResults.tests.push({ name: 'Test File Exists', passed });
    return null;
  }
  
  logTest('Test file exists', true, `File: ${path.basename(TEST_FILE_PATH)}`);
  testResults.passed++;
  testResults.tests.push({ name: 'Test File Exists', passed: true });
  
  const fileStats = fs.statSync(TEST_FILE_PATH);
  log(`   File size: ${(fileStats.size / 1024).toFixed(2)} KB`, 'blue');
  
  // Create form data
  const formData = new FormData();
  formData.append('file', fs.createReadStream(TEST_FILE_PATH));
  formData.append('candidate_id', candidateId);
  formData.append('source', 'web'); // Valid constraint value
  
  try {
    const startTime = Date.now();
    const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
      timeout: 60000, // 60 second timeout
    });
    
    const uploadTime = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      const passed = logTest('Upload endpoint responds', false, 
        `Status: ${response.status}, Error: ${errorText.substring(0, 100)}`);
      testResults.failed++;
      testResults.tests.push({ name: 'Upload Endpoint', passed });
      return null;
    }
    
    const result = await response.json();
    
    const passed1 = logTest('Upload endpoint responds', true, 
      `Status: ${response.status}, Time: ${uploadTime}ms`);
    testResults.passed++;
    testResults.tests.push({ name: 'Upload Endpoint Response', passed: true });
    
    const passed2 = logTest('Upload returns document ID', !!result.document?.id, 
      `Document ID: ${result.document?.id || 'missing'}`);
    if (passed2) testResults.passed++;
    else testResults.failed++;
    testResults.tests.push({ name: 'Upload Returns Document ID', passed: passed2 });
    
    const passed3 = logTest('Upload returns request ID', !!result.request_id, 
      `Request ID: ${result.request_id || 'missing'}`);
    if (passed3) testResults.passed++;
    else testResults.failed++;
    testResults.tests.push({ name: 'Upload Returns Request ID', passed: passed3 });
    
    const passed4 = logTest('Initial status is pending_ai', 
      result.document?.verification_status === 'pending_ai',
      `Status: ${result.document?.verification_status || 'missing'}`);
    if (passed4) testResults.passed++;
    else testResults.failed++;
    testResults.tests.push({ name: 'Initial Status', passed: passed4 });
    
    log(`   Document ID: ${result.document.id}`, 'blue');
    log(`   Request ID: ${result.request_id}`, 'blue');
    
    return result.document.id;
  } catch (error) {
    const passed = logTest('Upload endpoint responds', false, `Error: ${error.message}`);
    testResults.failed++;
    testResults.tests.push({ name: 'Upload Endpoint', passed });
    return null;
  }
}

async function testGetDocument(documentId) {
  log('\n🔍 Test 4: Get Document Endpoint', 'cyan');
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${documentId}`, {
      method: 'GET',
      timeout: 10000,
    });
    
    if (!response.ok) {
      const passed = logTest('Get document endpoint', false, 
        `Status: ${response.status}`);
      testResults.failed++;
      testResults.tests.push({ name: 'Get Document Endpoint', passed });
      return null;
    }
    
    const data = await response.json();
    const doc = data.document;
    
    const passed1 = logTest('Get document endpoint responds', true, 
      `Status: ${response.status}`);
    testResults.passed++;
    testResults.tests.push({ name: 'Get Document Endpoint', passed: true });
    
    const passed2 = logTest('Document has required fields', 
      !!(doc.id && doc.file_name && doc.candidate_id),
      `Has: id=${!!doc.id}, file_name=${!!doc.file_name}, candidate_id=${!!doc.candidate_id}`);
    if (passed2) testResults.passed++;
    else testResults.failed++;
    testResults.tests.push({ name: 'Document Has Required Fields', passed: passed2 });
    
    log(`   File: ${doc.file_name}`, 'blue');
    log(`   Status: ${doc.verification_status}`, 'blue');
    log(`   Category: ${doc.category || 'pending'}`, 'blue');
    
    return doc;
  } catch (error) {
    const passed = logTest('Get document endpoint', false, `Error: ${error.message}`);
    testResults.failed++;
    testResults.tests.push({ name: 'Get Document Endpoint', passed });
    return null;
  }
}

async function testListDocuments(candidateId) {
  log('\n🔍 Test 5: List Documents Endpoint', 'cyan');
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/documents/candidates/${candidateId}/documents`, {
      method: 'GET',
      timeout: 10000,
    });
    
    if (!response.ok) {
      const passed = logTest('List documents endpoint', false, 
        `Status: ${response.status}`);
      testResults.failed++;
      testResults.tests.push({ name: 'List Documents Endpoint', passed });
      return [];
    }
    
    const data = await response.json();
    const documents = data.documents || [];
    
    const passed1 = logTest('List documents endpoint responds', true, 
      `Status: ${response.status}, Count: ${documents.length}`);
    testResults.passed++;
    testResults.tests.push({ name: 'List Documents Endpoint', passed: true });
    
    const passed2 = logTest('Returns array of documents', 
      Array.isArray(documents),
      `Type: ${Array.isArray(documents) ? 'array' : typeof documents}`);
    if (passed2) testResults.passed++;
    else testResults.failed++;
    testResults.tests.push({ name: 'Returns Array', passed: passed2 });
    
    return documents;
  } catch (error) {
    const passed = logTest('List documents endpoint', false, `Error: ${error.message}`);
    testResults.failed++;
    testResults.tests.push({ name: 'List Documents Endpoint', passed });
    return [];
  }
}

async function testCategorization(documentId, maxWaitSeconds = 30) {
  log(`\n🔍 Test 6: Document Categorization (max ${maxWaitSeconds}s)`, 'cyan');
  
  const startTime = Date.now();
  const pollInterval = 2000; // 2 seconds
  let attempts = 0;
  const maxAttempts = Math.ceil((maxWaitSeconds * 1000) / pollInterval);
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    attempts++;
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${documentId}`, {
        method: 'GET',
        timeout: 10000,
      });
      
      if (!response.ok) continue;
      
      const data = await response.json();
      const doc = data.document;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      log(`   Attempt ${attempts}/${maxAttempts} (${elapsed}s): Status=${doc.verification_status}, Category=${doc.category || 'pending'}`, 'blue');
      
      // Check if categorization is complete
      if (doc.verification_status !== 'pending_ai' && doc.category) {
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        
        const passed1 = logTest('Categorization completes', true, 
          `Time: ${totalTime}s, Status: ${doc.verification_status}, Category: ${doc.category}`);
        testResults.passed++;
        testResults.tests.push({ name: 'Categorization Completes', passed: true });
        
        const passed2 = logTest('Category is assigned', !!doc.category, 
          `Category: ${doc.category}`);
        if (passed2) testResults.passed++;
        else testResults.failed++;
        testResults.tests.push({ name: 'Category Assigned', passed: passed2 });
        
        const passed3 = logTest('Status is updated', doc.verification_status !== 'pending_ai', 
          `Status: ${doc.verification_status}`);
        if (passed3) testResults.passed++;
        else testResults.failed++;
        testResults.tests.push({ name: 'Status Updated', passed: passed3 });
        
        if (doc.confidence !== null && doc.confidence !== undefined) {
          const passed4 = logTest('Confidence score present', true, 
            `Confidence: ${doc.confidence}`);
          testResults.passed++;
          testResults.tests.push({ name: 'Confidence Score', passed: true });
        }
        
        return doc;
      }
    } catch (error) {
      // Continue polling
    }
  }
  
  const passed = logTest('Categorization completes', false, 
    `Timeout after ${maxWaitSeconds}s`);
  testResults.failed++;
  testResults.tests.push({ name: 'Categorization Completes', passed });
  return null;
}

async function testErrorHandling(candidateId) {
  log('\n🔍 Test 7: Error Handling', 'cyan');
  
  // Test 1: Missing file
  try {
    const formData = new FormData();
    formData.append('candidate_id', candidateId);
    formData.append('source', 'web');
    
    const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
      timeout: 10000,
    });
    
    const passed = logTest('Missing file returns error', !response.ok, 
      `Status: ${response.status} (expected 400 or 500)`);
    if (passed) testResults.passed++;
    else testResults.failed++;
    testResults.tests.push({ name: 'Missing File Error', passed });
  } catch (error) {
    // Network error is also acceptable
    const passed = logTest('Missing file returns error', true, 'Network error');
    testResults.passed++;
    testResults.tests.push({ name: 'Missing File Error', passed });
  }
  
  // Test 2: Invalid candidate ID
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(TEST_FILE_PATH));
    formData.append('candidate_id', '00000000-0000-0000-0000-000000000000');
    formData.append('source', 'web');
    
    const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
      timeout: 10000,
    });
    
    const passed = logTest('Invalid candidate ID returns error', !response.ok, 
      `Status: ${response.status} (expected 404 or 400)`);
    if (passed) testResults.passed++;
    else testResults.failed++;
    testResults.tests.push({ name: 'Invalid Candidate Error', passed });
  } catch (error) {
    const passed = logTest('Invalid candidate ID returns error', true, 'Network error');
    testResults.passed++;
    testResults.tests.push({ name: 'Invalid Candidate Error', passed });
  }
}

async function runAllTests() {
  log('\n🧪 ========================================', 'cyan');
  log('🧪 Document Upload Endpoint Test Suite', 'cyan');
  log('🧪 ========================================', 'cyan');
  log(`\n📍 Backend URL: ${BACKEND_URL}`, 'blue');
  log(`📁 Test File: ${TEST_FILE_PATH}`, 'blue');
  
  try {
    // Test 1: Backend Health
    const isHealthy = await testBackendHealth();
    if (!isHealthy) {
      log('\n❌ Backend is not reachable. Aborting tests.', 'red');
      process.exit(1);
    }
    
    // Test 2: Get/Create Candidate
    const candidateId = await getOrCreateTestCandidate();
    
    // Test 3: Upload Document
    const documentId = await testDocumentUpload(candidateId);
    if (!documentId) {
      log('\n❌ Document upload failed. Aborting remaining tests.', 'red');
      process.exit(1);
    }
    
    // Test 4: Get Document
    await testGetDocument(documentId);
    
    // Test 5: List Documents
    await testListDocuments(candidateId);
    
    // Test 6: Wait for Categorization
    await testCategorization(documentId);
    
    // Test 7: Error Handling
    await testErrorHandling(candidateId);
    
    // Summary
    log('\n📊 ========================================', 'cyan');
    log('📊 Test Summary', 'cyan');
    log('📊 ========================================', 'cyan');
    
    const total = testResults.passed + testResults.failed;
    const successRate = total > 0 ? ((testResults.passed / total) * 100).toFixed(1) : 0;
    
    log(`\n✅ Passed: ${testResults.passed}/${total} (${successRate}%)`, 
      testResults.failed === 0 ? 'green' : 'yellow');
    log(`❌ Failed: ${testResults.failed}/${total}`, 
      testResults.failed === 0 ? 'green' : 'red');
    
    if (testResults.failed === 0) {
      log('\n🎉 All tests passed!', 'green');
      log('   ✅ Backend is working correctly', 'green');
      log('   ✅ Document upload is functional', 'green');
      log('   ✅ Categorization is working', 'green');
      log('   ✅ Error handling is correct', 'green');
    } else {
      log('\n⚠️  Some tests failed', 'yellow');
      testResults.tests.forEach(test => {
        if (!test.passed) {
          log(`   ❌ ${test.name}`, 'red');
        }
      });
    }
    
    log(`\n📄 Document ID: ${documentId}`, 'blue');
    log(`👤 Candidate ID: ${candidateId}`, 'blue');
    log(`🔗 View: ${BACKEND_URL}/api/documents/candidate-documents/${documentId}`, 'blue');
    
    process.exit(testResults.failed === 0 ? 0 : 1);
    
  } catch (error) {
    log(`\n❌ Test suite failed with error: ${error.message}`, 'red');
    log(`   Stack: ${error.stack}`, 'red');
    process.exit(1);
  }
}

// Run the tests
if (require.main === module) {
  runAllTests();
}

module.exports = { runAllTests };
