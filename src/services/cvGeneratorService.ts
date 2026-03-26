import { supabaseAdminClient } from '../config/database';
import { getCandidateById } from './candidateService';
import { listCandidateDocumentsByCandidate } from './candidateDocumentService';
// puppeteer is intentionally NOT statically imported here.
// A static import loads Chromium bindings into V8 heap at startup (~300-500 MB idle RAM cost).
// Instead we use a dynamic import() inside generatePDFFromHTML so Chromium is only
// loaded into memory when a CV is actually being generated.
import crypto from 'crypto';
import { getTemplateVersion } from '../config/cvTemplateConfig';
import { DOCUMENT_CATEGORIES } from '../config/documentCategories';

const STORAGE_BUCKET = 'documents';

async function fetchLatestParsedCVFromParsingJobs(documents: any[]): Promise<any | null> {
  try {
    const attachmentId =
      documents?.find((d: any) => d?.category === DOCUMENT_CATEGORIES.CV_RESUME && d?.inbox_attachment_id)?.inbox_attachment_id ||
      documents?.find((d: any) => d?.inbox_attachment_id)?.inbox_attachment_id;

    if (!attachmentId) return null;

    const db = supabaseAdminClient();
    const { data, error } = await db
      .from('parsing_jobs')
      .select('output, created_at')
      .eq('inbox_attachment_id', attachmentId)
      .eq('status', 'extracted')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return null;

    const output = (data[0] as any)?.output;
    if (!output) return null;
    if (typeof output === 'string') {
      try {
        return JSON.parse(output);
      } catch {
        return null;
      }
    }
    return output;
  } catch {
    return null;
  }
}

export interface BulkCVRequest {
  candidate_ids: string[];
  format?: 'standard' | 'employer-safe';
  template?: string;
}

export interface CVGenerationResult {
  candidate_id: string;
  candidate_name: string;
  success: boolean;
  cv_url?: string;
  error?: string;
}

export interface CVGenerationOptions {
  candidateId: string;
  format: 'employer-safe' | 'internal' | 'standard';
  template?: 'professional' | 'modern' | 'compact';
  forceRegenerate?: boolean;
  userId?: string;
}

export interface CVGenerationResponse {
  cv_url: string;
  cached: boolean;
  version_hash: string;
  file_size?: number;
}

/**
 * Calculate SHA256 hash of candidate data for cache invalidation
 */
async function calculateCandidateVersionHash(candidateId: string, format?: CVGenerationOptions['format']): Promise<string> {
  const db = supabaseAdminClient();

  const { data: candidate, error } = await db
    .from('candidates')
    .select('name, position, nationality, experience_years, skills, languages, education, certifications, previous_employment, professional_summary, country_of_interest, profile_photo_url, ai_score, updated_at')
    .eq('id', candidateId)
    .single();

  if (error || !candidate) {
    throw new Error(`Candidate not found: ${candidateId}`);
  }

  // Include latest extracted parsing output (employer-safe only) so cache busts when the parser improves.
  // This avoids stale employer-safe PDFs when we render directly from parsing_jobs.output.
  let parsingOutputHash = '';
  try {
    if (format === 'employer-safe') {
      const { data: cvDoc } = await db
        .from('candidate_documents')
        .select('inbox_attachment_id, created_at')
        .eq('candidate_id', candidateId)
        .eq('category', DOCUMENT_CATEGORIES.CV_RESUME)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const attachmentId = (cvDoc as any)?.inbox_attachment_id;
      if (attachmentId) {
        const { data: job } = await db
          .from('parsing_jobs')
          .select('output, created_at')
          .eq('inbox_attachment_id', attachmentId)
          .eq('status', 'extracted')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (job) {
          const output = (job as any).output;
          const outputString = typeof output === 'string' ? output : JSON.stringify(output ?? '');
          parsingOutputHash = crypto.createHash('sha256').update(outputString).digest('hex');
        }
      }
    }
  } catch (e) {
    // Non-fatal: cache hash falls back to candidate fields.
    parsingOutputHash = '';
  }

  const dataString = [
    getTemplateVersion(), // Include template version to bust cache when design changes
    candidate.name || '',
    candidate.position || '',
    candidate.nationality || '',
    candidate.experience_years?.toString() || '',
    candidate.skills || '',
    candidate.languages || '',
    candidate.education || '',
    candidate.certifications || '',
    candidate.previous_employment || '',
    candidate.professional_summary || '',
    candidate.country_of_interest || '',
    candidate.updated_at || '',
    parsingOutputHash,
  ].join('|');

  return crypto.createHash('sha256').update(dataString).digest('hex');
}

/**
 * Check if a cached CV exists and is still valid
 */
async function checkCache(options: CVGenerationOptions): Promise<{
  exists: boolean;
  signed_url?: string;
  version_hash?: string;
  storage_path?: string;
}> {
  const db = supabaseAdminClient();

  // Calculate current version hash
  const currentVersionHash = await calculateCandidateVersionHash(options.candidateId, options.format);

  // Check if cached CV exists with matching version hash
  const { data: cached, error } = await db
    .from('generated_cvs')
    .select('storage_path, version_hash, storage_bucket')
    .eq('candidate_id', options.candidateId)
    .eq('format', options.format)
    .eq('version_hash', currentVersionHash)
    .maybeSingle();

  if (error || !cached) {
    return { exists: false };
  }

  // Generate signed URL for cached PDF
  const { data: signedUrlData, error: urlError } = await db.storage
    .from(cached.storage_bucket || STORAGE_BUCKET)
    .createSignedUrl(cached.storage_path, 7 * 24 * 60 * 60); // 7 days

  if (urlError || !signedUrlData) {
    console.warn(`Failed to generate signed URL for cached CV: ${urlError?.message}`);
    return { exists: false };
  }

  // Update access stats
  // Note: Supabase doesn't support raw SQL in updates, we'll increment on the server side
  // For now, we'll fetch and increment manually, or use a database function
  // Simplified approach: just update last_accessed_at
  await db
    .from('generated_cvs')
    .update({
      last_accessed_at: new Date().toISOString(),
    })
    .eq('candidate_id', options.candidateId)
    .eq('format', options.format)
    .eq('version_hash', currentVersionHash);

  return {
    exists: true,
    signed_url: signedUrlData.signedUrl,
    version_hash: cached.version_hash,
    storage_path: cached.storage_path,
  };
}

/**
 * Generate a signed URL for the profile photo if it exists
 */
async function generateProfilePhotoSignedUrl(candidate: any): Promise<string | null> {
  try {
    // Check if we have bucket and path
    let bucket = candidate.profile_photo_bucket;
    let storagePath = candidate.profile_photo_path;

    // If not, try to derive from URL
    if ((!bucket || !storagePath) && candidate.profile_photo_url) {
      const url: string = candidate.profile_photo_url;
      const publicMarker = '/storage/v1/object/public/';
      const signMarker = '/storage/v1/object/sign/';

      if (url.includes(publicMarker)) {
        const rest = url.substring(url.indexOf(publicMarker) + publicMarker.length);
        const parts = rest.split('/');
        bucket = parts.shift() || 'documents';
        storagePath = parts.join('/');
      } else if (url.includes(signMarker)) {
        const after = url.substring(url.indexOf(signMarker) + signMarker.length).split('?')[0];
        const parts = after.split('/');
        bucket = parts.shift() || 'documents';
        storagePath = parts.join('/');
      }
    }

    if (!bucket || !storagePath) {
      console.log('[CVGenerator] No profile photo bucket/path found, skipping signed URL generation');
      return null;
    }

    // Generate a long-lived signed URL (1 year)
    const db = supabaseAdminClient();
    const { data: signedData, error } = await db.storage
      .from(bucket)
      .createSignedUrl(storagePath, 31536000); // 1 year (permanent)

    if (error || !signedData?.signedUrl) {
      console.warn(`[CVGenerator] Failed to generate signed URL for profile photo: ${error?.message}`);
      return null;
    }

    console.log('[CVGenerator] Generated signed URL for profile photo');
    return signedData.signedUrl;
  } catch (err: any) {
    console.warn(`[CVGenerator] Error generating profile photo signed URL: ${err.message}`);
    return null;
  }
}

function isMeaningfulCvText(value: any): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return !['missing', 'null', 'undefined', 'n/a', 'na', 'none', 'not provided', 'unknown', '[]'].includes(lower);
}

function escapeCvHtml(value: any): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toStringArray(value: any, maxItems = 25): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : (entry?.name || entry?.title || entry?.text || String(entry))))
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry).trim()))
      .filter(Boolean)
      .slice(0, maxItems);
  }
  if (typeof value === 'string') {
    const normalized = value
      .split(/\r?\n|,|;|\||\u2022|•/)
      .map((part) => part.trim())
      .filter(Boolean);
    return normalized.slice(0, maxItems);
  }
  return [String(value)];
}

function formatDateRange(start: any, end: any): string {
  const s = (start || '').toString().trim();
  const e = (end || '').toString().trim();
  if (!s && !e) return '';
  if (s && !e) return `${s} - Present`;
  if (!s && e) return e;
  return `${s} - ${e}`;
}

type SkillBucket = {
  title: string;
  items: string[];
};

function normalizeSkillLabel(skill: string): string {
  const trimmed = skill.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  const aliases: Record<string, string> = {
    babysitting: 'Babysitting & Childcare',
    childcare: 'Babysitting & Childcare',
    'baby sitting': 'Babysitting & Childcare',
    cleaning: 'Cleaning & Housekeeping',
    housekeeping: 'Cleaning & Housekeeping',
    'house keeping': 'Cleaning & Housekeeping',
    dusting: 'Cleaning & Housekeeping',
    washing: 'Washing Clothes',
    laundry: 'Washing Clothes',
    ironing: 'Ironing',
    dishwashing: 'Dishwashing',
    'dish washing': 'Dishwashing',
    cooking: 'Cooking & Meal Preparation',
    cook: 'Cooking & Meal Preparation',
    driver: 'Driving',
    driving: 'Driving',
    'elderly care': 'Elderly Care',
    'elder care': 'Elderly Care',
    caregiving: 'Caregiving',
    'care giving': 'Caregiving',
    caregiver: 'Caregiving',
  };
  if (aliases[lower]) return aliases[lower];

  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function inferTargetRole(candidate: any, parsed: any, normalizedSkills: string[], experienceTitles: string[]): string {
  const explicitRole = [candidate.position, parsed?.position, parsed?.job_title, parsed?.target_role]
    .find((value) => isMeaningfulCvText(value));
  if (explicitRole) return String(explicitRole).trim();

  const corpus = [
    ...normalizedSkills,
    ...experienceTitles,
    candidate.previous_employment || '',
    parsed?.summary || '',
  ].join(' ').toLowerCase();

  const roleRules = [
    { role: 'Domestic Helper', keywords: ['cleaning', 'housekeeping', 'washing clothes', 'ironing', 'dishwashing', 'babysitting', 'childcare', 'elderly care'] },
    { role: 'Driver', keywords: ['driving', 'driver', 'chauffeur'] },
    { role: 'Cook / Kitchen Helper', keywords: ['cooking', 'meal preparation', 'kitchen', 'cook'] },
    { role: 'Caregiver', keywords: ['caregiving', 'elderly care', 'patient care', 'home care'] },
    { role: 'Security Guard', keywords: ['security', 'guard', 'patrol'] },
    { role: 'Housekeeper', keywords: ['housekeeping', 'cleaning & housekeeping'] },
  ];

  let bestRole = 'Domestic Helper';
  let bestScore = 0;
  for (const rule of roleRules) {
    const score = rule.keywords.reduce((count, keyword) => count + (corpus.includes(keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      bestRole = rule.role;
      bestScore = score;
    }
  }
  return bestRole;
}

function buildSkillBuckets(normalizedSkills: string[]): SkillBucket[] {
  const buckets: SkillBucket[] = [
    { title: 'Core Skills', items: [] },
    { title: 'Household Tasks', items: [] },
    { title: 'Care Support', items: [] },
    { title: 'Additional Strengths', items: [] },
  ];

  const seen = new Set<string>();
  for (const skill of normalizedSkills) {
    if (!skill || seen.has(skill)) continue;
    seen.add(skill);
    const lower = skill.toLowerCase();

    if (/(cleaning|housekeeping|driving|cooking|meal preparation)/.test(lower)) {
      buckets[0].items.push(skill);
      continue;
    }
    if (/(washing clothes|ironing|dishwashing|laundry)/.test(lower)) {
      buckets[1].items.push(skill);
      continue;
    }
    if (/(childcare|babysitting|elderly care|caregiving)/.test(lower)) {
      buckets[2].items.push(skill);
      continue;
    }
    buckets[3].items.push(skill);
  }

  return buckets.filter((bucket) => bucket.items.length > 0);
}

function buildProfessionalLanguages(rawLanguages: string[]): string[] {
  const nativeLanguages = new Set(['luhya', 'swahili', 'kiswahili', 'luganda', 'somali', 'kinyarwanda', 'luo', 'kikuyu', 'kamba']);
  const basicLanguages = new Set(['english', 'arabic', 'french']);
  const seen = new Set<string>();

  return rawLanguages
    .map((language) => language.trim())
    .filter(Boolean)
    .map((language) => {
      if (/\((.*?)\)/.test(language)) return language;
      const lower = language.toLowerCase();
      const label = language.charAt(0).toUpperCase() + language.slice(1).toLowerCase();
      if (nativeLanguages.has(lower)) return `${label} (Native)`;
      if (basicLanguages.has(lower)) return `${label} (Basic)`;
      return `${label} (Conversational)`;
    })
    .filter((language) => {
      const key = language.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildGeneratedExperience(role: string, skillBuckets: SkillBucket[], experienceYears?: any): any[] {
  const years = Number(experienceYears);
  const yearsLabel = Number.isFinite(years) && years > 0 ? `${years} year${years === 1 ? '' : 's'}` : 'practical';
  const allSkills = skillBuckets.flatMap((bucket) => bucket.items).map((item) => item.toLowerCase());
  const bullets: string[] = [];

  if (allSkills.some((skill) => /(cleaning|housekeeping)/.test(skill))) {
    bullets.push('Performed household cleaning, room organization, and day-to-day housekeeping to maintain a safe and orderly home.');
  }
  if (allSkills.some((skill) => /(childcare|babysitting)/.test(skill))) {
    bullets.push('Supported children with daily routines, supervision, and general childcare assistance in a home environment.');
  }
  if (allSkills.some((skill) => /(elderly care|caregiving)/.test(skill))) {
    bullets.push('Assisted with elderly care and personal support tasks while maintaining a respectful and attentive standard of service.');
  }
  if (allSkills.some((skill) => /(washing clothes|ironing|dishwashing|laundry)/.test(skill))) {
    bullets.push('Managed laundry, ironing, and other household support duties to keep daily operations running smoothly.');
  }
  if (allSkills.some((skill) => /(driving)/.test(skill))) {
    bullets.push('Provided safe and reliable transportation support while maintaining cleanliness and readiness of assigned vehicles.');
  }
  if (allSkills.some((skill) => /(cooking|meal preparation)/.test(skill))) {
    bullets.push('Prepared meals and assisted with kitchen organization, food handling, and routine household support.');
  }

  if (bullets.length === 0) {
    bullets.push('Delivered dependable household support, adapted quickly to employer needs, and maintained a professional work standard.');
    bullets.push('Worked effectively as a team-oriented helper with focus on cleanliness, safety, and respectful client service.');
  }

  return [{
    title: role,
    company: 'Private Household / Employer',
    location: '',
    dateLabel: `${yearsLabel} experience`,
    bullets: bullets.slice(0, 5),
    isGenerated: true,
  }];
}

function buildProfessionalSummary(candidate: any, role: string, skillBuckets: SkillBucket[], experienceYears?: any, existingSummary?: string): string {
  if (isMeaningfulCvText(existingSummary) && !/missing/i.test(existingSummary) && existingSummary!.trim().length >= 50) {
    return existingSummary!.trim();
  }

  const years = Number(experienceYears);
  const yearsText = Number.isFinite(years) && years > 0 ? `${years} year${years === 1 ? '' : 's'}` : 'hands-on';
  const headlineSkills = skillBuckets.flatMap((bucket) => bucket.items).slice(0, 3);
  const skillsText = headlineSkills.length > 0 ? headlineSkills.join(', ').replace(/, ([^,]*)$/, ', and $1') : 'household support, reliability, and day-to-day service';
  const market = isMeaningfulCvText(candidate.country_of_interest) ? candidate.country_of_interest.trim() : 'employers seeking dependable support staff';
  return `Dedicated ${role} with ${yearsText} experience in ${skillsText}. Presents as reliable, adaptable, and focused on maintaining a clean, organized, and supportive environment for ${market}.`;
}

function normalizeExperienceEntries(parsedExperience: any[]): any[] {
  return parsedExperience.map((role: any) => {
    const title = role?.job_title || role?.title || role?.position || '';
    const company = role?.company || role?.employer || role?.organization || '';
    const location = role?.location || role?.city || role?.country || '';
    const dateLabel = formatDateRange(role?.start_date || role?.from || role?.start, role?.end_date || role?.to || role?.end);
    const bullets = toStringArray(role?.responsibilities || role?.achievements || role?.duties || role?.highlights, 12);
    const description = role?.description || role?.summary || '';
    return {
      title,
      company,
      location,
      dateLabel,
      bullets,
      description,
      isGenerated: false,
    };
  }).filter((entry) => entry.title || entry.company || entry.location || entry.dateLabel || entry.bullets.length > 0 || isMeaningfulCvText(entry.description));
}

function buildEducationText(candidate: any, parsedEducation: any[]): string | null {
  if (parsedEducation.length > 0) return null;
  if (isMeaningfulCvText(candidate.education)) return candidate.education.trim();
  return 'Details not provided';
}

function enrichEmployerCvData(candidate: any, parsedCv?: any | null) {
  const parsed: any = (parsedCv && (parsedCv.candidate || parsedCv.parsed_data))
    ? (parsedCv.candidate || parsedCv.parsed_data)
    : (parsedCv || null);

  const rawSkills = asArray<string>(parsed?.skills).length > 0
    ? asArray<string>(parsed?.skills)
    : toStringArray(candidate.skills, 30);
  const normalizedSkills = rawSkills.map(normalizeSkillLabel).filter(Boolean);
  const parsedExperience = normalizeExperienceEntries(asArray<any>(parsed?.experience));
  const experienceTitles = parsedExperience.map((entry) => entry.title).filter(Boolean);
  const targetRole = inferTargetRole(candidate, parsed, normalizedSkills, experienceTitles);
  const skillBuckets = buildSkillBuckets(normalizedSkills);
  const summary = buildProfessionalSummary(
    candidate,
    targetRole,
    skillBuckets,
    parsed?.experience_years ?? candidate.experience_years,
    isMeaningfulCvText(parsed?.professional_summary)
      ? String(parsed.professional_summary).trim()
      : (isMeaningfulCvText(candidate.professional_summary) ? candidate.professional_summary.trim() : '')
  );
  const languages = buildProfessionalLanguages(
    asArray<string>(parsed?.languages).length > 0
      ? asArray<string>(parsed?.languages)
      : toStringArray(candidate.languages, 12)
  );
  const experience = parsedExperience.length > 0
    ? parsedExperience
    : buildGeneratedExperience(targetRole, skillBuckets, parsed?.experience_years ?? candidate.experience_years);

  return {
    parsed,
    targetRole,
    summary,
    skillBuckets,
    flatSkills: skillBuckets.flatMap((bucket) => bucket.items),
    languages,
    experience,
    parsedEducation: asArray<any>(parsed?.education),
    parsedCertifications: asArray<any>(parsed?.certifications || parsed?.certificates),
    parsedLicenses: asArray<any>(parsed?.licenses),
    educationFallback: buildEducationText(candidate, asArray<any>(parsed?.education)),
    previousEmployment: isMeaningfulCvText(candidate.previous_employment) ? candidate.previous_employment.trim() : '',
  };
}

/**
 * Generate HTML template for employer-safe CV
 */
function generateEmployerSafeCVHTML(candidate: any, documents: any[], parsedCv?: any | null): string {
  const enriched = enrichEmployerCvData(candidate, parsedCv);

  const experienceHtml = enriched.experience.length > 0
    ? `
      <div class="section">
        <h2 class="section-title">Work Experience</h2>
        ${enriched.experience.map((role: any) => `
          <div class="entry">
            <div class="entry-title">${escapeCvHtml([role.title, role.company].filter(Boolean).join(' - '))}</div>
            ${(role.location || role.dateLabel) ? `<div class="entry-meta">${escapeCvHtml([role.location, role.dateLabel].filter(Boolean).join(' | '))}</div>` : ''}
            ${role.bullets?.length > 0
              ? `<ul class="bullet-list">${role.bullets.map((bullet: string) => `<li>${escapeCvHtml(bullet)}</li>`).join('')}</ul>`
              : (isMeaningfulCvText(role.description)
                ? `<ul class="bullet-list"><li>${escapeCvHtml(role.description)}</li></ul>`
                : '')}
          </div>
        `).join('')}
      </div>
    `
    : (enriched.previousEmployment ? `
      <div class="section">
        <h2 class="section-title">Work Experience</h2>
        <div class="entry">
          <div class="entry-description" style="white-space: pre-line;">${escapeCvHtml(enriched.previousEmployment)}</div>
        </div>
      </div>
    ` : '');

  const educationHtml = enriched.parsedEducation.length > 0
    ? `
      <div class="section">
        <h2 class="section-title">Education</h2>
        ${enriched.parsedEducation.map((ed: any) => {
          const degree = ed?.degree || ed?.qualification || ed?.title || '';
          const institution = ed?.institution || ed?.university || ed?.school || '';
          const location = ed?.location || ed?.city || ed?.country || '';
          const dates = formatDateRange(ed?.start_year || ed?.start_date || ed?.from, ed?.end_year || ed?.end_date || ed?.to);
          const thesis = ed?.thesis || '';
          return `
          <div class="entry">
            <div class="entry-title">${escapeCvHtml([degree, institution].filter(Boolean).join(' - '))}</div>
            ${(location || dates) ? `<div class="entry-meta">${escapeCvHtml([location, dates].filter(Boolean).join(' | '))}</div>` : ''}
            ${isMeaningfulCvText(thesis) ? `<div class="entry-description" style="white-space: pre-line;">${escapeCvHtml(thesis)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    `
    : `
      <div class="section">
        <h2 class="section-title">Education</h2>
        <div class="entry">
          <div class="entry-description">${escapeCvHtml(enriched.educationFallback)}</div>
        </div>
      </div>
    `;

  const certificationsHtml = enriched.parsedCertifications.length > 0
    ? `
      <div class="section">
        <h2 class="section-title">Certifications</h2>
        <div class="entry">
          <ul class="bullet-list">
            ${enriched.parsedCertifications.slice(0, 20).map((cert: any) => {
              const name = cert?.name || cert?.title || cert;
              const issuer = cert?.issuer || cert?.authority || '';
              const date = cert?.date || cert?.year || '';
              return `<li>${escapeCvHtml([name, issuer, date].filter(Boolean).join(' - '))}</li>`;
            }).join('')}
          </ul>
        </div>
      </div>
    `
    : '';

  const parsedLicenses = enriched.parsedLicenses;
  const licensesHtml = parsedLicenses.length > 0
    ? `
      <div class="section">
        <h2 class="section-title">Licenses</h2>
        ${parsedLicenses.slice(0, 20).map((lic: any) => {
          const name = lic?.name || lic?.title || '';
          const authority = lic?.authority || '';
          const reg = lic?.registration_no || lic?.registration_number || '';
          const country = lic?.country || '';
          const expiry = lic?.expiry_date || lic?.expiry || '';
          const notes = lic?.notes || '';
          const meta = [authority, country, reg ? `Reg#: ${reg}` : '', expiry ? `Expiry: ${expiry}` : ''].filter(Boolean).join(' | ');
          return `
          <div class="entry">
            <div class="entry-title">${escapeCvHtml(name)}</div>
            ${meta ? `<div class="entry-meta">${escapeCvHtml(meta)}</div>` : ''}
            ${isMeaningfulCvText(notes) ? `<div class="entry-description" style="white-space: pre-line;">${escapeCvHtml(notes)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    `
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Employer-Safe CV - ${candidate.name || 'Candidate'}</title>
  <style>
    /* Modern Minimalist CV Design - Two Column Layout */
    @page {
      size: A4;
      margin: 0;
    }
    
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    
    body {
      font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.4;
      color: #2d3748;
      background: #ffffff;
      font-size: 9pt;
      margin: 0;
      padding: 0;
    }

    .page {
      width: 210mm;
      min-height: 297mm;
      display: flex;
      flex-direction: column;
      background: #ffffff;
    }
    
    .container { 
      width: 100%; 
      background: white;
      display: flex;
      flex: 1;
    }
    
    /* Left Sidebar - Dark Accent */
    .sidebar {
      width: 70mm;
      background: #1e293b;
      color: #e2e8f0;
      padding: 15mm 10mm;
      flex-shrink: 0;
    }
    
    .sidebar-section {
      margin-bottom: 12pt;
    }
    
    .sidebar-section:last-child {
      margin-bottom: 0;
    }
    
    .sidebar h3 {
      font-size: 10pt;
      font-weight: 700;
      color: #60a5fa;
      text-transform: uppercase;
      letter-spacing: 0.5pt;
      margin-bottom: 6pt;
      border-bottom: 1.5pt solid #60a5fa;
      padding-bottom: 3pt;
    }
    
    .sidebar p,
    .sidebar li {
      font-size: 8.5pt;
      line-height: 1.4;
      color: #cbd5e1;
    }
    
    .sidebar ul {
      list-style: none;
      padding: 0;
    }
    
    .sidebar li {
      margin-bottom: 4pt;
      padding-left: 12pt;
      position: relative;
    }
    
    .sidebar li:before {
      content: '▸';
      position: absolute;
      left: 0;
      color: #60a5fa;
    }
    
    /* Profile Photo */
    .profile-photo {
      width: 50mm;
      height: 50mm;
      border-radius: 50%;
      object-fit: cover;
      border: 3pt solid #60a5fa;
      margin: 0 auto 12pt auto;
      display: block;
    }
    
    /* Skill Items */
    .skill-item {
      margin-bottom: 6pt;
    }
    
    .skill-name {
      font-size: 8pt;
      font-weight: 600;
      color: #e2e8f0;
      margin-bottom: 2pt;
    }
    
    .skill-bar {
      width: 100%;
      height: 4pt;
      background: #334155;
      border-radius: 2pt;
      overflow: hidden;
    }
    
    .skill-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #60a5fa 0%, #3b82f6 100%);
    }
    
    /* Main Content Area */
    .main-content {
      flex: 1;
      padding: 15mm 15mm 15mm 12mm;
      background: #ffffff;
      display: flex;
      flex-direction: column;
    }
    
    /* Header in Main Content */
    .main-header {
      margin-bottom: 12pt;
      border-bottom: 2pt solid #60a5fa;
      padding-bottom: 8pt;
    }
    
    .main-header h1 {
      font-size: 18pt;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 3pt;
      letter-spacing: 0.3pt;
    }
    
    .main-header .position {
      font-size: 11pt;
      color: #64748b;
      font-weight: 500;
      margin-bottom: 6pt;
    }
    
    .info-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6pt;
      margin-top: 6pt;
    }
    
    .badge {
      display: inline-block;
      padding: 3pt 8pt;
      border-radius: 3pt;
      font-size: 7.5pt;
      font-weight: 600;
      background: #eff6ff;
      color: #1e40af;
      border: 1pt solid #bfdbfe;
    }
    
    /* Section Titles in Main Content */
    .section {
      margin-bottom: 12pt;
    }
    
    .section-title {
      font-size: 11pt;
      font-weight: 700;
      color: #1e293b;
      text-transform: uppercase;
      letter-spacing: 0.5pt;
      margin-bottom: 8pt;
      padding-bottom: 4pt;
      border-bottom: 1.5pt solid #e2e8f0;
    }
    
    .section-content {
      font-size: 9pt;
      color: #475569;
      line-height: 1.5;
    }
    
    /* Experience/Education Entry */
    .entry {
      margin-bottom: 10pt;
      padding-bottom: 10pt;
      border-bottom: 1pt solid #e2e8f0;
    }
    
    .entry:last-child {
      border-bottom: none;
      padding-bottom: 0;
      margin-bottom: 0;
    }
    
    .entry-title {
      font-size: 10pt;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 2pt;
    }

    .entry-meta {
      font-size: 8pt;
      color: #64748b;
      margin-bottom: 4pt;
    }

    .bullet-list {
      margin-top: 4pt;
      padding-left: 14pt;
    }

    .bullet-list li {
      margin-bottom: 3pt;
      font-size: 8.5pt;
      color: #475569;
      line-height: 1.35;
    }
    
    .entry-subtitle {
      font-size: 8.5pt;
      color: #64748b;
      font-style: italic;
      margin-bottom: 4pt;
    }
    
    .entry-description {
      font-size: 8.5pt;
      color: #475569;
      line-height: 1.4;
    }
    
    /* Stats Grid - Horizontal Badges */
    .stats-inline {
      display: flex;
      gap: 8pt;
      margin-bottom: 10pt;
      flex-wrap: wrap;
    }
    
    .stat-badge {
      padding: 5pt 10pt;
      border-radius: 4pt;
      background: #eff6ff;
      border: 1pt solid #bfdbfe;
    }
    
    .stat-label {
      font-size: 7pt;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.3pt;
      margin-bottom: 2pt;
    }
    
    .stat-value {
      font-size: 11pt;
      font-weight: 700;
      color: #1e40af;
    }
    
    /* Footer - Contact Protection */
    .cv-footer {
      background: #f1f5f9;
      border-top: 2pt solid #cbd5e1;
      padding: 8pt 15mm;
      font-size: 7pt;
      color: #64748b;
      text-align: center;
    }
    
    .cv-footer strong {
      color: #1e293b;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="container">
      <div class="sidebar">
        ${candidate.profile_photo_signed_url ? `<img src="${candidate.profile_photo_signed_url}" alt="Profile" class="profile-photo">` : ''}

        <div class="sidebar-section">
          <h3>Contact</h3>
          <p style="font-size: 7.5pt; color: #94a3b8; font-style: italic; margin-bottom: 4pt;">
            Contact via Recruitment Agency
          </p>
          <p>support@falishajobs.com</p>
          <p>+923303333335</p>
        </div>

        <div class="sidebar-section">
          <h3>Details</h3>
          <p><strong style="color: #94a3b8;">Target Role:</strong><br>${escapeCvHtml(enriched.targetRole)}</p>
          ${candidate.nationality ? `<p style="margin-top: 4pt;"><strong style="color: #94a3b8;">Nationality:</strong><br>${escapeCvHtml(candidate.nationality)}</p>` : ''}
          ${isMeaningfulCvText(candidate.country_of_interest) ? `<p style="margin-top: 4pt;"><strong style="color: #94a3b8;">Preferred Market:</strong><br>${escapeCvHtml(candidate.country_of_interest)}</p>` : ''}
          ${(candidate.experience_years || enriched.experience.length > 0) ? `<p style="margin-top: 4pt;"><strong style="color: #94a3b8;">Experience:</strong><br>${candidate.experience_years ? `${escapeCvHtml(candidate.experience_years)} Years` : 'Relevant Experience'}</p>` : ''}
          ${candidate.ai_score ? `<p style="margin-top: 4pt;"><strong style="color: #94a3b8;">Match Score:</strong><br>${typeof candidate.ai_score === 'number' ? candidate.ai_score.toFixed(1) : escapeCvHtml(candidate.ai_score)}/10</p>` : ''}
        </div>

        ${enriched.skillBuckets.length > 0 ? `
        <div class="sidebar-section">
          <h3>Skills</h3>
          ${enriched.skillBuckets.map((bucket: SkillBucket) => `
            <div style="margin-bottom: 8pt;">
              <p style="font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.4pt; color: #93c5fd; margin-bottom: 3pt;">${escapeCvHtml(bucket.title)}</p>
              <ul>
                ${bucket.items.map((skill: string) => `<li>${escapeCvHtml(skill)}</li>`).join('')}
              </ul>
            </div>
          `).join('')}
        </div>
        ` : ''}

        ${enriched.languages.length > 0 ? `
        <div class="sidebar-section">
          <h3>Languages</h3>
          <ul>
            ${enriched.languages.map((lang: string) => `<li>${escapeCvHtml(lang)}</li>`).join('')}
          </ul>
        </div>
        ` : ''}
      </div>

      <div class="main-content">
        <div class="main-header">
          <h1>${escapeCvHtml(candidate.name || 'Candidate')}</h1>
          <p class="position">${escapeCvHtml(enriched.targetRole)}</p>
        </div>

        <div class="section">
          <h2 class="section-title">Professional Summary</h2>
          <div class="section-content">
            <p>${escapeCvHtml(enriched.summary)}</p>
          </div>
        </div>

        ${experienceHtml}
        ${educationHtml}
        ${licensesHtml}
        ${certificationsHtml}
      </div>
    </div>

    <div class="cv-footer">
      <p><strong>Privacy Protected:</strong> This employer-safe CV generated by Falisha Manpower. Contact details secured. | Reference: ${escapeCvHtml(candidate.candidate_code || 'Pending code')}</p>
      <p style="margin-top: 4pt;">To connect with this candidate, contact Falisha Manpower: support@falishajobs.com | +923303333335</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate PDF from HTML using Puppeteer
 */
async function generatePDFFromHTML(html: string): Promise<Buffer> {
  try {
    // Use system Chromium if available (for Railway/production)
    // Otherwise fall back to bundled Chromium (for local dev)
    let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

    console.log(`[CVGenerator] Puppeteer launch config:`, {
      executablePath: executablePath || 'bundled',
      platform: process.platform,
      env_skip: process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD,
    });

    // Try to find system Chromium if not explicitly set
    if (!executablePath && process.platform === 'linux') {
      // Common paths for Chromium in Linux containers
      executablePath = '/usr/bin/chromium';
      console.log(`[CVGenerator] Using default Linux Chromium path: ${executablePath}`);
    }

    const launchOptions: any = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
      ],
    };

    // Only set executablePath if we have one (let Puppeteer use bundled Chromium otherwise)
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    console.log(`[CVGenerator] Launching Puppeteer with options:`, JSON.stringify(launchOptions, null, 2));
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch(launchOptions);
    console.log(`[CVGenerator] Puppeteer launched successfully`);

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '0mm',
          right: '0mm',
          bottom: '0mm',
          left: '0mm',
        },
        preferCSSPageSize: true,
      });

      console.log(`[CVGenerator] PDF generated, size: ${pdfBuffer.length} bytes`);
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  } catch (error: any) {
    console.error(`[CVGenerator] Puppeteer error:`, {
      message: error.message,
      stack: error.stack,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    });
    throw new Error(`Failed to generate PDF: ${error.message}`);
  }
}

/**
 * Upload PDF to Supabase Storage
 */
async function uploadPDFToStorage(
  storagePath: string,
  pdfBuffer: Buffer
): Promise<void> {
  const db = supabaseAdminClient();

  const { error } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload PDF to storage: ${error.message}`);
  }
}

/**
 * Save CV metadata to database
 */
async function saveCVMetadata(
  candidateId: string,
  format: string,
  storagePath: string,
  versionHash: string,
  fileSize: number,
  userId?: string
): Promise<void> {
  const db = supabaseAdminClient();

  const fileName = storagePath.split('/').pop() || 'cv.pdf';
  const sha256 = crypto.createHash('sha256').update(versionHash).digest('hex').substring(0, 64);

  // Validate userId is a valid UUID, otherwise set to null
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validUserId = userId && uuidRegex.test(userId) ? userId : null;

  const { error } = await db
    .from('generated_cvs')
    .upsert({
      candidate_id: candidateId,
      format,
      storage_path: storagePath,
      file_name: fileName,
      file_size: fileSize,
      version_hash: versionHash,
      sha256,
      generated_by: validUserId,
      storage_bucket: STORAGE_BUCKET,
    }, {
      onConflict: 'candidate_id,format,version_hash',
    });

  if (error) {
    throw new Error(`Failed to save CV metadata: ${error.message}`);
  }
}

/**
 * Generate a single CV for a candidate
 */
export async function generateCV(options: CVGenerationOptions): Promise<CVGenerationResponse> {
  const startTime = Date.now();

  try {
    console.log(`[CVGenerator] Starting CV generation for candidate ${options.candidateId}, format: ${options.format}`);

    // 1. Check cache
    if (!options.forceRegenerate) {
      console.log(`[CVGenerator] Checking cache...`);
      const cached = await checkCache(options);
      if (cached.exists && cached.signed_url) {
        console.log(`[CVGenerator] Cache hit for candidate ${options.candidateId}, format: ${options.format}`);
        return {
          cv_url: cached.signed_url,
          cached: true,
          version_hash: cached.version_hash || '',
        };
      }
      console.log(`[CVGenerator] Cache miss, proceeding with generation`);
    }

    console.log(`[CVGenerator] Generating new CV for candidate ${options.candidateId}, format: ${options.format}`);

    // 2. Fetch candidate data
    console.log(`[CVGenerator] Step 2/9: Fetching candidate data...`);
    const candidate = await getCandidateById(options.candidateId, options.userId || 'system');
    console.log(`[CVGenerator] Candidate data fetched: ${candidate.name}`);

    // 3. Fetch candidate documents (for future use - currently not displayed in employer-safe CV)
    console.log(`[CVGenerator] Step 3/9: Fetching candidate documents...`);
    const documents = await listCandidateDocumentsByCandidate(options.candidateId);
    console.log(`[CVGenerator] Documents fetched: ${documents.length} documents`);

    // 4. Calculate version hash
    console.log(`[CVGenerator] Step 4/9: Calculating version hash...`);
    const versionHash = await calculateCandidateVersionHash(options.candidateId, options.format);
    console.log(`[CVGenerator] Version hash: ${versionHash}`);

    // 4b. Generate signed URL for profile photo if it exists
    console.log(`[CVGenerator] Step 4b/9: Generating profile photo signed URL...`);
    const profilePhotoSignedUrl = await generateProfilePhotoSignedUrl(candidate);
    if (profilePhotoSignedUrl) {
      candidate.profile_photo_signed_url = profilePhotoSignedUrl;
      console.log(`[CVGenerator] Profile photo signed URL generated`);
    }

    // 5. Generate HTML based on format
    console.log(`[CVGenerator] Step 5/9: Generating HTML template...`);
    let html: string;
    if (options.format === 'employer-safe') {
      const parsedCv = await fetchLatestParsedCVFromParsingJobs(documents);
      html = generateEmployerSafeCVHTML(candidate, documents, parsedCv);
    } else {
      // For internal/standard format, include contact info (to be implemented)
      html = generateEmployerSafeCVHTML(candidate, documents); // Placeholder
    }
    console.log(`[CVGenerator] HTML generated, length: ${html.length} chars`);

    // 6. Generate PDF
    console.log(`[CVGenerator] Step 6/9: Generating PDF from HTML...`);
    const pdfBuffer = await generatePDFFromHTML(html);
    const fileSize = pdfBuffer.length;
    console.log(`[CVGenerator] PDF generated, size: ${fileSize} bytes`);

    // 7. Upload to storage
    console.log(`[CVGenerator] Step 7/9: Uploading PDF to storage...`);
    const storagePath = `cvs/${options.candidateId}/${options.format}_${versionHash}.pdf`;
    await uploadPDFToStorage(storagePath, pdfBuffer);
    console.log(`[CVGenerator] PDF uploaded to: ${storagePath}`);

    // 8. Save metadata
    console.log(`[CVGenerator] Step 8/9: Saving CV metadata...`);
    await saveCVMetadata(
      options.candidateId,
      options.format,
      storagePath,
      versionHash,
      fileSize,
      options.userId
    );
    console.log(`[CVGenerator] Metadata saved`);

    // 9. Generate signed URL
    console.log(`[CVGenerator] Step 9/9: Generating signed URL...`);
    const db = supabaseAdminClient();
    const { data: signedUrlData, error: urlError } = await db.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, 7 * 24 * 60 * 60); // 7 days

    if (urlError || !signedUrlData) {
      throw new Error(`Failed to generate signed URL: ${urlError?.message}`);
    }
    console.log(`[CVGenerator] Signed URL generated successfully`);

    const generationTime = Date.now() - startTime;
    console.log(`[CVGenerator] CV generated successfully in ${generationTime}ms, size: ${fileSize} bytes`);

    return {
      cv_url: signedUrlData.signedUrl,
      cached: false,
      version_hash: versionHash,
      file_size: fileSize,
    };
  } catch (error: any) {
    console.error(`[CVGenerator] Failed to generate CV for ${options.candidateId}:`, {
      message: error.message,
      stack: error.stack,
      candidateId: options.candidateId,
      format: options.format,
    });
    throw error;
  }
}

/**
 * Generate CVs for multiple candidates
 */
export async function generateBulkCVs(request: BulkCVRequest, userId: string): Promise<CVGenerationResult[]> {
  const results: CVGenerationResult[] = [];

  for (const candidateId of request.candidate_ids) {
    try {
      const candidate = await getCandidateById(candidateId, userId);
      const format = request.format || 'employer-safe';

      const result = await generateCV({
        candidateId,
        format: format as 'employer-safe' | 'internal' | 'standard',
        template: (request.template as any) || 'professional',
        userId,
      });

      results.push({
        candidate_id: candidateId,
        candidate_name: candidate.name,
        success: true,
        cv_url: result.cv_url,
      });
    } catch (error: any) {
      results.push({
        candidate_id: candidateId,
        candidate_name: 'Unknown',
        success: false,
        error: error.message || 'Failed to generate CV',
      });
    }
  }

  return results;
}

/**
 * Generate a single CV for a candidate (legacy function for backward compatibility)
 */
export async function generateSingleCV(
  candidateId: string,
  format: 'standard' | 'employer-safe',
  userId: string
): Promise<{ cv_url: string }> {
  const result = await generateCV({
    candidateId,
    format: format as 'employer-safe' | 'internal' | 'standard',
    userId,
  });

  return {
    cv_url: result.cv_url,
  };
}
