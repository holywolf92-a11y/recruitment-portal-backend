/**
 * Trigger AI profile photo extraction for a candidate.
 *
 * Usage:
 *   node scripts/extract-photo-ai.js <candidateId> [documentId] [maxPages]
 *
 * Env:
 *   BACKEND_URL=https://... (optional, defaults to localhost:4000)
 *   EXTRACT_PHOTO_TOKEN=... (optional; sent as x-extract-photo-token)
 */

const candidateId = process.argv[2];
const documentId = process.argv[3];
const maxPagesArg = process.argv[4];

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const token = process.env.EXTRACT_PHOTO_TOKEN;

function usageAndExit(code) {
  console.log('Usage: node scripts/extract-photo-ai.js <candidateId> [documentId] [maxPages]');
  console.log('Env: BACKEND_URL, EXTRACT_PHOTO_TOKEN');
  process.exit(code);
}

if (!candidateId) usageAndExit(1);

const maxPages = maxPagesArg ? Number(maxPagesArg) : undefined;
if (maxPagesArg && (!Number.isFinite(maxPages) || maxPages <= 0)) {
  console.error('Invalid maxPages:', maxPagesArg);
  usageAndExit(1);
}

async function main() {
  const url = `${BACKEND_URL.replace(/\/$/, '')}/api/documents/candidates/${candidateId}/extract-photo-ai`;

  console.log('→ POST', url);
  const body = {
    ...(documentId ? { documentId } : null),
    ...(maxPages ? { maxPages } : null),
  };

  const headers = {
    'content-type': 'application/json',
    ...(token ? { 'x-extract-photo-token': token } : null),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    console.error('✗ Failed:', res.status, res.statusText);
    console.error(json ?? text);
    process.exit(1);
  }

  console.log('✓ Success');
  console.log(JSON.stringify(json, null, 2));
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
