/**
 * Integration Test: Document Verification System
 * 
 * Tests the complete workflow:
 * 1. Upload document → PENDING_AI
 * 2. Worker processes → AI scan
 * 3. Identity matching → Decision
 * 4. Status update → VERIFIED/NEEDS_REVIEW/REJECTED
 * 5. Logs created at each step
 * 
 * Prerequisites:
 * - Backend server running
 * - Python parser running
 * - Worker running (RUN_WORKER=true)
 * - Valid test documents in test-files/
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

// __dirname is available in CommonJS by default

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const TEST_FILES_DIR = path.join(__dirname, '..', 'test-files');
const POLLING_INTERVAL = 2000; // 2 seconds
const MAX_POLL_ATTEMPTS = 30; // 60 seconds total

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

// Color output
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

function logSection(title) {
  log(`\n${'='.repeat(80)}`, 'cyan');
  log(`  ${title}`, 'cyan');
  log('='.repeat(80), 'cyan');
}

function logTest(name, passed, message = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  const color = passed ? 'green' : 'red';
  log(`${status} - ${name}${message ? ': ' + message : ''}`, color);
  
  testResults.tests.push({ name, passed, message });
  if (passed) testResults.passed++;
  else testResults.failed++;
}

// Helper: Sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: Ensure a text test file exists (fallback when PDF/JPG missing)
function ensureTestTextFile(fileName, content) {
  const fullPath = path.join(TEST_FILES_DIR, fileName);
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, content, { encoding: 'utf8' });
    log(`  Created fallback test file: ${fileName}`, 'yellow');
  }
  return fullPath;
}

// Helper: Generate random CNIC-like string
function randomCnic() {
  const part1 = Math.floor(10000 + Math.random() * 90000); // 5 digits
  const part2 = Math.floor(1000000 + Math.random() * 9000000); // 7 digits
  const part3 = Math.floor(1 + Math.random() * 9); // 1 digit
  return `${part1}-${part2}-${part3}`;
}

function randomEmail(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}.${rand}@example.com`;
}

// Helper: Upload document
async function uploadDocument(candidateId, filePath, fileName) {
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath), fileName);
    formData.append('candidate_id', candidateId);
    formData.append('source', 'api'); // Use 'api' - valid constraint value

    const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Upload failed: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.document;
  } catch (error) {
    log(`Upload error: ${error.message}`, 'red');
    throw error;
  }
}

// Helper: Poll document status
async function pollDocumentStatus(documentId, maxAttempts = MAX_POLL_ATTEMPTS) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${documentId}`);
      
      if (!response.ok) {
        throw new Error(`Status check failed: ${response.status}`);
      }

      const data = await response.json();
      const status = data.document.verification_status;
      
      log(`  Attempt ${attempt}/${maxAttempts}: ${status}`, 'yellow');

      // Check if processing is complete
      if (status !== 'pending_ai') {
        return data.document;
      }

      await sleep(POLLING_INTERVAL);
    } catch (error) {
      log(`  Polling error (attempt ${attempt}): ${error.message}`, 'red');
      if (attempt === maxAttempts) throw error;
      await sleep(POLLING_INTERVAL);
    }
  }

  throw new Error('Polling timeout: Document still pending after max attempts');
}

// Helper: Get verification logs
async function getVerificationLogs(documentId) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/verification-logs/document/${documentId}`);
    
    if (!response.ok) {
      throw new Error(`Logs fetch failed: ${response.status}`);
    }

    const data = await response.json();
    return data.logs || [];
  } catch (error) {
    log(`Logs fetch error: ${error.message}`, 'red');
    return [];
  }
}

// Helper: Create test candidate
async function createTestCandidate(testData) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testData)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Candidate creation failed: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.candidate;
  } catch (error) {
    log(`Candidate creation error: ${error.message}`, 'red');
    throw error;
  }
}

// =============================================================================
// TEST 1: Happy Path - Upload CV with Matching Identity
// =============================================================================
async function testHappyPath() {
  logSection('TEST 1: Happy Path - CV Upload with Matching Identity');

  try {
    // Create test candidate
    const candidate = await createTestCandidate({
      name: 'John Doe',
      email: randomEmail('john.doe'),
      phone: '+92-300-1234567',
      cnic: randomCnic(),
      status: 'Applied'
    });
    log(`Created test candidate: ${candidate.id}`, 'blue');

    // Upload CV
    let testFile = path.join(TEST_FILES_DIR, 'sample-cv.pdf');
    let uploadName = 'sample-cv.pdf';
    if (!fs.existsSync(testFile)) {
      // Fallback to text file
      testFile = ensureTestTextFile('sample-cv.txt',
        'John Doe\nCNIC: 12345-1234567-1\nEmail: john.doe@example.com\nPhone: +92-300-1234567\n');
      uploadName = 'sample-cv.txt';
    }

    log(`Uploading CV (${uploadName})...`, 'blue');
    const document = await uploadDocument(candidate.id, testFile, uploadName);
    
    logTest('Document Upload', document.id !== undefined, `Document ID: ${document.id}`);
    logTest('Initial Status = PENDING_AI', document.verification_status === 'pending_ai');

    // Poll for completion
    log('Polling for verification completion...', 'blue');
    const finalDocument = await pollDocumentStatus(document.id);

    logTest('Status Changed', finalDocument.verification_status !== 'pending_ai');
    logTest('Category Detected', finalDocument.category !== null, `Category: ${finalDocument.category}`);
    logTest('Confidence Score', finalDocument.confidence !== undefined && finalDocument.confidence >= 0, `Confidence: ${finalDocument.confidence}`);
    
    // Check verification logs
    const logs = await getVerificationLogs(document.id);
    logTest('Logs Created', logs.length > 0, `${logs.length} log entries`);
    
    const eventTypes = logs.map(l => l.event_type);
    logTest('Upload Event Logged', eventTypes.includes('upload_completed'));
    logTest('AI Scan Event Logged', eventTypes.includes('ai_scan_completed'));
    logTest('Identity Verification Logged', eventTypes.includes('identity_verification_completed'));
    logTest('Status Change Logged', eventTypes.includes('verification_status_changed'));

    // Display final result
    log('\nFinal Document State:', 'cyan');
    log(`  Status: ${finalDocument.verification_status}`, 'yellow');
    log(`  Category: ${finalDocument.category}`, 'yellow');
    log(`  Confidence: ${finalDocument.confidence}`, 'yellow');
    log(`  Reason: ${finalDocument.verification_reason_code}`, 'yellow');
    if (finalDocument.mismatch_fields?.length > 0) {
      log(`  Mismatches: ${finalDocument.mismatch_fields.join(', ')}`, 'yellow');
    }

  } catch (error) {
    logTest('Happy Path', false, error.message);
  }
}

// =============================================================================
// TEST 2: Identity Mismatch - Document with Different CNIC
// =============================================================================
async function testIdentityMismatch() {
  logSection('TEST 2: Identity Mismatch - Document with Wrong CNIC');

  try {
    // Create candidate with specific CNIC
    const candidate = await createTestCandidate({
      name: 'Jane Smith',
      email: randomEmail('jane.smith'),
      phone: '+92-301-7654321',
      cnic: randomCnic(),
      status: 'Applied'
    });
    log(`Created test candidate: ${candidate.id}`, 'blue');

    // Upload document with different identity
    let testFile = path.join(TEST_FILES_DIR, 'passport-mismatch.pdf');
    let uploadName = 'passport-mismatch.pdf';
    if (!fs.existsSync(testFile)) {
      // Fallback to text file
      testFile = ensureTestTextFile('passport-mismatch.txt',
        'PASSPORT\nName: Different Person\nPassport No: XY9876543\nCNIC: 99999-9999999-9');
      uploadName = 'passport-mismatch.txt';
    }

    log('Uploading document with mismatched identity...', 'blue');
    const document = await uploadDocument(candidate.id, testFile, uploadName);

    // Poll for completion
    const finalDocument = await pollDocumentStatus(document.id);

    logTest('Status = REJECTED or NEEDS_REVIEW', 
      ['rejected_mismatch', 'needs_review'].includes(finalDocument.verification_status),
      `Status: ${finalDocument.verification_status}`
    );
    logTest('Mismatch Fields Detected', 
      finalDocument.mismatch_fields?.length > 0,
      `Fields: ${finalDocument.mismatch_fields?.join(', ')}`
    );
    logTest('Reason Code Set', 
      finalDocument.verification_reason_code !== null,
      `Reason: ${finalDocument.verification_reason_code}`
    );

  } catch (error) {
    logTest('Identity Mismatch Test', false, error.message);
  }
}

// =============================================================================
// TEST 3: Low Confidence - Blurry Document
// =============================================================================
async function testLowConfidence() {
  logSection('TEST 3: Low Confidence - Poor Quality Document');

  try {
    const candidate = await createTestCandidate({
      name: 'Test User',
      email: randomEmail('test'),
      status: 'Applied'
    });

    const testFile = path.join(TEST_FILES_DIR, 'blurry-document.jpg');
    if (!fs.existsSync(testFile)) {
      log('Skipping test - blurry-document.jpg not found', 'yellow');
      return;
    }

    log('Uploading low-quality document...', 'blue');
    const document = await uploadDocument(candidate.id, testFile, 'blurry-document.jpg');

    const finalDocument = await pollDocumentStatus(document.id);

    logTest('Status = NEEDS_REVIEW or FAILED', 
      ['needs_review', 'failed'].includes(finalDocument.verification_status),
      `Status: ${finalDocument.verification_status}`
    );
    logTest('Low Confidence Detected', 
      finalDocument.confidence !== undefined && finalDocument.confidence < 0.70,
      `Confidence: ${finalDocument.confidence}`
    );

  } catch (error) {
    logTest('Low Confidence Test', false, error.message);
  }
}

// =============================================================================
// TEST 4: Multiple Document Types
// =============================================================================
async function testMultipleDocumentTypes() {
  logSection('TEST 4: Multiple Document Types - Category Detection');

  const testFiles = [
    { name: 'sample-cv.pdf', fallback: 'sample-cv.txt', content: 'CV\nJohn Doe', expectedCategory: 'cv_resume' },
    { name: 'passport.pdf', fallback: 'passport.txt', content: 'PASSPORT\nAB1234567', expectedCategory: 'passport' },
    { name: 'certificate.pdf', fallback: 'certificate.txt', content: 'CERTIFICATE\nAchievement', expectedCategory: 'certificates' },
    { name: 'photo.jpg', fallback: 'photo.txt', content: 'PHOTO\nHeadshot', expectedCategory: 'photos' }
  ];

  try {
    const candidate = await createTestCandidate({
      name: 'Multi Doc Test',
      email: randomEmail('multidoc'),
      status: 'Applied'
    });

    for (const testFile of testFiles) {
      let filePath = path.join(TEST_FILES_DIR, testFile.name);
      let uploadName = testFile.name;
      
      if (!fs.existsSync(filePath)) {
        // Fallback to text
        filePath = ensureTestTextFile(testFile.fallback, testFile.content);
        uploadName = testFile.fallback;
        log(`Using fallback ${uploadName} for ${testFile.name}`, 'yellow');
      }

      log(`\nTesting ${uploadName}...`, 'blue');
      const document = await uploadDocument(candidate.id, filePath, uploadName);
      const finalDocument = await pollDocumentStatus(document.id);

      logTest(`${testFile.name} - Category Detected`, 
        finalDocument.category !== null,
        `Expected: ${testFile.expectedCategory}, Got: ${finalDocument.category}`
      );
    }

  } catch (error) {
    logTest('Multiple Document Types', false, error.message);
  }
}

// =============================================================================
// TEST 5: Verification Logs API
// =============================================================================
async function testVerificationLogsAPI() {
  logSection('TEST 5: Verification Logs API Endpoints');

  try {
    const candidate = await createTestCandidate({
      name: 'Logs Test User',
      email: randomEmail('logs'),
      status: 'Applied'
    });

    let testFile = path.join(TEST_FILES_DIR, 'sample-cv.pdf');
    let uploadName = 'sample-cv.pdf';
    if (!fs.existsSync(testFile)) {
      testFile = ensureTestTextFile('sample-cv.txt', 'John Doe\nCV');
      uploadName = 'sample-cv.txt';
    }

    const document = await uploadDocument(candidate.id, testFile, uploadName);
    await pollDocumentStatus(document.id);

    // Test 1: Get logs by document ID
    log('\nTesting GET /api/verification-logs/document/:id', 'blue');
    const docLogs = await getVerificationLogs(document.id);
    logTest('Document Logs Retrieved', docLogs.length > 0, `${docLogs.length} entries`);

    // Test 2: Get logs by candidate ID
    log('Testing GET /api/verification-logs/candidate/:id', 'blue');
    const response = await fetch(`${BACKEND_URL}/api/verification-logs/candidate/${candidate.id}`);
    const candidateLogs = await response.json();
    logTest('Candidate Logs Retrieved', 
      candidateLogs.logs?.length > 0,
      `${candidateLogs.logs?.length} entries`
    );

    // Test 3: Get timeline
    log('Testing GET /api/verification-logs/timeline', 'blue');
    const timelineResponse = await fetch(`${BACKEND_URL}/api/verification-logs/timeline?limit=10`);
    const timeline = await timelineResponse.json();
    logTest('Timeline Retrieved', timeline.logs?.length > 0);

    // Test 4: Get stats
    log('Testing GET /api/verification-logs/stats/candidate/:id', 'blue');
    const statsResponse = await fetch(`${BACKEND_URL}/api/verification-logs/stats/candidate/${candidate.id}`);
    const stats = await statsResponse.json();
    logTest('Stats Retrieved', 
      stats.stats?.total_documents !== undefined,
      `Total: ${stats.stats?.total_documents}`
    );

  } catch (error) {
    logTest('Verification Logs API', false, error.message);
  }
}

// =============================================================================
// TEST 6: Request Tracing
// =============================================================================
async function testRequestTracing() {
  logSection('TEST 6: Request Tracing - End-to-End Event Linking');

  try {
    const candidate = await createTestCandidate({
      name: 'Trace Test',
      email: randomEmail('trace'),
      status: 'Applied'
    });

    let testFile = path.join(TEST_FILES_DIR, 'sample-cv.pdf');
    let uploadName = 'sample-cv.pdf';
    if (!fs.existsSync(testFile)) {
      testFile = ensureTestTextFile('sample-cv.txt', 'John Doe\nCV');
      uploadName = 'sample-cv.txt';
    }

    const document = await uploadDocument(candidate.id, testFile, uploadName);
    await pollDocumentStatus(document.id);

    // Get all logs
    const logs = await getVerificationLogs(document.id);
    
    // Check request_id consistency
    const requestIds = [...new Set(logs.map(l => l.request_id))];
    logTest('Single Request ID', requestIds.length === 1, `Request IDs: ${requestIds.length}`);

    // Check event sequence
    const eventSequence = logs.map(l => l.event_type);
    const expectedEvents = [
      'upload_started',
      'upload_completed',
      'ai_scan_started',
      'ai_scan_completed',
      'identity_verification_completed',
      'verification_status_changed'
    ];

    const hasAllEvents = expectedEvents.every(event => eventSequence.includes(event));
    logTest('Complete Event Sequence', hasAllEvents, 
      `Events: ${eventSequence.join(' → ')}`
    );

    // Check timestamps are sequential
    const timestamps = logs.map(l => new Date(l.created_at).getTime());
    const isSequential = timestamps.every((t, i) => i === 0 || t >= timestamps[i - 1]);
    logTest('Sequential Timestamps', isSequential);

  } catch (error) {
    logTest('Request Tracing', false, error.message);
  }
}

// =============================================================================
// Main Test Runner
// =============================================================================
async function runIntegrationTests() {
  log('\n╔════════════════════════════════════════════════════════════════════════════╗', 'cyan');
  log('║                  DOCUMENT VERIFICATION INTEGRATION TESTS                   ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════════════════════╝', 'cyan');

  log(`\nBackend URL: ${BACKEND_URL}`, 'blue');
  log(`Test Files Dir: ${TEST_FILES_DIR}`, 'blue');

  // Check if backend is running
  try {
    const healthResponse = await fetch(`${BACKEND_URL}/health`);
    if (!healthResponse.ok) throw new Error('Health check failed');
    log('✅ Backend is running\n', 'green');
  } catch (error) {
    log('❌ Backend is not running! Please start the backend server first.', 'red');
    process.exit(1);
  }

  // Create test files directory if it doesn't exist
  if (!fs.existsSync(TEST_FILES_DIR)) {
    fs.mkdirSync(TEST_FILES_DIR, { recursive: true });
    log(`⚠️  Created test-files directory: ${TEST_FILES_DIR}`, 'yellow');
    log('⚠️  Please add test documents to this directory before running tests.\n', 'yellow');
  }

  const startTime = Date.now();

  // Run all tests
  await testHappyPath();
  await testIdentityMismatch();
  await testLowConfidence();
  await testMultipleDocumentTypes();
  await testVerificationLogsAPI();
  await testRequestTracing();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Print summary
  logSection('TEST SUMMARY');
  log(`Total Tests: ${testResults.passed + testResults.failed}`, 'blue');
  log(`Passed: ${testResults.passed}`, 'green');
  log(`Failed: ${testResults.failed}`, testResults.failed > 0 ? 'red' : 'green');
  log(`Duration: ${duration}s`, 'blue');
  log(`Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`, 
    testResults.failed === 0 ? 'green' : 'yellow');

  if (testResults.failed > 0) {
    log('\nFailed Tests:', 'red');
    testResults.tests
      .filter(t => !t.passed)
      .forEach(t => log(`  ❌ ${t.name}: ${t.message}`, 'red'));
  }

  log('\n' + '='.repeat(80) + '\n', 'cyan');

  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests
runIntegrationTests().catch(error => {
  log(`\n❌ Test runner error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
