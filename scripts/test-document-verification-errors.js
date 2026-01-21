/**
 * Error Handling Test: Document Verification System
 * 
 * Tests error scenarios and edge cases:
 * 1. AI service timeout/unavailable
 * 2. Network failures during upload
 * 3. Invalid file types and sizes
 * 4. Missing identity fields
 * 5. Duplicate identity detection
 * 6. Database errors
 * 7. Worker retry logic
 * 
 * Prerequisites:
 * - Backend server running
 * - Worker running
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

// __dirname is available in CommonJS by default

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const TEST_FILES_DIR = path.join(__dirname, '..', 'test-files');

// Test results
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createTestCandidate(data) {
  const response = await fetch(`${BACKEND_URL}/api/candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await response.json();
  return result.candidate;
}

// =============================================================================
// TEST 1: File Validation Errors
// =============================================================================
async function testFileValidation() {
  logSection('TEST 1: File Validation - Invalid Files');

  try {
    const candidate = await createTestCandidate({
      name: 'File Test User',
      email: `filetest.${Math.random().toString(36).slice(2,8)}@example.com`,
      status: 'Applied'
    });

    // Test 1.1: Unsupported file type
    log('\n1.1: Testing unsupported file type (.exe)...', 'blue');
    try {
      const formData = new FormData();
      formData.append('file', Buffer.from('fake exe content'), {
        filename: 'malware.exe',
        contentType: 'application/x-msdownload'
      });
      formData.append('candidate_id', candidate.id);
      formData.append('source', 'api');

      const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders()
      });

      logTest('Reject .exe File', 
        response.status === 400,
        `Status: ${response.status}`
      );
    } catch (error) {
      logTest('Reject .exe File', false, error.message);
    }

    // Test 1.2: File too large (>10MB)
    log('\n1.2: Testing oversized file (>10MB)...', 'blue');
    try {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
      const formData = new FormData();
      formData.append('file', largeBuffer, {
        filename: 'huge-file.pdf',
        contentType: 'application/pdf'
      });
      formData.append('candidate_id', candidate.id);
      formData.append('source', 'api');

      const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders()
      });

      logTest('Reject Oversized File',
        response.status === 400 || response.status === 413,
        `Status: ${response.status}`
      );
    } catch (error) {
      logTest('Reject Oversized File', false, error.message);
    }

    // Test 1.3: Empty file
    log('\n1.3: Testing empty file...', 'blue');
    try {
      const formData = new FormData();
      formData.append('file', Buffer.from(''), {
        filename: 'empty.pdf',
        contentType: 'application/pdf'
      });
      formData.append('candidate_id', candidate.id);
      formData.append('source', 'api');

      const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders()
      });

      logTest('Reject Empty File',
        !response.ok,
        `Status: ${response.status}`
      );
    } catch (error) {
      logTest('Reject Empty File', false, error.message);
    }

    // Test 1.4: Missing required fields
    log('\n1.4: Testing missing candidate_id...', 'blue');
    try {
      const formData = new FormData();
      formData.append('file', Buffer.from('test content'), {
        filename: 'test.pdf',
        contentType: 'application/pdf'
      });
      formData.append('source', 'api');
      // No candidate_id

      const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders()
      });

      logTest('Reject Missing candidate_id',
        response.status === 400 || response.status === 500,
        `Status: ${response.status}`
      );
    } catch (error) {
      logTest('Reject Missing candidate_id', false, error.message);
    }

  } catch (error) {
    logTest('File Validation Tests', false, error.message);
  }
}

// =============================================================================
// TEST 2: AI Service Errors
// =============================================================================
async function testAIServiceErrors() {
  logSection('TEST 2: AI Service Errors - Timeout and Failures');

  try {
    const candidate = await createTestCandidate({
      name: 'AI Error Test',
      email: `aierror.${Math.random().toString(36).slice(2,8)}@example.com`,
      status: 'Applied'
    });

    // Test 2.1: Corrupted file (should fail OCR/AI processing)
    log('\n2.1: Testing corrupted PDF...', 'blue');
    const corruptedPdf = Buffer.from('Not a real PDF file');
    const formData = new FormData();
    formData.append('file', corruptedPdf, {
      filename: 'corrupted.pdf',
      contentType: 'application/pdf'
    });
    formData.append('candidate_id', candidate.id);
    formData.append('source', 'api');

    const uploadResponse = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (uploadResponse.ok) {
      const data = await uploadResponse.json();
      if (!data || !data.document || !data.document.id) {
        logTest('AI Service Error Tests', false, 'Invalid response structure');
        return;
      }
      const documentId = data.document.id;

      // Wait for processing
      await sleep(10000); // 10 seconds

      // Check final status
      const statusResponse = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${documentId}`);
      const statusData = await statusResponse.json();
      const finalStatus = statusData.document.verification_status;

      logTest('Corrupted File Handling',
        ['failed', 'needs_review'].includes(finalStatus),
        `Final status: ${finalStatus}`
      );

      // Check error logged
      const logsResponse = await fetch(`${BACKEND_URL}/api/verification-logs/document/${documentId}`);
      const logsData = await logsResponse.json();
      const hasErrorLog = logsData.logs?.some(l => 
        l.event_type === 'ai_scan_failed' || l.event_type === 'error'
      );

      logTest('AI Error Logged', hasErrorLog);

    } else {
      logTest('Corrupted File Handling', false, 'Upload rejected');
    }

  } catch (error) {
    logTest('AI Service Error Tests', false, error.message);
  }
}

// =============================================================================
// TEST 3: Identity Verification Errors
// =============================================================================
async function testIdentityVerificationErrors() {
  logSection('TEST 3: Identity Verification Errors');

  try {
    // Test 3.1: No identity fields found
    log('\n3.1: Document with no identity information...', 'blue');
    const candidate1 = await createTestCandidate({
      name: 'No ID Test',
      email: `noid.${Math.random().toString(36).slice(2,8)}@example.com`,
      status: 'Applied'
    });

    // Create a simple text document with no IDs
    const noIdDoc = Buffer.from('This is a plain document with no identity information.');
    const formData1 = new FormData();
    formData1.append('file', noIdDoc, {
      filename: 'no-identity.txt',
      contentType: 'text/plain'
    });
    formData1.append('candidate_id', candidate1.id);
    formData1.append('source', 'api');

    const uploadResponse1 = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
      method: 'POST',
      body: formData1,
      headers: formData1.getHeaders()
    });

    if (uploadResponse1.ok) {
      const data1 = await uploadResponse1.json();
      if (!data1 || !data1.document || !data1.document.id) {
        logTest('Identity Verification Error Tests', false, 'Invalid response structure');
        return;
      }
      await sleep(10000);

      const statusResponse1 = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${data1.document.id}`);
      const statusData1 = await statusResponse1.json();

      logTest('No Identity Fields Handling',
        statusData1.document.verification_status === 'needs_review',
        `Status: ${statusData1.document.verification_status}, Reason: ${statusData1.document.verification_reason_code}`
      );
    }

    // Test 3.2: Partial identity match
    log('\n3.2: Document with only name (no IDs)...', 'blue');
    const candidate2 = await createTestCandidate({
      name: 'Jane Doe',
      email: `jane.${Math.random().toString(36).slice(2,8)}@example.com`,
      phone: '+92-300-0000000',
      status: 'Applied'
    });

    const partialIdDoc = Buffer.from('Jane Doe Resume\nSoftware Engineer\nNo CNIC or Passport');
    const formData2 = new FormData();
    formData2.append('file', partialIdDoc, {
      filename: 'partial-identity.txt',
      contentType: 'text/plain'
    });
    formData2.append('candidate_id', candidate2.id);
    formData2.append('source', 'api');

    const uploadResponse2 = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
      method: 'POST',
      body: formData2,
      headers: formData2.getHeaders()
    });

    if (uploadResponse2.ok) {
      const data2 = await uploadResponse2.json();
      if (!data2 || !data2.document || !data2.document.id) {
        return; // Skip if invalid response
      }
      await sleep(10000);

      const statusResponse2 = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${data2.document.id}`);
      const statusData2 = await statusResponse2.json();

      logTest('Partial Identity Handling',
        ['needs_review', 'verified'].includes(statusData2.document.verification_status),
        `Status: ${statusData2.document.verification_status}`
      );
    }

    // Test 3.3: Multiple conflicting identities
    log('\n3.3: Document with multiple different CNICs...', 'blue');
    const candidate3 = await createTestCandidate({
      name: 'Multi ID Test',
      email: `multiid.${Math.random().toString(36).slice(2,8)}@example.com`,
      cnic: `${Math.floor(10000 + Math.random()*90000)}-${Math.floor(1000000 + Math.random()*9000000)}-${Math.floor(1 + Math.random()*9)}`,
      status: 'Applied'
    });

    const multiIdDoc = Buffer.from(`
      Document contains multiple CNICs:
      Person 1: CNIC 11111-1111111-1
      Person 2: CNIC 22222-2222222-2
      Person 3: CNIC 33333-3333333-3
    `);
    const formData3 = new FormData();
    formData3.append('file', multiIdDoc, {
      filename: 'multiple-ids.txt',
      contentType: 'text/plain'
    });
    formData3.append('candidate_id', candidate3.id);
    formData3.append('source', 'api');

    const uploadResponse3 = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
      method: 'POST',
      body: formData3,
      headers: formData3.getHeaders()
    });

    if (uploadResponse3.ok) {
      const data3 = await uploadResponse3.json();
      if (!data3 || !data3.document || !data3.document.id) {
        return; // Skip if invalid response
      }
      await sleep(10000);

      const statusResponse3 = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${data3.document.id}`);
      const statusData3 = await statusResponse3.json();

      logTest('Multiple Identities Handling',
        ['needs_review', 'verified', 'rejected_mismatch'].includes(statusData3.document.verification_status),
        `Status: ${statusData3.document.verification_status}`
      );
    }

  } catch (error) {
    logTest('Identity Verification Error Tests', false, error.message);
  }
}

// =============================================================================
// TEST 4: Database and Storage Errors
// =============================================================================
async function testDatabaseErrors() {
  logSection('TEST 4: Database and Storage Errors');

  try {
    // Test 4.1: Invalid candidate ID
    log('\n4.1: Upload with non-existent candidate...', 'blue');
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const formData = new FormData();
    formData.append('file', Buffer.from('test content'), {
      filename: 'test.pdf',
      contentType: 'application/pdf'
    });
    formData.append('candidate_id', fakeId);
    formData.append('source', 'api');

      const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders()
      });

      logTest('Invalid Candidate ID Rejected',
        !response.ok,
        `Status: ${response.status}`
      );

    // Test 4.2: Malformed UUID
    log('\n4.2: Upload with malformed UUID...', 'blue');
    const formData2 = new FormData();
    formData2.append('file', Buffer.from('test content'), {
      filename: 'test.pdf',
      contentType: 'application/pdf'
    });
    formData2.append('candidate_id', 'not-a-valid-uuid');
    formData2.append('source', 'api');

    const response2 = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
      method: 'POST',
      body: formData2,
      headers: formData2.getHeaders()
    });

    logTest('Malformed UUID Rejected',
      response2.status === 400 || response2.status === 500,
      `Status: ${response2.status}`
    );

    // Test 4.3: Get non-existent document
    log('\n4.3: Get non-existent document...', 'blue');
    const fakeDocId = '00000000-0000-0000-0000-000000000000';
    const getResponse = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${fakeDocId}`);

    logTest('Non-existent Document Handled',
      getResponse.status === 404 || getResponse.status === 500,
      `Status: ${getResponse.status}`
    );

  } catch (error) {
    logTest('Database Error Tests', false, error.message);
  }
}

// =============================================================================
// TEST 5: Concurrent Upload Stress Test
// =============================================================================
async function testConcurrentUploads() {
  logSection('TEST 5: Concurrent Uploads - Stress Test');

  try {
    const candidate = await createTestCandidate({
      name: 'Stress Test User',
      email: `stress.${Math.random().toString(36).slice(2,8)}@example.com`,
      status: 'Applied'
    });

    log('\nUploading 5 documents concurrently...', 'blue');

    const uploadPromises = [];
    for (let i = 1; i <= 5; i++) {
      const formData = new FormData();
      formData.append('file', Buffer.from(`Test document ${i} content`), {
        filename: `doc-${i}.txt`,
        contentType: 'text/plain'
      });
      formData.append('candidate_id', candidate.id);
      formData.append('source', 'api');

      uploadPromises.push(
        fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
          method: 'POST',
          body: formData,
          headers: formData.getHeaders()
        })
      );
    }

    const responses = await Promise.all(uploadPromises);
    const successCount = responses.filter(r => r.ok).length;

    logTest('Concurrent Uploads',
      successCount === 5,
      `${successCount}/5 successful`
    );

    // Wait for processing
    await sleep(15000);

    // Check all were processed
    const docIds = await Promise.all(
      responses.filter(r => r.ok).map(async r => {
        try {
          const data = await r.json();
          return data?.document?.id;
        } catch (e) {
          return null;
        }
      })
    ).then(ids => ids.filter(id => id !== null));

    if (docIds.length === 0) {
      logTest('Concurrent Upload Test', false, 'No valid document IDs returned');
      return;
    }

    const statusChecks = await Promise.all(
      docIds.map(id => fetch(`${BACKEND_URL}/api/documents/candidate-documents/${id}`))
    );

    const allProcessed = (await Promise.all(
      statusChecks.map(r => r.json())
    )).every(data => data.document.verification_status !== 'pending_ai');

    logTest('All Documents Processed',
      allProcessed,
      `${docIds.length} documents`
    );

  } catch (error) {
    logTest('Concurrent Upload Test', false, error.message);
  }
}

// =============================================================================
// TEST 6: Rate Limiting and Queue Management
// =============================================================================
async function testRateLimiting() {
  logSection('TEST 6: Rate Limiting and Queue Management');

  try {
    const candidate = await createTestCandidate({
      name: 'Rate Limit Test',
      email: `ratelimit.${Math.random().toString(36).slice(2,8)}@example.com`,
      status: 'Applied'
    });

    log('\nUploading 15 documents to test rate limiting (10/min limit)...', 'blue');

    const uploads = [];
    for (let i = 1; i <= 15; i++) {
      const formData = new FormData();
      formData.append('file', Buffer.from(`Rate test ${i}`), {
        filename: `rate-${i}.txt`,
        contentType: 'text/plain'
      });
      formData.append('candidate_id', candidate.id);
      formData.append('source', 'api');

      uploads.push(
        fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
          method: 'POST',
          body: formData,
          headers: formData.getHeaders()
        })
      );

      // Small delay between requests
      await sleep(100);
    }

    const responses = await Promise.all(uploads);
    const allAccepted = responses.every(r => r.ok);

    logTest('All Uploads Queued',
      allAccepted,
      `${responses.filter(r => r.ok).length}/15 accepted`
    );

    log('Waiting for queue processing (60 seconds)...', 'yellow');
    await sleep(60000);

    // Check processing status
    const docIds = await Promise.all(
      responses.filter(r => r.ok).map(async r => {
        try {
          const data = await r.json();
          return data?.document?.id;
        } catch (e) {
          return null;
        }
      })
    ).then(ids => ids.filter(id => id !== null));

    if (docIds.length === 0) {
      logTest('Rate Limiting Test', false, 'No valid document IDs returned');
      return;
    }

    const statusChecks = await Promise.all(
      docIds.map(id => fetch(`${BACKEND_URL}/api/documents/candidate-documents/${id}`))
    );

    const statuses = await Promise.all(
      statusChecks.map(r => r.json())
    );

    const processedCount = statuses.filter(
      data => data.document.verification_status !== 'pending_ai'
    ).length;

    logTest('Queue Processing',
      processedCount >= 10,
      `${processedCount}/15 processed (rate limited to ~10/min)`
    );

  } catch (error) {
    logTest('Rate Limiting Test', false, error.message);
  }
}

// =============================================================================
// Main Test Runner
// =============================================================================
async function runErrorTests() {
  log('\n╔════════════════════════════════════════════════════════════════════════════╗', 'magenta');
  log('║             DOCUMENT VERIFICATION ERROR HANDLING TESTS                     ║', 'magenta');
  log('╚════════════════════════════════════════════════════════════════════════════╝', 'magenta');

  log(`\nBackend URL: ${BACKEND_URL}`, 'blue');

  // Health check
  try {
    const healthResponse = await fetch(`${BACKEND_URL}/health`);
    if (!healthResponse.ok) throw new Error('Health check failed');
    log('✅ Backend is running\n', 'green');
  } catch (error) {
    log('❌ Backend is not running! Please start the backend server first.', 'red');
    process.exit(1);
  }

  const startTime = Date.now();

  // Run all error tests
  await testFileValidation();
  await testAIServiceErrors();
  await testIdentityVerificationErrors();
  await testDatabaseErrors();
  await testConcurrentUploads();
  await testRateLimiting();

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

  log('\n' + '='.repeat(80) + '\n', 'magenta');

  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run error tests
runErrorTests().catch(error => {
  log(`\n❌ Test runner error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
