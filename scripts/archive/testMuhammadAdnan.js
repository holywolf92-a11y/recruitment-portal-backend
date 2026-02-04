/**
 * Test split-and-categorize with MUHAMMAD ADNAN-012.pdf
 * Tests the full flow: upload -> split -> create candidate_documents
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch').default || require('node-fetch');

const PDF_PATH = 'D:\\falisha\\Recruitment Automation Portal (2)\\MUHAMMAD ADNAN-012.pdf';
const BACKEND_URL = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
const API_BASE = `${BACKEND_URL}/api`;
const CANDIDATE_ID = process.env.TEST_CANDIDATE_ID; // Optional - will create if not provided

async function testSplitUpload() {
  console.log('Testing split-and-categorize with MUHAMMAD ADNAN-012.pdf\n');
  console.log('PDF Path:', PDF_PATH);
  console.log('API Base:', API_BASE);
  console.log('');

  // Check backend health first
  try {
    const healthRes = await fetch(`${BACKEND_URL}/health`, { timeout: 5000 });
    const healthText = await healthRes.text();
    console.log(`Backend health: ${healthRes.status} ${healthText}`);
  } catch (e) {
    console.log(`⚠️  Backend health check failed: ${e.message}`);
  }
  console.log('');

  // Check if PDF exists
  if (!fs.existsSync(PDF_PATH)) {
    console.error('ERROR: PDF file not found at:', PDF_PATH);
    process.exit(1);
  }

  const pdfBuffer = fs.readFileSync(PDF_PATH);
  console.log(`PDF size: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
  console.log('');

  // Test 1: POST /api/documents/split-upload (standalone endpoint)
  console.log('=== Test 1: POST /api/documents/split-upload ===');
  try {
    const form = new FormData();
    form.append('file', pdfBuffer, {
      filename: 'MUHAMMAD ADNAN-012.pdf',
      contentType: 'application/pdf',
    });
    if (CANDIDATE_ID) {
      form.append('candidate_id', CANDIDATE_ID);
      console.log('Using candidate_id:', CANDIDATE_ID);
    } else {
      console.log('No candidate_id provided - will create candidate from identity');
    }

    console.log('Sending request to split-upload (this may take 1-2 minutes)...');
    const res = await Promise.race([
      fetch(`${API_BASE}/documents/split-upload`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 3 minutes')), 180000))
    ]);

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text };
    }

    if (res.ok && json.uploadId) {
      console.log('✅ SUCCESS');
      console.log('  uploadId:', json.uploadId);
      console.log('  candidateId:', json.candidateId);
      console.log('  engineUsed:', json.engineUsed);
      console.log('  documentCount:', json.documentCount);
      console.log('  originalPath:', json.originalPath);
    } else {
      console.log('❌ FAILED', res.status);
      console.log('  Response:', JSON.stringify(json, null, 2));
    }
  } catch (e) {
    console.log('❌ ERROR:', e.message);
    if (e.cause) console.log('  Cause:', e.cause.code || e.cause.message);
  }

  console.log('');

  // Test 2: POST /api/documents/candidate-documents (main upload endpoint with split integration)
  console.log('=== Test 2: POST /api/documents/candidate-documents (with split integration) ===');
  try {
    // First, create a candidate if we don't have one
    let testCandidateId = CANDIDATE_ID;
    if (!testCandidateId) {
      console.log('Creating test candidate...');
      const createRes = await fetch(`${API_BASE}/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Muhammad Adnan Test',
          email: 'test@example.com',
        }),
      });
      if (createRes.ok) {
        const createJson = await createRes.json();
        testCandidateId = createJson.candidate?.id || createJson.id;
        console.log('Created candidate:', testCandidateId);
      } else {
        console.log('Failed to create candidate, using null UUID');
        testCandidateId = '00000000-0000-0000-0000-000000000000';
      }
    }

    const form = new FormData();
    form.append('file', pdfBuffer, {
      filename: 'MUHAMMAD ADNAN-012.pdf',
      contentType: 'application/pdf',
    });
    form.append('candidate_id', testCandidateId);
    form.append('source', 'web');

    const res = await fetch(`${API_BASE}/documents/candidate-documents`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text };
    }

    if (res.ok && json.document) {
      console.log('✅ SUCCESS');
      console.log('  document.id:', json.document.id);
      console.log('  document.category:', json.document.category);
      console.log('  document.verification_status:', json.document.verification_status);
      console.log('  request_id:', json.request_id);
      
      // If split worked, there should be multiple documents
      if (CANDIDATE_ID) {
        console.log('\n  Checking for other documents...');
        const listRes = await fetch(`${API_BASE}/documents/candidates/${json.document.candidate_id}/documents`);
        const listJson = await listRes.json();
        if (listJson.documents && listJson.documents.length > 1) {
          console.log(`  ✅ Found ${listJson.documents.length} documents (split successful)`);
          listJson.documents.forEach((doc, i) => {
            console.log(`    ${i + 1}. ${doc.file_name} (${doc.category || doc.detected_category || 'unknown'})`);
          });
        } else {
          console.log(`  ⚠️  Found ${listJson.documents?.length || 0} documents (may not have split)`);
        }
      }
    } else {
      console.log('❌ FAILED', res.status);
      console.log('  Response:', JSON.stringify(json, null, 2));
    }
  } catch (e) {
    console.log('❌ ERROR:', e.message);
    if (e.cause) console.log('  Cause:', e.cause.code || e.cause.message);
  }

  console.log('\n=== Test Complete ===');
}

testSplitUpload().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
