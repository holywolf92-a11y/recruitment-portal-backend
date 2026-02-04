/*
  Read-only Supabase investigation for missing experience fields.

  Usage:
    node scripts/investigate-experience.js --code FL-2026-897
    node scripts/investigate-experience.js --sample 200

  Notes:
  - Loads backend/.env via dotenv
  - Never prints SUPABASE_SERVICE_ROLE_KEY
  - Prints compact, non-sensitive summaries only
*/

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

function mustGetEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error('Missing env var: ' + name);
  return v;
}

function parseArgs(argv) {
  const out = { code: null, sample: null, jobs: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--code') out.code = argv[++i] || null;
    else if (a === '--sample') out.sample = Number(argv[++i] || '0') || null;
    else if (a === '--jobs') out.jobs = Number(argv[++i] || '0') || null;
  }
  return out;
}

function safeString(v, max = 180) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  const lower = s.toLowerCase();
  if (!s) return '';
  if (['null', 'undefined', 'n/a', 'na', 'none', 'missing', 'not provided'].includes(lower)) {
    return null;
  }
  return s.length > max ? s.slice(0, max) + '…' : s;
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

      const role = [title, company ? 'at ' + company : ''].filter(Boolean).join(' ').trim();
      const metaParts = [location, start && end ? start + ' - ' + end : (start || end)].filter(Boolean);
      const meta = metaParts.length > 0 ? ' (' + metaParts.join(', ') + ')' : '';

      const description = typeof e.description === 'string' ? e.description.trim() : '';
      const desc = description ? '\n- ' + safeString(description, 160) : '';

      const line = (role || company || title).trim();
      if (!line) return null;
      return line + meta + desc;
    })
    .filter(Boolean);

  if (lines.length === 0) return undefined;
  return lines.slice(0, 10).join('\n\n');
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
    .select('id,name,candidate_code,position,experience_years,previous_employment,field_sources,updated_at,created_at')
    .eq('candidate_code', code)
    .limit(1);

  if (error) throw new Error('candidates query failed: ' + error.message);
  return data && data[0] ? data[0] : null;
}

async function getRecentCvDocs(sb, candidateId, limit = 10) {
  const { data, error } = await sb
    .from('candidate_documents')
    .select('id,candidate_id,inbox_attachment_id,category,document_type,source,status,verification_status,file_name,mime_type,created_at')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error('candidate_documents query failed: ' + error.message);

  const docs = data || [];
  const cvDocs = docs.filter((d) =>
    d.category === 'cv_resume' ||
    d.document_type === 'cv' ||
    (typeof d.file_name === 'string' && d.file_name.toLowerCase().includes('cv'))
  );

  return { docs, cvDocs };
}

async function getLatestParsingJobForAttachment(sb, attachmentId) {
  if (!attachmentId) return null;

  const { data, error } = await sb
    .from('parsing_jobs')
    .select('id,inbox_attachment_id,status,output,created_at')
    .eq('inbox_attachment_id', attachmentId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw new Error('parsing_jobs query failed: ' + error.message);
  return data && data[0] ? data[0] : null;
}

async function inspectOne(sb, code) {
  console.log('\n=== Candidate Inspection ===');
  console.log('Candidate code:', code);

  const c = await getCandidateByCode(sb, code);
  if (!c) {
    console.log('No candidate found.');
    return;
  }

  console.log('Candidate:', {
    id: c.id,
    name: c.name,
    position: c.position,
    experience_years: c.experience_years,
    has_previous_employment: !!c.previous_employment,
    updated_at: c.updated_at,
    created_at: c.created_at,
  });

  const sources = c.field_sources && typeof c.field_sources === 'object' ? c.field_sources : null;
  if (sources) {
    console.log('Field sources:', {
      experience_years: sources.experience_years || null,
      previous_employment: sources.previous_employment || null,
    });
  }

  const prevType = Array.isArray(c.previous_employment) ? 'array' : typeof c.previous_employment;
  console.log('previous_employment type:', prevType);
  console.log('previous_employment preview:', safeString(c.previous_employment, 220));

  const { cvDocs } = await getRecentCvDocs(sb, c.id, 10);
  console.log('Recent CV-ish documents:', cvDocs.length);

  for (let i = 0; i < Math.min(3, cvDocs.length); i++) {
    const d = cvDocs[i];
    const parsingJob = await getLatestParsingJobForAttachment(sb, d.inbox_attachment_id);
    const output = parsingJob && parsingJob.output && typeof parsingJob.output === 'object' ? parsingJob.output : null;
    const parsedCandidate = output && typeof output === 'object' ? (output.candidate || output) : null;

    const expArr = parsedCandidate && Array.isArray(parsedCandidate.experience) ? parsedCandidate.experience : null;
    const derivedPrev = parsedCandidate && !safeString(parsedCandidate.previous_employment) ? buildPreviousEmploymentFromExperience(expArr) : undefined;
    const derivedYears = parsedCandidate && (typeof parsedCandidate.experience_years !== 'number') ? inferExperienceYearsFromExperience(expArr) : undefined;

    console.log('\nDoc #' + (i + 1) + ':', {
      id: d.id,
      category: d.category,
      document_type: d.document_type,
      source: d.source,
      document_status: d.status,
      verification_status: d.verification_status,
      filename: d.file_name,
      inbox_attachment_id: d.inbox_attachment_id,
      created_at: d.created_at,
    });

    console.log('Parsing job:', parsingJob ? {
      id: parsingJob.id,
      status: parsingJob.status,
      created_at: parsingJob.created_at,
      output_keys: output ? Object.keys(output) : null,
    } : null);

    console.log('Parsed candidate snapshot:', {
      experience_years: parsedCandidate ? (parsedCandidate.experience_years ?? null) : null,
      has_previous_employment: parsedCandidate ? !!safeString(parsedCandidate.previous_employment) : null,
      experience_len: expArr ? expArr.length : 0,
      previous_employment_preview: parsedCandidate ? safeString(parsedCandidate.previous_employment, 180) : null,
      derived_previous_employment_preview: derivedPrev ? safeString(derivedPrev, 180) : null,
      derived_experience_years: derivedYears ?? null,
    });
  }
}

async function sampleScan(sb, sampleCount) {
  console.log('\n=== Sample Scan ===');
  console.log('Sample size:', sampleCount);

  const { data, error } = await sb
    .from('candidates')
    .select('id,candidate_code,name,experience_years,previous_employment,updated_at,created_at')
    .order('created_at', { ascending: false })
    .limit(sampleCount);

  if (error) throw new Error('sample candidates query failed: ' + error.message);

  const rows = data || [];
  let missingPrev = 0;
  let missingYears = 0;
  let bothMissing = 0;

  for (const r of rows) {
    const hasPrev = typeof r.previous_employment === 'string' && r.previous_employment.trim().length > 0;
    const hasYears = typeof r.experience_years === 'number' && Number.isFinite(r.experience_years) && r.experience_years > 0;

    if (!hasPrev) missingPrev++;
    if (!hasYears) missingYears++;
    if (!hasPrev && !hasYears) bothMissing++;
  }

  console.log('Missing previous_employment:', missingPrev + '/' + rows.length);
  console.log('Missing experience_years:', missingYears + '/' + rows.length);
  console.log('Missing BOTH:', bothMissing + '/' + rows.length);
}

async function scanParsingJobs(sb, jobCount) {
  console.log('\n=== Parsing Jobs Scan ===');
  console.log('Jobs scanned:', jobCount);

  const { data, error } = await sb
    .from('parsing_jobs')
    .select('id,status,created_at,output,inbox_attachment_id')
    .order('created_at', { ascending: false })
    .limit(jobCount);

  if (error) throw new Error('parsing_jobs scan failed: ' + error.message);

  const rows = data || [];
  let extracted = 0;
  let expEmpty = 0;
  let prevMissing = 0;
  let yearsMissing = 0;
  let allMissing = 0;

  for (const r of rows) {
    if (r.status !== 'extracted') continue;
    extracted++;

    const out = r.output && typeof r.output === 'object' ? r.output : null;
    const cand = out && typeof out === 'object' ? (out.candidate || out) : null;
    const experience = cand && Array.isArray(cand.experience) ? cand.experience : [];
    const prev = cand ? safeString(cand.previous_employment) : null;
    const years = cand && typeof cand.experience_years === 'number' ? cand.experience_years : null;

    const expIsEmpty = !experience || experience.length === 0;
    const prevIsMissing = !prev;
    const yearsIsMissing = !(typeof years === 'number' && Number.isFinite(years) && years > 0);

    if (expIsEmpty) expEmpty++;
    if (prevIsMissing) prevMissing++;
    if (yearsIsMissing) yearsMissing++;
    if (expIsEmpty && prevIsMissing && yearsIsMissing) allMissing++;
  }

  console.log('Extracted jobs:', extracted + '/' + rows.length);
  if (extracted === 0) return;
  console.log('Experience array empty:', expEmpty + '/' + extracted);
  console.log('previous_employment missing:', prevMissing + '/' + extracted);
  console.log('experience_years missing:', yearsMissing + '/' + extracted);
  console.log('ALL missing (exp+prev+years):', allMissing + '/' + extracted);
}

async function main() {
  const args = parseArgs(process.argv);

  const url = mustGetEnv('SUPABASE_URL');
  const key = mustGetEnv('SUPABASE_SERVICE_ROLE_KEY');

  console.log('Supabase host:', new URL(url).host);
  console.log('Service role key present:', !!key);

  const sb = createClient(url, key, { auth: { persistSession: false } });

  if (args.code) {
    await inspectOne(sb, args.code);
  }

  if (args.sample) {
    await sampleScan(sb, args.sample);
  }

  if (args.jobs) {
    await scanParsingJobs(sb, args.jobs);
  }

  if (!args.code && !args.sample && !args.jobs) {
    console.log('\nNo args provided. Try:');
    console.log('  node scripts/investigate-experience.js --code FL-2026-897');
    console.log('  node scripts/investigate-experience.js --sample 200');
    console.log('  node scripts/investigate-experience.js --jobs 200');
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
