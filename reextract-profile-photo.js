/**
 * Re-extract profile photo using AI from a specific document.
 * Usage: node reextract-profile-photo.js <candidateId> <documentId>
 */
require('dotenv').config();

const { extractProfilePhotoFromPdfUsingAI } = require('./dist/services/aiProfilePhotoExtractionService');

async function run() {
  const [candidateId, documentId] = process.argv.slice(2);
  if (!candidateId || !documentId) {
    console.error('❌ Usage: node reextract-profile-photo.js <candidateId> <documentId>');
    process.exit(1);
  }

  try {
    const result = await extractProfilePhotoFromPdfUsingAI({ candidateId, documentId, maxPages: 10 });
    console.log('✅ Re-extraction complete:', result);
  } catch (err) {
    console.error('❌ Re-extraction failed:', err?.message || err);
    process.exit(1);
  }
}

run();
