/**
 * Diagnostic Script: AI Document Verification System
 * 
 * This script helps diagnose issues with the document verification workflow:
 * 1. Checks if worker is running
 * 2. Tests document upload
 * 3. Checks Python parser connectivity
 * 4. Verifies identity extraction
 * 5. Checks verification logs
 */

const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const PYTHON_PARSER_URL = process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-python-parser-production.up.railway.app';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  log(`\n${'='.repeat(80)}`, 'cyan');
  log(`  ${title}`, 'cyan');
  log('='.repeat(80), 'cyan');
}

async function checkBackendHealth() {
  logSection('STEP 1: Backend Health Check');
  
  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    if (response.ok) {
      log('✅ Backend is running', 'green');
      return true;
    } else {
      log('❌ Backend health check failed', 'red');
      return false;
    }
  } catch (error) {
    log(`❌ Backend not accessible: ${error.message}`, 'red');
    return false;
  }
}

async function checkPythonParser() {
  logSection('STEP 2: Python Parser Service Check');
  
  try {
    // Note: This endpoint requires HMAC, so we'll just check if it's reachable
    const response = await fetch(`${PYTHON_PARSER_URL}/health`, {
      method: 'GET',
      timeout: 5000,
    }).catch(() => null);
    
    if (response && response.ok) {
      log('✅ Python parser service is reachable', 'green');
      return true;
    } else {
      log('⚠️  Python parser health endpoint not available (this is OK if endpoint doesn\'t exist)', 'yellow');
      log(`   Service URL: ${PYTHON_PARSER_URL}`, 'blue');
      return true; // Don't fail on this
    }
  } catch (error) {
    log(`⚠️  Python parser check: ${error.message}`, 'yellow');
    log(`   Service URL: ${PYTHON_PARSER_URL}`, 'blue');
    return true; // Don't fail, just warn
  }
}

async function checkRecentDocument() {
  logSection('STEP 3: Check Recent Document Processing');
  
  try {
    // Get a recent document from the database via API
    // This would require a new endpoint, so we'll skip for now
    log('ℹ️  To check recent documents, query the database directly', 'blue');
    log('   Query: SELECT * FROM candidate_documents ORDER BY created_at DESC LIMIT 5;', 'blue');
    return true;
  } catch (error) {
    log(`⚠️  Could not check recent documents: ${error.message}`, 'yellow');
    return true;
  }
}

async function testDocumentUpload(candidateId) {
  logSection('STEP 4: Test Document Upload with Identity Info');
  
  if (!candidateId) {
    log('⚠️  No candidate ID provided, skipping upload test', 'yellow');
    log('   Usage: node diagnose-document-verification.js <candidate-id>', 'blue');
    return null;
  }
  
  try {
    // Create a test document with identity information
    const testContent = `
CURRICULUM VITAE

Name: John Doe
Father's Name: John Senior
CNIC: 12345-1234567-1
Email: john.doe@example.com
Phone: +92-300-1234567
Date of Birth: 1990-01-15

PROFESSIONAL SUMMARY
Software Engineer with 5 years of experience...
`;
    
    const testFile = path.join(__dirname, '..', 'test-files', 'test-with-identity.txt');
    
    // Ensure test-files directory exists
    const testFilesDir = path.dirname(testFile);
    if (!fs.existsSync(testFilesDir)) {
      fs.mkdirSync(testFilesDir, { recursive: true });
    }
    
    fs.writeFileSync(testFile, testContent);
    
    log(`📄 Created test file: ${testFile}`, 'blue');
    log('   Contains: Name, CNIC, Email, Phone', 'blue');
    
    // Upload document
    const formData = new FormData();
    formData.append('file', fs.createReadStream(testFile), 'test-with-identity.txt');
    formData.append('candidate_id', candidateId);
    formData.append('source', 'api');
    
    log('📤 Uploading document...', 'blue');
    const uploadResponse = await fetch(`${BACKEND_URL}/api/documents/candidate-documents`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      log(`❌ Upload failed: ${uploadResponse.status} - ${errorText}`, 'red');
      return null;
    }
    
    const uploadData = await uploadResponse.json();
    const documentId = uploadData.document?.id;
    
    if (!documentId) {
      log('❌ Upload response missing document ID', 'red');
      return null;
    }
    
    log('✅ Document uploaded successfully', 'green');
    log(`   Document ID: ${documentId}`, 'cyan');
    log(`   Request ID: ${uploadData.request_id}`, 'cyan');
    log(`   Status: ${uploadData.document.verification_status}`, 'cyan');
    
    return { documentId, requestId: uploadData.request_id };
  } catch (error) {
    log(`❌ Upload test failed: ${error.message}`, 'red');
    return null;
  }
}

async function pollDocumentStatus(documentId, maxAttempts = 20) {
  logSection('STEP 5: Poll Document Verification Status');
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${documentId}`);
      
      if (!response.ok) {
        throw new Error(`Status check failed: ${response.status}`);
      }
      
      const data = await response.json();
      const doc = data.document;
      const status = doc.verification_status;
      
      log(`   Attempt ${attempt}/${maxAttempts}: ${status}`, 'yellow');
      
      if (status !== 'pending_ai') {
        log('\n✅ Verification completed!', 'green');
        log(`   Final Status: ${status}`, 'cyan');
        log(`   Category: ${doc.category || 'N/A'}`, 'cyan');
        log(`   Confidence: ${doc.confidence || 'N/A'}`, 'cyan');
        log(`   Reason Code: ${doc.verification_reason_code || 'N/A'}`, 'cyan');
        
        if (doc.extracted_identity_json) {
          log('\n📋 Extracted Identity:', 'blue');
          log(`   ${JSON.stringify(doc.extracted_identity_json, null, 2)}`, 'cyan');
        } else {
          log('\n⚠️  No identity extracted from document', 'yellow');
        }
        
        if (doc.mismatch_fields && doc.mismatch_fields.length > 0) {
          log(`\n⚠️  Mismatch Fields: ${doc.mismatch_fields.join(', ')}`, 'yellow');
        }
        
        return doc;
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      log(`   Error (attempt ${attempt}): ${error.message}`, 'red');
      if (attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  log('⚠️  Verification still pending after max attempts', 'yellow');
  return null;
}

async function checkVerificationLogs(documentId) {
  logSection('STEP 6: Check Verification Logs');
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/verification-logs/document/${documentId}`);
    
    if (!response.ok) {
      log(`⚠️  Could not fetch logs: ${response.status}`, 'yellow');
      return;
    }
    
    const data = await response.json();
    const logs = data.logs || [];
    
    log(`📋 Found ${logs.length} log entries`, 'blue');
    
    logs.forEach((logEntry, index) => {
      log(`\n   ${index + 1}. ${logEntry.event_type}`, 'cyan');
      log(`      Status: ${logEntry.event_status}`, 'blue');
      log(`      Time: ${logEntry.created_at}`, 'blue');
      
      if (logEntry.verification_status) {
        log(`      Verification Status: ${logEntry.verification_status}`, 'blue');
      }
      
      if (logEntry.reason_code) {
        log(`      Reason: ${logEntry.reason_code}`, 'blue');
      }
      
      if (logEntry.metadata) {
        const metadata = typeof logEntry.metadata === 'string' 
          ? JSON.parse(logEntry.metadata) 
          : logEntry.metadata;
        
        if (metadata.extracted_identity) {
          log(`      Extracted Identity: ${JSON.stringify(metadata.extracted_identity)}`, 'cyan');
        }
      }
    });
    
    return logs;
  } catch (error) {
    log(`⚠️  Error fetching logs: ${error.message}`, 'yellow');
    return [];
  }
}

async function diagnoseIssues(document) {
  logSection('STEP 7: Issue Diagnosis');
  
  if (!document) {
    log('⚠️  No document data available for diagnosis', 'yellow');
    return;
  }
  
  const issues = [];
  const recommendations = [];
  
  // Check 1: Status is NO_ID_FOUND
  if (document.verification_reason_code === 'NO_ID_FOUND') {
    issues.push('Document status is NO_ID_FOUND - No identity fields extracted');
    
    if (!document.extracted_identity_json || Object.keys(document.extracted_identity_json).length === 0) {
      recommendations.push('The AI did not extract any identity fields from the document');
      recommendations.push('Possible causes:');
      recommendations.push('  1. Document is a text file without actual identity information');
      recommendations.push('  2. Document content is too short or unclear');
      recommendations.push('  3. Python parser is not extracting identity properly');
      recommendations.push('  4. OpenAI response format mismatch');
    } else {
      recommendations.push('Identity was extracted but might not match candidate record');
      recommendations.push(`Extracted: ${JSON.stringify(document.extracted_identity_json)}`);
    }
  }
  
  // Check 2: Low confidence
  if (document.confidence && document.confidence < 0.70) {
    issues.push(`Low AI confidence: ${document.confidence}`);
    recommendations.push('Document categorization confidence is below threshold (0.70)');
  }
  
  // Check 3: Category not assigned
  if (!document.category) {
    issues.push('No category assigned to document');
    recommendations.push('Document category was not detected by AI');
  }
  
  // Display issues
  if (issues.length > 0) {
    log('\n⚠️  Issues Found:', 'yellow');
    issues.forEach(issue => log(`   - ${issue}`, 'yellow'));
  } else {
    log('\n✅ No issues detected', 'green');
  }
  
  // Display recommendations
  if (recommendations.length > 0) {
    log('\n💡 Recommendations:', 'blue');
    recommendations.forEach(rec => log(`   ${rec}`, 'blue'));
  }
}

async function main() {
  log('\n╔════════════════════════════════════════════════════════════════════════════╗', 'cyan');
  log('║           AI DOCUMENT VERIFICATION DIAGNOSTIC TOOL                        ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════════════════════╝', 'cyan');
  
  log(`\nBackend URL: ${BACKEND_URL}`, 'blue');
  log(`Python Parser URL: ${PYTHON_PARSER_URL}`, 'blue');
  
  // Step 1: Health checks
  const backendOk = await checkBackendHealth();
  if (!backendOk) {
    log('\n❌ Backend is not running. Please start the backend server first.', 'red');
    process.exit(1);
  }
  
  await checkPythonParser();
  
  // Step 2: Test upload (if candidate ID provided)
  const candidateId = process.argv[2];
  let documentInfo = null;
  
  if (candidateId) {
    documentInfo = await testDocumentUpload(candidateId);
    
    if (documentInfo) {
      // Step 3: Poll for completion
      const finalDocument = await pollDocumentStatus(documentInfo.documentId);
      
      // Step 4: Check logs
      await checkVerificationLogs(documentInfo.documentId);
      
      // Step 5: Diagnose
      await diagnoseIssues(finalDocument);
    }
  } else {
    log('\n💡 To test document upload, provide a candidate ID:', 'blue');
    log('   node diagnose-document-verification.js <candidate-id>', 'cyan');
  }
  
  log('\n' + '='.repeat(80) + '\n', 'cyan');
}

main().catch(error => {
  log(`\n❌ Diagnostic error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
