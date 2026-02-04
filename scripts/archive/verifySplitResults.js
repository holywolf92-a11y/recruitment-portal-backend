/**
 * Verify split results - check documents created for candidate
 */

const fetch = require('node-fetch').default || require('node-fetch');

const BACKEND_URL = process.env.BACKEND_URL || 'https://recruitment-portal-backend-production-d1f7.up.railway.app';
const API_BASE = `${BACKEND_URL}/api`;
const CANDIDATE_ID = process.argv[2] || 'f57024a9-9155-4c5b-a88c-5f092d605bf8'; // From test output

async function verifyDocuments() {
  console.log(`Checking documents for candidate: ${CANDIDATE_ID}\n`);

  try {
    const res = await fetch(`${API_BASE}/documents/candidates/${CANDIDATE_ID}/documents`);
    const json = await res.json();

    if (json.documents && Array.isArray(json.documents)) {
      console.log(`Found ${json.documents.length} documents:\n`);
      json.documents.forEach((doc, i) => {
        console.log(`${i + 1}. ${doc.file_name}`);
        console.log(`   Category: ${doc.category || doc.detected_category || 'unknown'}`);
        console.log(`   Type: ${doc.document_type || 'unknown'}`);
        console.log(`   Status: ${doc.verification_status || 'unknown'}`);
        console.log(`   ID: ${doc.id}`);
        console.log('');
      });

      // Group by category
      const byCategory = {};
      json.documents.forEach(doc => {
        const cat = doc.category || doc.detected_category || doc.document_type || 'unknown';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(doc);
      });

      console.log('Grouped by category:');
      Object.keys(byCategory).forEach(cat => {
        console.log(`  ${cat}: ${byCategory[cat].length} document(s)`);
      });
    } else {
      console.log('No documents found or invalid response:', json);
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

verifyDocuments();
