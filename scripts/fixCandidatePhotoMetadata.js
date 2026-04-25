const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseServiceKey);

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : null;

const PUBLIC_MARKER = '/storage/v1/object/public/';
const SIGN_MARKER = '/storage/v1/object/sign/';

function parseStorageRef(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (raw.includes(PUBLIC_MARKER)) {
    const rest = raw.substring(raw.indexOf(PUBLIC_MARKER) + PUBLIC_MARKER.length);
    const parts = rest.split('/').filter(Boolean);
    const bucket = parts.shift();
    const storagePath = parts.join('/');
    return bucket && storagePath ? { bucket, storagePath, source: 'public-url' } : null;
  }

  if (raw.includes(SIGN_MARKER)) {
    const rest = raw.substring(raw.indexOf(SIGN_MARKER) + SIGN_MARKER.length).split('?')[0];
    const parts = rest.split('/').filter(Boolean);
    const bucket = parts.shift();
    const storagePath = parts.join('/');
    return bucket && storagePath ? { bucket, storagePath, source: 'signed-url' } : null;
  }

  if (/^[a-z0-9_-]+\/candidate_photos\//i.test(raw)) {
    const parts = raw.split('/').filter(Boolean);
    const bucket = parts.shift();
    const storagePath = parts.join('/');
    return bucket && storagePath ? { bucket, storagePath, source: 'bucket-path' } : null;
  }

  if (/^candidate_photos\//i.test(raw)) {
    return { bucket: 'documents', storagePath: raw, source: 'path-only' };
  }

  return null;
}

async function fetchCandidates() {
  const pageSize = 1000;
  const rows = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from('candidates')
      .select('id,candidate_code,name,photo_received,profile_photo_url,profile_photo_bucket,profile_photo_path,updated_at')
      .or('photo_received.eq.true,profile_photo_url.not.is.null,profile_photo_path.not.is.null')
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw error;
    }

    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
  }

  return rows;
}

async function fetchPhotoDocuments() {
  const pageSize = 1000;
  const rows = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from('candidate_documents')
      .select('id,candidate_id,file_name,mime_type,storage_bucket,storage_path,category,document_type,verification_status,created_at')
      .not('candidate_id', 'is', null)
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw error;
    }

    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
  }

  return rows.filter((doc) => {
    const category = String(doc.category || '').toLowerCase();
    const documentType = String(doc.document_type || '').toLowerCase();
    return category === 'photos' || category === 'photo' || documentType === 'photo';
  });
}

function isImageLikeDocument(document) {
  const mimeType = String(document.mime_type || '').toLowerCase();
  if (mimeType.startsWith('image/')) {
    return true;
  }

  const target = String(document.storage_path || document.file_name || '').toLowerCase();
  return /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif)$/i.test(target);
}

function chooseBestPhotoDocument(documents) {
  return [...documents]
    .filter((doc) => doc.storage_path && isImageLikeDocument(doc))
    .sort((left, right) => {
      const leftVerified = left.verification_status === 'verified' ? 1 : 0;
      const rightVerified = right.verification_status === 'verified' ? 1 : 0;
      if (leftVerified !== rightVerified) {
        return rightVerified - leftVerified;
      }

      const leftCreatedAt = left.created_at ? new Date(left.created_at).getTime() : 0;
      const rightCreatedAt = right.created_at ? new Date(right.created_at).getTime() : 0;
      return rightCreatedAt - leftCreatedAt;
    })[0] || null;
}

async function main() {
  console.log(applyChanges ? 'Applying candidate photo metadata fixes...' : 'Dry run: auditing candidate photo metadata...');

  const [candidates, photoDocuments] = await Promise.all([fetchCandidates(), fetchPhotoDocuments()]);
  const docsByCandidateId = new Map();

  for (const doc of photoDocuments) {
    if (!doc.candidate_id) continue;
    const list = docsByCandidateId.get(doc.candidate_id) || [];
    list.push(doc);
    docsByCandidateId.set(doc.candidate_id, list);
  }

  const repairs = [];
  const audit = {
    totalCandidatesScanned: candidates.length,
    totalPhotoDocumentsScanned: photoDocuments.length,
    alreadyHealthy: 0,
    repairableFromUrl: 0,
    repairableFromDocument: 0,
    unfixable: 0,
  };

  for (const candidate of candidates) {
    const currentBucket = candidate.profile_photo_bucket || null;
    const currentPath = candidate.profile_photo_path || null;
    const currentUrl = candidate.profile_photo_url || null;
    const docs = docsByCandidateId.get(candidate.id) || [];

    if (currentBucket && currentPath) {
      audit.alreadyHealthy += 1;
      continue;
    }

    let resolved = parseStorageRef(currentUrl);
    let repairSource = resolved ? resolved.source : null;

    if (!resolved) {
      const bestDoc = chooseBestPhotoDocument(docs);
      if (bestDoc) {
        if (bestDoc.storage_bucket && bestDoc.storage_path) {
          resolved = {
            bucket: bestDoc.storage_bucket,
            storagePath: bestDoc.storage_path,
            source: 'document-storage',
          };
        }
      }
      repairSource = resolved ? resolved.source : repairSource;
    }

    if (!resolved) {
      audit.unfixable += 1;
      continue;
    }

    const payload = {
      profile_photo_bucket: resolved.bucket,
      profile_photo_path: resolved.storagePath,
      photo_received: true,
      updated_at: new Date().toISOString(),
    };

    repairs.push({
      candidateId: candidate.id,
      candidateCode: candidate.candidate_code,
      name: candidate.name,
      currentBucket,
      currentPath,
      currentUrl,
      nextBucket: resolved.bucket,
      nextPath: resolved.storagePath,
      source: repairSource,
      payload,
    });

    if (repairSource && repairSource.startsWith('document')) {
      audit.repairableFromDocument += 1;
    } else {
      audit.repairableFromUrl += 1;
    }
  }

  const targetRepairs = typeof limit === 'number' && Number.isFinite(limit)
    ? repairs.slice(0, Math.max(limit, 0))
    : repairs;

  console.log(JSON.stringify({
    ...audit,
    repairsFound: repairs.length,
    repairsSelected: targetRepairs.length,
    mode: applyChanges ? 'apply' : 'dry-run',
    sample: targetRepairs.slice(0, 25).map((repair) => ({
      candidateCode: repair.candidateCode,
      name: repair.name,
      source: repair.source,
      nextBucket: repair.nextBucket,
      nextPath: repair.nextPath,
    })),
  }, null, 2));

  if (!applyChanges || targetRepairs.length === 0) {
    return;
  }

  let updated = 0;
  for (const repair of targetRepairs) {
    const { error } = await db
      .from('candidates')
      .update(repair.payload)
      .eq('id', repair.candidateId);

    if (error) {
      console.error(`Failed to update ${repair.name} (${repair.candidateCode || repair.candidateId}): ${error.message}`);
      continue;
    }

    updated += 1;
    console.log(`Updated ${repair.name} (${repair.candidateCode || repair.candidateId}) from ${repair.source}`);
  }

  console.log(JSON.stringify({ updated, requested: targetRepairs.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});