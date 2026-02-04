/*
  Backfill candidate experience fields from parsing_jobs output (dry-run by default).

  Why:
  - Some candidates have previous_employment stored as placeholder strings like "null".
  - The parser often returns an experience array but previous_employment may be null.
  - This script derives a readable previous_employment string from output.candidate.experience
    and fills candidates.previous_employment / candidates.experience_years ONLY when missing.

  Usage:
    node scripts/backfill-experience-fields.js --code FL-2026-897
    node scripts/backfill-experience-fields.js --recent 200

    # Actually write updates:
    node scripts/backfill-experience-fields.js --code FL-2026-897 --apply

  Safety:
  - Never overwrites manual fields (field_sources.*.source === 'manual')
  - Never overwrites non-missing values
  - Prints only short previews
*/

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error('Missing env var: ' + name);
  return v;
}

function parseArgs(argv) {
  const out = { code: null, recent: null, apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--code') out.code = argv[++i] || null;
    else if (a === '--recent') out.recent = Number(argv[++i] || '0') || null;
    else if (a === '--apply') out.apply = true;
  }
  return out;
}

function isPlaceholderString(value) {
  if (typeof value !== 'string') return false;
  const lower = value.trim().toLowerCase();
  return ['missing', 'null', 'undefined', 'n/a', 'na', 'none', 'not provided'].includes(lower);
}

function isMissingText(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  const t = value.trim();
  return t === '' || isPlaceholderString(t);
}

function safePreview(value, max = 160) {
  if (typeof value !== 'string') return null;
  const t = value.replace(/\s+/g, ' ').trim();
  if (!t || isPlaceholderString(t)) return null;
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function buildPreviousEmploymentFromExperience(experience) {
  if (!Array.isArray(experience) || experience.length === 0) return undefined;

  const lines = experience
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const title = typeof e.title === 'string' ? e.title.trim() : '';
      const company = typeof e.company === 'string' ? e.company.trim() : '';
      const location = typeof e.location === 'string' ? e.location.trim() : '';
      const start = typeof e.start_date === 'string' ? e.start_date.trim() : '';
      const end = typeof e.end_date === 'string' ? e.end_date.trim() : '';
      const description = typeof e.description === 'string' ? e.description.trim() : '';

      const role = [title, company ? 'at ' + company : ''].filter(Boolean).join(' ').trim();
      const metaParts = [location, start && end ? start + ' - ' + end : (start || end)].filter(Boolean);
      const meta = metaParts.length > 0 ? ' (' + metaParts.join(', ') + ')' : '';

      const desc = description ? '\n- ' + safePreview(description, 220) : '';
      const head = (role || company || title).trim();
      if (!head) return null;
      return head + meta + desc;
    })
    .filter(Boolean);

  if (lines.length === 0) return undefined;
  return lines.slice(0, 12).join('\n\n');
}

function parseYear(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (/^(present|current|now)$/i.test(v)) return new Date().getFullYear();
  const m = v.match(/(19\d{2}|20\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  return Number.isFinite(year) ? year : null;
}

function inferExperienceYearsFromExperience(experience) {
  if (!Array.isArray(experience) || experience.length === 0) return undefined;

  const spans = experience
    .filter((e) => e && typeof e === 'object')
    .map((e) => {
      const start = parseYear(e.start_date);
      const end = parseYear(e.end_date) ?? (start ? new Date().getFullYear() : null);
      return { start: start ?? undefined, end: end ?? undefined };
    })
    .filter((s) => s.start);

  if (spans.length === 0) return undefined;
  const minStart = Math.min.apply(null, spans.map((s) => s.start));
  const maxEnd = Math.max.apply(null, spans.map((s) => s.end ?? new Date().getFullYear()));
  const diff = maxEnd - minStart;
  if (!Number.isFinite(diff) || diff <= 0) return undefined;
  return Math.max(1, Math.round(diff));
}

async function getCandidateByCode(sb, code) {
  const { data, error } = await sb
    .from('candidates')
    .select('id,candidate_code,name,position,previous_employment,experience_years,field_sources,created_at,updated_at')
    .eq('candidate_code', code)
    .limit(1);
  if (error) throw new Error('candidates query failed: ' + error.message);
  return data && data[0] ? data[0] : null;
}

async function getRecentCandidates(sb, limit) {
  const { data, error } = await sb
    .from('candidates')
    .select('id,candidate_code,name,position,previous_employment,experience_years,field_sources,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error('recent candidates query failed: ' + error.message);
  return data || [];
}

async function getLatestCvDoc(sb, candidateId) {
  const { data, error } = await sb
    .from('candidate_documents')
    .select('id,candidate_id,inbox_attachment_id,category,created_at,file_name')
    .eq('candidate_id', candidateId)
    .eq('category', 'cv_resume')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error('candidate_documents query failed: ' + error.message);
  return data && data[0] ? data[0] : null;
}

async function getLatestParsingOutput(sb, inboxAttachmentId) {
  if (!inboxAttachmentId) return null;
  const { data, error } = await sb
    .from('parsing_jobs')
    .select('id,inbox_attachment_id,status,output,created_at')
    .eq('inbox_attachment_id', inboxAttachmentId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error('parsing_jobs query failed: ' + error.message);
  return data && data[0] ? data[0] : null;
}

function getFieldSource(candidate, field) {
  const fs = candidate.field_sources && typeof candidate.field_sources === 'object' ? candidate.field_sources : null;
  return fs ? fs[field] : null;
}

async function maybeBackfillCandidate(sb, candidate, apply) {
  const prevSource = getFieldSource(candidate, 'previous_employment');
  const yearsSource = getFieldSource(candidate, 'experience_years');

  const prevMissing = isMissingText(candidate.previous_employment);
  const yearsMissing = !(typeof candidate.experience_years === 'number' && Number.isFinite(candidate.experience_years) && candidate.experience_years > 0);

  if (prevSource && prevSource.source === 'manual') return { skipped: true, reason: 'previous_employment manual' };
  if (yearsSource && yearsSource.source === 'manual') {
    // still allow previous_employment backfill
  }

  if (!prevMissing && !yearsMissing) return { skipped: true, reason: 'not missing' };

  const cvDoc = await getLatestCvDoc(sb, candidate.id);
  if (!cvDoc || !cvDoc.inbox_attachment_id) return { skipped: true, reason: 'no cv doc / attachment' };

  const job = await getLatestParsingOutput(sb, cvDoc.inbox_attachment_id);
  const out = job && job.output && typeof job.output === 'object' ? job.output : null;
  const parsedCand = out && typeof out === 'object' ? (out.candidate || out) : null;
  const experience = parsedCand && Array.isArray(parsedCand.experience) ? parsedCand.experience : [];

  const derivedPrev = prevMissing ? buildPreviousEmploymentFromExperience(experience) : undefined;
  const derivedYears = yearsMissing && (!yearsSource || yearsSource.source !== 'manual')
    ? (typeof parsedCand?.experience_years === 'number' && parsedCand.experience_years > 0
        ? parsedCand.experience_years
        : inferExperienceYearsFromExperience(experience))
    : undefined;

  const updates = {};
  const fieldSources = candidate.field_sources && typeof candidate.field_sources === 'object' ? { ...candidate.field_sources } : {};

  if (derivedPrev && prevMissing) {
    updates.previous_employment = derivedPrev;
    fieldSources.previous_employment = {
      field: 'previous_employment',
      source: 'cv',
      document_id: cvDoc.id,
      document_type: 'cv_resume',
      updated_at: new Date().toISOString(),
    };
  }

  if (typeof derivedYears === 'number' && Number.isFinite(derivedYears) && derivedYears > 0 && yearsMissing && (!yearsSource || yearsSource.source !== 'manual')) {
    updates.experience_years = Math.round(derivedYears);
    fieldSources.experience_years = {
      field: 'experience_years',
      source: 'cv',
      document_id: cvDoc.id,
      document_type: 'cv_resume',
      updated_at: new Date().toISOString(),
    };
  }

  const updateKeys = Object.keys(updates);
  if (updateKeys.length === 0) {
    return { skipped: true, reason: 'no derived values', parsing_job_id: job?.id || null, experience_len: experience.length };
  }

  console.log('\nCandidate:', {
    code: candidate.candidate_code,
    id: candidate.id,
    name: candidate.name,
    position: candidate.position,
    prev_before: safePreview(candidate.previous_employment, 120),
    years_before: candidate.experience_years ?? null,
    prev_after: updates.previous_employment ? safePreview(updates.previous_employment, 120) : null,
    years_after: updates.experience_years ?? null,
    experience_len: experience.length,
    cv_doc: cvDoc.file_name,
    parsing_job_id: job?.id || null,
  });

  if (!apply) {
    console.log('DRY RUN: would update ->', updateKeys);
    return { updated: false, dryRun: true, fields: updateKeys };
  }

  const { error } = await sb
    .from('candidates')
    .update({
      ...updates,
      field_sources: fieldSources,
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidate.id);

  if (error) throw new Error('candidate update failed: ' + error.message);

  console.log('APPLIED: updated ->', updateKeys);
  return { updated: true, fields: updateKeys };
}

async function main() {
  const args = parseArgs(process.argv);
  const url = mustGetEnv('SUPABASE_URL');
  const key = mustGetEnv('SUPABASE_SERVICE_ROLE_KEY');

  console.log('Supabase host:', new URL(url).host);
  console.log('Apply mode:', args.apply);

  const sb = createClient(url, key, { auth: { persistSession: false } });

  let candidates = [];
  if (args.code) {
    const c = await getCandidateByCode(sb, args.code);
    if (!c) {
      console.log('No candidate found for', args.code);
      return;
    }
    candidates = [c];
  } else if (args.recent) {
    candidates = await getRecentCandidates(sb, args.recent);
  } else {
    console.log('No args provided. Try:');
    console.log('  node scripts/backfill-experience-fields.js --code FL-2026-897');
    console.log('  node scripts/backfill-experience-fields.js --recent 200');
    console.log('Add --apply to write changes.');
    return;
  }

  let updatedCount = 0;
  let dryCount = 0;
  let skippedCount = 0;

  for (const c of candidates) {
    const res = await maybeBackfillCandidate(sb, c, args.apply);
    if (res && res.updated) updatedCount++;
    else if (res && res.dryRun) dryCount++;
    else skippedCount++;
  }

  console.log('\nSummary:', { total: candidates.length, updated: updatedCount, dry_run_updates: dryCount, skipped: skippedCount });
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
