/**
 * Test candidate-documents upload with split integration
 * Uploads PDF and checks if it splits correctly
 */

const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch').default || require('node-fetch');

const PDF_PATH = 'D:\\falisha\\Recruitment Automation Portal (2)\\MUHAMMAD ADNAN-012.pdf';
const BACKEND_URL = 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
const API_BASE = `${BACKEND_URL}/api`;

async function test() {
  console.log('Testing candidate-documents upload with split integration\n');
  
  // 1. Create a test candidate
  console.log('1. Creating test candidate...');
  const createRes = await fetch(`${API_BASE}/candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Muhammad Adnan Test Split',
      email: 'adnan-test-split@example.com',
    }),
  });
  
  if (!createRes.ok) {
    const text = await createRes.text();
    console.error('Failed to create candidate:', text);
    return;
  }
  
  const candidate = await createRes.json();
  const candidateId = candidate.candidate?.id || candidate.id;
  console.log(`   ✅ Created candidate: ${candidateId}\n`);

  // 2. Upload PDF
  console.log('2. Uploading PDF (should trigger split-and-categorize)...');
  const pdfBuffer = fs.readFileSync(PDF_PATH);
  const form = new FormData();
  form.append('file', pdfBuffer, {
    filename: 'MUHAMMAD ADNAN-012.pdf',
    contentType: 'application/pdf',
  });
  form.append('candidate_id', candidateId);
  form.append('source', 'web');

  const uploadRes = await fetch(`${API_BASE}/documents/candidate-documents`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  const uploadJson = await uploadRes.json();
  
  if (!uploadRes.ok) {
    console.error('   ❌ Upload failed:', JSON.stringify(uploadJson, null, 2));
    return;
  }

  console.log(`   ✅ Upload successful`);
  console.log(`   Document ID: ${uploadJson.document?.id}`);
  console.log(`   Request ID: ${uploadJson.request_id}\n`);

  // 3. Wait a bit for processing
  console.log('3. Waiting 5 seconds for split processing...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 4. Check documents
  console.log('4. Checking documents for candidate...');
  const docsRes = await fetch(`${API_BASE}/documents/candidates/${candidateId}/documents`);
  const docsJson = await docsRes.json();

  if (docsJson.documents && Array.isArray(docsJson.documents)) {
    console.log(`   Found ${docsJson.documents.length} document(s):\n`);
    
    docsJson.documents.forEach((doc, i) => {
      console.log(`   ${i + 1}. ${doc.file_name}`);
      console.log(`      Category: ${doc.category || doc.detected_category || 'unknown'}`);
      console.log(`      Type: ${doc.document_type || 'unknown'}`);
      console.log(`      Status: ${doc.verification_status || 'unknown'}`);
      console.log(`      ID: ${doc.id}`);
      console.log('');
    });

    if (docsJson.documents.length > 1) {
      console.log('   ✅ SUCCESS: PDF was split into multiple documents!');
    } else if (docsJson.documents.length === 1) {
      console.log('   ⚠️  WARNING: Only 1 document found (split may not have worked)');
    } else {
      console.log('   ❌ ERROR: No documents found');
    }
  } else {
    console.log('   ❌ No documents found or invalid response');
  }

  console.log(`\n🔗 View candidate: ${BACKEND_URL}/api/candidates/${candidateId}`);
}

test().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
