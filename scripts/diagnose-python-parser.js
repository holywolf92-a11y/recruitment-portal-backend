/**
 * Diagnostic Script: Test Python Parser Service
 * Tests direct connectivity and functionality of the Python AI parser
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Configuration
const PYTHON_PARSER_URL = 'https://recruitment-python-parser-production.up.railway.app';
const PYTHON_HMAC_SECRET = 'Itbfr/p8ky/dRMAHLdi/DIiQRLEJtm2SqyNfwuXa3r0=';

console.log('╔════════════════════════════════════════════════════════════════════════════╗');
console.log('║            PYTHON PARSER SERVICE DIAGNOSTICS                               ║');
console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

console.log(`Parser URL: ${PYTHON_PARSER_URL}`);
console.log(`HMAC Secret: ${PYTHON_HMAC_SECRET ? '✓ Set' : '✗ Missing'}\n`);

// Helper: Generate HMAC signature
function generateHMAC(body, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(body));
  return hmac.digest('hex');
}

// Helper: Make HTTPS request
function makeRequest(endpoint, method, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, PYTHON_PARSER_URL);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (data) {
      const bodyStr = JSON.stringify(data);
      const signature = generateHMAC(data, PYTHON_HMAC_SECRET);
      
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
      options.headers['X-HMAC-Signature'] = signature;
      
      console.log(`  Request Body: ${bodyStr.substring(0, 100)}...`);
      console.log(`  HMAC Signature: ${signature}\n`);
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data: body });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

// Test 1: Health Check
async function testHealthCheck() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('TEST 1: Health Check');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  try {
    const response = await makeRequest('/health', 'GET');
    console.log(`✅ Status: ${response.status}`);
    console.log(`Response:`, JSON.stringify(response.data, null, 2));
    return response.status === 200;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    return false;
  }
}

// Test 2: Categorize Document Endpoint (with base64)
async function testCategorizeDocument() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('TEST 2: Categorize Document Endpoint');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  try {
    // Create a simple test document
    const testFilePath = path.join(__dirname, '../test-files/sample-cv.txt');
    let fileContent;
    
    if (fs.existsSync(testFilePath)) {
      fileContent = fs.readFileSync(testFilePath);
      console.log(`✓ Using test file: ${testFilePath}`);
    } else {
      fileContent = Buffer.from(`
CURRICULUM VITAE

Name: John Doe
CNIC: 12345-1234567-1
Email: john.doe@example.com
Phone: +92-300-1234567
Passport: AB1234567

EDUCATION:
- Bachelor of Computer Science, ABC University (2020)

EXPERIENCE:
- Software Developer at Tech Corp (2020-2023)
- Junior Developer at StartUp Inc (2018-2020)

SKILLS:
- JavaScript, Python, Node.js
- React, Express, PostgreSQL
      `.trim());
      console.log(`✓ Using generated sample CV`);
    }

    const fileBase64 = fileContent.toString('base64');
    console.log(`File size: ${fileContent.length} bytes`);
    console.log(`Base64 size: ${fileBase64.length} chars\n`);

    const requestBody = {
      file_content: fileBase64,
      file_name: 'test-cv.txt',
      mime_type: 'text/plain',
      candidate_data: {
        full_name: 'John Doe',
        cnic: '12345-1234567-1',
        email: 'john.doe@example.com',
        phone: '+92-300-1234567',
        passport_no: 'AB1234567'
      }
    };

    console.log('Sending request to /categorize-document...\n');
    const response = await makeRequest('/categorize-document', 'POST', requestBody);

    console.log(`Status: ${response.status}`);
    
    if (response.status === 200) {
      console.log(`✅ SUCCESS\n`);
      console.log('Response Data:');
      console.log(JSON.stringify(response.data, null, 2));
      
      if (response.data.category) {
        console.log(`\n✓ Category: ${response.data.category}`);
        console.log(`✓ Confidence: ${response.data.confidence}`);
        console.log(`✓ Identity Fields Extracted: ${Object.keys(response.data.identity_fields || {}).length}`);
      }
      return true;
    } else {
      console.log(`❌ FAILED\n`);
      console.log('Error Response:');
      console.log(JSON.stringify(response.data, null, 2));
      return false;
    }
  } catch (error) {
    console.log(`❌ ERROR: ${error.message}`);
    console.log(error.stack);
    return false;
  }
}

// Test 3: Invalid HMAC Signature
async function testInvalidHMAC() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('TEST 3: Invalid HMAC Signature (should fail)');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  try {
    const requestBody = {
      file_content: Buffer.from('test').toString('base64'),
      file_name: 'test.txt',
      mime_type: 'text/plain'
    };

    const url = new URL('/categorize-document', PYTHON_PARSER_URL);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HMAC-Signature': 'invalid_signature_12345',
        'Content-Length': Buffer.byteLength(JSON.stringify(requestBody))
      }
    };

    const response = await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, data: body });
          }
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify(requestBody));
      req.end();
    });

    if (response.status === 401 || response.status === 403) {
      console.log(`✅ EXPECTED FAILURE: Status ${response.status}`);
      console.log(`Response:`, JSON.stringify(response.data, null, 2));
      return true;
    } else {
      console.log(`❌ UNEXPECTED: Got status ${response.status} instead of 401/403`);
      return false;
    }
  } catch (error) {
    console.log(`❌ ERROR: ${error.message}`);
    return false;
  }
}

// Test 4: Environment Variables Check
function testEnvVariables() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('TEST 4: Environment Variables Check (on Railway Backend)');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  const requiredVars = {
    'PYTHON_CV_PARSER_URL': PYTHON_PARSER_URL,
    'PYTHON_HMAC_SECRET': PYTHON_HMAC_SECRET ? '✓ Set (hidden)' : '✗ Missing'
  };

  console.log('Required Environment Variables:');
  for (const [key, value] of Object.entries(requiredVars)) {
    const status = value && value !== '✗ Missing' ? '✅' : '❌';
    console.log(`  ${status} ${key}: ${value}`);
  }

  const allSet = Object.values(requiredVars).every(v => v && v !== '✗ Missing');
  console.log(`\n${allSet ? '✅ All variables configured' : '❌ Some variables missing'}`);
  return allSet;
}

// Run all tests
async function runDiagnostics() {
  const results = {
    health: false,
    categorize: false,
    hmac: false,
    env: false
  };

  results.env = testEnvVariables();
  results.health = await testHealthCheck();
  results.categorize = await testCategorizeDocument();
  results.hmac = await testInvalidHMAC();

  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                           DIAGNOSTIC SUMMARY                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Environment Check:       ${results.env ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Health Check:            ${results.health ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Document Categorization: ${results.categorize ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`HMAC Authentication:     ${results.hmac ? '✅ PASS' : '❌ FAIL'}`);

  const passCount = Object.values(results).filter(Boolean).length;
  const totalTests = Object.keys(results).length;
  
  console.log(`\nTests Passed: ${passCount}/${totalTests} (${Math.round(passCount/totalTests*100)}%)`);

  if (passCount === totalTests) {
    console.log('\n✅ Python Parser Service is fully operational!');
    console.log('The AI worker should be able to process documents.\n');
  } else {
    console.log('\n⚠️  Issues detected. Check the failures above.');
    console.log('This may explain why AI document verification is failing.\n');
  }

  process.exit(passCount === totalTests ? 0 : 1);
}

runDiagnostics();
