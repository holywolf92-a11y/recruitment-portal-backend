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

function normalizeExplicitGender(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'male' || raw === 'm') return 'Male';
  if (raw === 'female' || raw === 'f') return 'Female';
  return null;
}

function extractExplicitGenderFromText(value) {
  const text = String(value || ' ');
  if (!text.trim()) return null;
  const normalized = text.replace(/\s+/g, ' ');
  const match = normalized.match(/(?:^|\b)(?:gender|sex)\s*[:\-]?\s*(male|female)\b/i);
  if (!match) return null;
  return normalizeExplicitGender(match[1]);
}

function collectCandidateText(candidate) {
  return [
    candidate.name,
    candidate.father_name,
    candidate.email,
    candidate.phone,
    candidate.address,
    candidate.education,
    candidate.certifications,
    candidate.previous_employment,
    candidate.professional_summary,
    candidate.skills,
    candidate.languages,
  ].filter(Boolean).join('\n');
}

async function fetchCandidates() {
  const pageSize = 1000;
  const rows = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from('candidates')
      .select('id,candidate_code,name,father_name,email,phone,address,education,certifications,previous_employment,professional_summary,skills,languages,gender,status')
      .neq('status', 'Deleted')
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return rows;
}

async function fetchDocuments() {
  const pageSize = 1000;
  const rows = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from('candidate_documents')
      .select('id,candidate_id,file_name,document_type,category,extracted_identity_json,verification_status,updated_at,created_at')
      .not('candidate_id', 'is', null)
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return rows;
}

function chooseBestEvidence(documents) {
  return [...documents].sort((left, right) => {
    const leftVerified = left.verification_status === 'verified' ? 1 : 0;
    const rightVerified = right.verification_status === 'verified' ? 1 : 0;
    if (leftVerified !== rightVerified) return rightVerified - leftVerified;
    const leftTs = new Date(left.updated_at || left.created_at || 0).getTime();
    const rightTs = new Date(right.updated_at || right.created_at || 0).getTime();
    return rightTs - leftTs;
  })[0] || null;
}

async function main() {
  console.log(applyChanges ? 'Applying explicit gender evidence...' : 'Dry run: auditing explicit gender evidence...');
  const [candidates, documents] = await Promise.all([fetchCandidates(), fetchDocuments()]);

  const docsByCandidate = new Map();
  for (const doc of documents) {
    const list = docsByCandidate.get(doc.candidate_id) || [];
    list.push(doc);
    docsByCandidate.set(doc.candidate_id, list);
  }

  const decisions = [];
  const summary = {
    totalCandidates: candidates.length,
    existingGender: 0,
    explicitFromStructuredIdentity: 0,
    explicitFromDocumentText: 0,
    explicitFromCandidateText: 0,
    noExplicitEvidence: 0,
  };

  for (const candidate of candidates) {
    if (normalizeExplicitGender(candidate.gender)) {
      summary.existingGender += 1;
      continue;
    }

    const candidateDocs = docsByCandidate.get(candidate.id) || [];
    let evidenceGender = null;
    let evidenceSource = null;
    let evidenceSnippet = null;

    for (const doc of candidateDocs) {
      const identity = doc.extracted_identity_json && typeof doc.extracted_identity_json === 'object'
        ? doc.extracted_identity_json
        : null;
      const identityGender = normalizeExplicitGender(identity?.gender || identity?.sex);
      if (identityGender) {
        evidenceGender = identityGender;
        evidenceSource = 'structured_identity';
        evidenceSnippet = JSON.stringify({ gender: identity?.gender || null, sex: identity?.sex || null });
        break;
      }
    }

    if (!evidenceGender) {
      const candidateText = collectCandidateText(candidate);
      const explicitCandidateGender = extractExplicitGenderFromText(candidateText);
      if (explicitCandidateGender) {
        evidenceGender = explicitCandidateGender;
        evidenceSource = 'candidate_text';
        evidenceSnippet = candidateText.replace(/\s+/g, ' ').slice(0, 160);
      }
    }

    if (!evidenceGender) {
      summary.noExplicitEvidence += 1;
      continue;
    }

    if (evidenceSource === 'structured_identity') summary.explicitFromStructuredIdentity += 1;
    else if (evidenceSource === 'document_text') summary.explicitFromDocumentText += 1;
    else if (evidenceSource === 'candidate_text') summary.explicitFromCandidateText += 1;

    decisions.push({
      candidateId: candidate.id,
      candidateCode: candidate.candidate_code,
      name: candidate.name,
      gender: evidenceGender,
      source: evidenceSource,
      snippet: evidenceSnippet,
    });
  }

  const selected = typeof limit === 'number' && Number.isFinite(limit)
    ? decisions.slice(0, Math.max(limit, 0))
    : decisions;

  console.log(JSON.stringify({
    ...summary,
    found: decisions.length,
    selected: selected.length,
    mode: applyChanges ? 'apply' : 'dry-run',
    sample: selected.slice(0, 25),
  }, null, 2));

  if (!applyChanges || selected.length === 0) return;

  let updated = 0;
  for (const row of selected) {
    const { error } = await db
      .from('candidates')
      .update({ gender: row.gender, updated_at: new Date().toISOString() })
      .eq('id', row.candidateId)
      .is('gender', null);

    if (error) {
      console.error(`Failed to update ${row.name} (${row.candidateCode || row.candidateId}): ${error.message}`);
      continue;
    }
    updated += 1;
  }

  console.log(JSON.stringify({ updated, requested: selected.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});