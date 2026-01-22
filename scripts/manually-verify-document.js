/**
 * Manually trigger document verification for a stuck document
 * Usage: node scripts/manually-verify-document.js <document-id>
 */

require('dotenv').config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const DOCUMENT_ID = process.argv[2];

if (!DOCUMENT_ID) {
  console.error('❌ Usage: node scripts/manually-verify-document.js <document-id>');
  process.exit(1);
}

async function reprocessDocument() {
  try {
    console.log(`🔄 Reprocessing document ${DOCUMENT_ID}...`);
    
    const response = await fetch(`${BACKEND_URL}/api/documents/candidate-documents/${DOCUMENT_ID}/reprocess`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to reprocess: ${response.status} ${error}`);
    }

    const result = await response.json();
    console.log('✅ Document reprocessing initiated:', result);
    console.log(`\n📋 Request ID: ${result.request_id}`);
    console.log('\n⏳ The document will be processed by the AI worker.');
    console.log('   Check the document status in a few seconds.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

reprocessDocument();
