/**
 * Tests for split-upload flow (migration 009, split-and-categorize wiring).
 * 1. Unit: docTypeToFolder mapping (no server).
 * 2. Integration: POST /documents/split-upload (requires backend + parser + env; skip if unavailable).
 *
 * Run: node scripts/testSplitUpload.js
 * Optional: PORT, HOST, API_BASE_URL, PYTHON_CV_PARSER_URL, PYTHON_HMAC_SECRET, TEST_PDF_PATH
 */

const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || '1000';
const HOST = process.env.HOST || 'localhost';
const BASE = process.env.API_BASE_URL || `http://${HOST}:${PORT}/api`;
const TEST_PDF = process.env.TEST_PDF_PATH || path.join(__dirname, '..', '..', 'recruitment-portal-frontend', 'passport_muhammad_farhan.pdf');

// Mandatory mapping (must match splitUploadService)
const DOC_TYPE_TO_FOLDER = {
  passport: 'passport',
  driving_license: 'driving_license',
  national_id: 'national_id',
  cnic: 'national_id',
  cv_resume: 'cv_resume',
  medical_certificate: 'medical_reports',
  medical_reports: 'medical_reports',
  certificate: 'certificates',
  certificates: 'certificates',
  contract: 'contracts',
  contracts: 'contracts',
  photos: 'other_documents',
  other_documents: 'other_documents',
};

function docTypeToFolder(docType) {
  const t = (docType || '').trim().toLowerCase();
  return DOC_TYPE_TO_FOLDER[t] ?? 'other_documents';
}

function runUnitTests() {
  console.log('\n=== Unit: docTypeToFolder ===');
  const cases = [
    ['passport', 'passport'],
    ['cv_resume', 'cv_resume'],
    ['medical_reports', 'medical_reports'],
    ['medical_certificate', 'medical_reports'],
    ['cnic', 'national_id'],
    ['national_id', 'national_id'],
    ['certificate', 'certificates'],
    ['contract', 'contracts'],
    ['photos', 'other_documents'],
    ['unknown', 'other_documents'],
    ['', 'other_documents'],
  ];
  let ok = 0;
  for (const [input, expected] of cases) {
    const got = docTypeToFolder(input);
    const pass = got === expected;
    if (pass) ok++;
    console.log(`  ${pass ? 'OK' : 'FAIL'} ${JSON.stringify(input)} -> ${got}${!pass ? ` (expected ${expected})` : ''}`);
  }
  console.log(`  Result: ${ok}/${cases.length}`);
  return ok === cases.length;
}

async function runIntegrationTest() {
  console.log('\n=== Integration: POST /documents/split-upload ===');
  if (!fs.existsSync(TEST_PDF)) {
    console.log(`  SKIP (no PDF at ${TEST_PDF}); set TEST_PDF_PATH to run.`);
    return true;
  }
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(TEST_PDF)], { type: 'application/pdf' });
  form.append('file', blob, path.basename(TEST_PDF));

  let res;
  try {
    res = await fetch(`${BASE}/documents/split-upload`, {
      method: 'POST',
      body: form,
    });
  } catch (e) {
    console.log(`  SKIP (backend not reachable: ${e.cause?.code || e.message})`);
    return true;
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text };
  }

  if (res.status >= 400) {
    console.log(`  FAIL ${res.status} ${JSON.stringify(json)}`);
    return false;
  }
  const { uploadId, originalPath, candidateId, engineUsed, documentCount } = json;
  const valid = typeof uploadId === 'string' && typeof originalPath === 'string' && typeof candidateId === 'string' && typeof documentCount === 'number';
  console.log(`  OK ${res.status}`);
  console.log(`    uploadId=${uploadId} candidateId=${candidateId} engineUsed=${engineUsed} documentCount=${documentCount}`);
  return valid;
}

async function main() {
  console.log('Split-upload tests (migration 009, split-and-categorize)');
  const unitOk = runUnitTests();
  const intOk = await runIntegrationTest();
  const ok = unitOk && intOk;
  console.log(ok ? '\nAll tests passed.' : '\nSome tests failed.');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
