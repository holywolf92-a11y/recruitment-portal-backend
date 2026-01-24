/**
 * Check document and health endpoints. Run with backend up.
 * Usage: node scripts/checkEndpoints.js [--list]
 * Env: PORT, HOST, API_BASE_URL, TEST_PDF_PATH (optional)
 */

const fs = require('fs');
const path = require('path');

const LIST_ONLY = process.argv.includes('--list');
const PORT = process.env.PORT || '1000';
const HOST = process.env.HOST || 'localhost';
const BASE = process.env.API_BASE_URL || `http://${HOST}:${PORT}`;
const TEST_PDF = process.env.TEST_PDF_PATH || path.join(__dirname, '..', '..', 'recruitment-portal-frontend', 'passport_muhammad_farhan.pdf');

async function fetchJson(method, url, opts = {}) {
  const res = await fetch(url, { method, ...opts });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, ok: res.ok };
}

function listEndpoints() {
  const api = `${BASE}/api`;
  console.log('Document & health endpoints (base: ' + BASE + ')\n');
  console.log('  GET  /health');
  console.log('  GET  ' + api + '/documents/candidate/:candidateId   (list docs by candidate)');
  console.log('  GET  ' + api + '/documents/:id                      (get doc metadata)');
  console.log('  GET  ' + api + '/documents/:id/download?expiresIn=3600');
  console.log('  POST ' + api + '/documents                          (multer file, candidate_id, doc_type, is_primary)');
  console.log('  POST ' + api + '/documents/split-upload             (multer file, optional candidate_id, candidate_data, use_textract)');
  console.log('  DELETE ' + api + '/documents/:id');
  console.log('');
  process.exit(0);
}

async function run() {
  if (LIST_ONLY) {
    listEndpoints();
    return;
  }
  console.log('Endpoint check');
  console.log('Base URL:', BASE);
  const results = [];

  // 1. Health
  try {
    const r = await fetchJson('GET', `${BASE}/health`);
    const ok = r.status === 200 && r.json?.status === 'ok';
    results.push({ name: 'GET /health', status: r.status, ok });
    console.log(ok ? '  OK   GET /health' : `  FAIL GET /health ${r.status}`, r.json);
  } catch (e) {
    results.push({ name: 'GET /health', ok: false });
    console.log('  FAIL GET /health', e.message || e);
    console.log('  (Backend not reachable. Start with: npm run dev)');
    process.exit(1);
  }

  const api = `${BASE}/api`;

  // 2. POST /api/documents (no file) -> 400
  try {
    const r = await fetchJson('POST', `${api}/documents`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const ok = r.status === 400;
    results.push({ name: 'POST /api/documents (no file)', status: r.status, ok });
    console.log(ok ? '  OK   POST /api/documents (no file) -> 400' : `  FAIL POST /api/documents ${r.status}`, r.json?.error || r.json);
  } catch (e) {
    results.push({ name: 'POST /api/documents (no file)', ok: false });
    console.log('  FAIL POST /api/documents', e.message);
  }

  // 3. POST /api/documents/split-upload (no file) -> 400
  try {
    const r = await fetchJson('POST', `${api}/documents/split-upload`);
    const ok = r.status === 400;
    results.push({ name: 'POST /api/documents/split-upload (no file)', status: r.status, ok });
    console.log(ok ? '  OK   POST /api/documents/split-upload (no file) -> 400' : `  FAIL POST /api/documents/split-upload ${r.status}`, r.json?.error || r.json);
  } catch (e) {
    results.push({ name: 'POST /api/documents/split-upload (no file)', ok: false });
    console.log('  FAIL POST /api/documents/split-upload', e.message);
  }

  // 4. GET /api/documents/candidate/:id (fake UUID) -> 200 { documents } or 500
  const fakeId = '00000000-0000-0000-0000-000000000000';
  try {
    const r = await fetchJson('GET', `${api}/documents/candidate/${fakeId}`);
    const ok = r.status === 200 && Array.isArray(r.json?.documents);
    results.push({ name: 'GET /api/documents/candidate/:candidateId', status: r.status, ok });
    console.log(r.status === 200 ? '  OK   GET /api/documents/candidate/:id' : `  NOTE GET /api/documents/candidate/:id ${r.status}`, r.json?.documents?.length ?? r.json);
  } catch (e) {
    results.push({ name: 'GET /api/documents/candidate/:candidateId', ok: false });
    console.log('  FAIL GET /api/documents/candidate/:id', e.message);
  }

  // 5. GET /api/documents/:id (fake UUID) -> 404
  try {
    const r = await fetchJson('GET', `${api}/documents/${fakeId}`);
    const ok = r.status === 404;
    results.push({ name: 'GET /api/documents/:id (missing)', status: r.status, ok });
    console.log(ok ? '  OK   GET /api/documents/:id (missing) -> 404' : `  NOTE GET /api/documents/:id ${r.status}`, r.json?.error || r.json);
  } catch (e) {
    results.push({ name: 'GET /api/documents/:id (missing)', ok: false });
    console.log('  FAIL GET /api/documents/:id', e.message);
  }

  // 6. GET /api/documents/:id/download (fake UUID) -> 404
  try {
    const r = await fetchJson('GET', `${api}/documents/${fakeId}/download`);
    const ok = r.status === 404;
    results.push({ name: 'GET /api/documents/:id/download (missing)', status: r.status, ok });
    console.log(ok ? '  OK   GET /api/documents/:id/download (missing) -> 404' : `  NOTE GET /api/documents/:id/download ${r.status}`, r.json?.error || r.json);
  } catch (e) {
    results.push({ name: 'GET /api/documents/:id/download (missing)', ok: false });
    console.log('  FAIL GET /api/documents/:id/download', e.message);
  }

  // 7. POST /api/documents/split-upload (with PDF) -> 201, if parser + env available
  if (fs.existsSync(TEST_PDF)) {
    try {
      const form = new FormData();
      const blob = new Blob([fs.readFileSync(TEST_PDF)], { type: 'application/pdf' });
      form.append('file', blob, path.basename(TEST_PDF));
      const r = await fetch(`${api}/documents/split-upload`, { method: 'POST', body: form });
      const text = await r.text();
      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { error: text };
      }
      const ok = r.status === 201 && json?.uploadId && json?.candidateId && typeof json?.documentCount === 'number';
      results.push({ name: 'POST /api/documents/split-upload (with PDF)', status: r.status, ok });
      if (ok) {
        console.log('  OK   POST /api/documents/split-upload (with PDF)', json.uploadId, json.documentCount, 'docs');
      } else {
        console.log('  SKIP POST /api/documents/split-upload (with PDF)', r.status, json?.error || json?.message || 'parser/env?');
      }
    } catch (e) {
      results.push({ name: 'POST /api/documents/split-upload (with PDF)', ok: false });
      console.log('  FAIL POST /api/documents/split-upload (with PDF)', e.message);
    }
  } else {
    console.log('  SKIP POST /api/documents/split-upload (with PDF) — no TEST_PDF at', TEST_PDF);
  }

  const passed = results.filter((x) => x.ok).length;
  const total = results.length;
  console.log('\n' + (passed === total ? 'All endpoint checks passed.' : `Passed ${passed}/${total}.`));
  process.exit(passed === total ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
