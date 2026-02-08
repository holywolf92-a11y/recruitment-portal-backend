"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCV = generateCV;
exports.generateBulkCVs = generateBulkCVs;
exports.generateSingleCV = generateSingleCV;
const database_1 = require("../config/database");
const candidateService_1 = require("./candidateService");
const candidateDocumentService_1 = require("./candidateDocumentService");
const puppeteer_1 = __importDefault(require("puppeteer"));
const crypto_1 = __importDefault(require("crypto"));
const cvTemplateConfig_1 = require("../config/cvTemplateConfig");
const documentCategories_1 = require("../config/documentCategories");
const STORAGE_BUCKET = 'documents';
async function fetchLatestParsedCVFromParsingJobs(documents) {
    try {
        const attachmentId = documents?.find((d) => d?.category === documentCategories_1.DOCUMENT_CATEGORIES.CV_RESUME && d?.inbox_attachment_id)?.inbox_attachment_id ||
            documents?.find((d) => d?.inbox_attachment_id)?.inbox_attachment_id;
        if (!attachmentId)
            return null;
        const db = (0, database_1.supabaseAdminClient)();
        const { data, error } = await db
            .from('parsing_jobs')
            .select('output, created_at')
            .eq('inbox_attachment_id', attachmentId)
            .eq('status', 'extracted')
            .order('created_at', { ascending: false })
            .limit(1);
        if (error || !data || data.length === 0)
            return null;
        const output = data[0]?.output;
        if (!output)
            return null;
        if (typeof output === 'string') {
            try {
                return JSON.parse(output);
            }
            catch {
                return null;
            }
        }
        return output;
    }
    catch {
        return null;
    }
}
/**
 * Calculate SHA256 hash of candidate data for cache invalidation
 */
async function calculateCandidateVersionHash(candidateId, format) {
    const db = (0, database_1.supabaseAdminClient)();
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
                .eq('category', documentCategories_1.DOCUMENT_CATEGORIES.CV_RESUME)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            const attachmentId = cvDoc?.inbox_attachment_id;
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
                    const output = job.output;
                    const outputString = typeof output === 'string' ? output : JSON.stringify(output ?? '');
                    parsingOutputHash = crypto_1.default.createHash('sha256').update(outputString).digest('hex');
                }
            }
        }
    }
    catch (e) {
        // Non-fatal: cache hash falls back to candidate fields.
        parsingOutputHash = '';
    }
    const dataString = [
        (0, cvTemplateConfig_1.getTemplateVersion)(), // Include template version to bust cache when design changes
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
    return crypto_1.default.createHash('sha256').update(dataString).digest('hex');
}
/**
 * Check if a cached CV exists and is still valid
 */
async function checkCache(options) {
    const db = (0, database_1.supabaseAdminClient)();
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
async function generateProfilePhotoSignedUrl(candidate) {
    try {
        // Check if we have bucket and path
        let bucket = candidate.profile_photo_bucket;
        let storagePath = candidate.profile_photo_path;
        // If not, try to derive from URL
        if ((!bucket || !storagePath) && candidate.profile_photo_url) {
            const url = candidate.profile_photo_url;
            const publicMarker = '/storage/v1/object/public/';
            const signMarker = '/storage/v1/object/sign/';
            if (url.includes(publicMarker)) {
                const rest = url.substring(url.indexOf(publicMarker) + publicMarker.length);
                const parts = rest.split('/');
                bucket = parts.shift() || 'documents';
                storagePath = parts.join('/');
            }
            else if (url.includes(signMarker)) {
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
        const db = (0, database_1.supabaseAdminClient)();
        const { data: signedData, error } = await db.storage
            .from(bucket)
            .createSignedUrl(storagePath, 31536000); // 1 year (permanent)
        if (error || !signedData?.signedUrl) {
            console.warn(`[CVGenerator] Failed to generate signed URL for profile photo: ${error?.message}`);
            return null;
        }
        console.log('[CVGenerator] Generated signed URL for profile photo');
        return signedData.signedUrl;
    }
    catch (err) {
        console.warn(`[CVGenerator] Error generating profile photo signed URL: ${err.message}`);
        return null;
    }
}
/**
 * Generate HTML template for employer-safe CV
 */
function generateEmployerSafeCVHTML(candidate, documents, parsedCv) {
    const isMeaningfulText = (value) => {
        if (typeof value !== 'string')
            return false;
        const trimmed = value.trim();
        if (!trimmed)
            return false;
        const lower = trimmed.toLowerCase();
        return !['missing', 'null', 'undefined', 'n/a', 'na', 'none', 'not provided'].includes(lower);
    };
    const escapeHtml = (value) => {
        if (value === null || value === undefined)
            return '';
        const str = typeof value === 'string' ? value : String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };
    const asArray = (value) => (Array.isArray(value) ? value : []);
    const formatDateRange = (start, end) => {
        const s = (start || '').toString().trim();
        const e = (end || '').toString().trim();
        if (!s && !e)
            return '';
        if (s && !e)
            return `${s} - Present`;
        if (!s && e)
            return e;
        return `${s} - ${e}`;
    };
    // Prefer structured output from parser when present
    const parsedSkills = asArray(parsedCv?.skills);
    const parsedLanguages = asArray(parsedCv?.languages);
    // Parse skills - handle JSON array or comma-separated string
    let skills = [];
    if (parsedSkills.length > 0) {
        skills = parsedSkills;
    }
    else if (candidate.skills) {
        try {
            const parsed = JSON.parse(candidate.skills);
            if (Array.isArray(parsed)) {
                skills = parsed;
            }
            else {
                skills = candidate.skills.split(',').map((s) => s.trim());
            }
        }
        catch {
            skills = candidate.skills.split(',').map((s) => s.trim());
        }
    }
    const languages = parsedLanguages.length > 0
        ? parsedLanguages
        : (candidate.languages ? candidate.languages.split(',').map((l) => l.trim()) : []);
    const initial = (candidate.name || '?').charAt(0).toUpperCase();
    const professionalSummary = isMeaningfulText(parsedCv?.professional_summary)
        ? String(parsedCv.professional_summary).trim()
        : (isMeaningfulText(candidate.professional_summary) ? candidate.professional_summary.trim() : '');
    const previousEmployment = isMeaningfulText(candidate.previous_employment) ? candidate.previous_employment.trim() : '';
    const parsedExperience = asArray(parsedCv?.experience);
    const experienceHtml = parsedExperience.length > 0
        ? `
      <div class="section">
        <h2 class="section-title">Work Experience</h2>
        ${parsedExperience.map((role) => {
            const title = role?.job_title || role?.title || role?.position || '';
            const company = role?.company || role?.employer || role?.organization || '';
            const location = role?.location || role?.city || role?.country || '';
            const dates = formatDateRange(role?.start_date || role?.from || role?.start, role?.end_date || role?.to || role?.end);
            const bullets = asArray(role?.responsibilities || role?.achievements || role?.duties || role?.highlights);
            const description = role?.description || role?.summary || '';
            return `
          <div class="entry">
            <div class="entry-title">${escapeHtml([title, company].filter(Boolean).join(' - '))}</div>
            ${(location || dates) ? `<div class="entry-meta">${escapeHtml([location, dates].filter(Boolean).join(' | '))}</div>` : ''}
            ${bullets.length > 0
                ? `<ul style="margin-top: 4pt; padding-left: 14pt;">${bullets.slice(0, 10).map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
                : (isMeaningfulText(description)
                    ? `<div class="entry-description" style="white-space: pre-line;">${escapeHtml(description)}</div>`
                    : '')}
          </div>`;
        }).join('')}
      </div>
    `
        : (previousEmployment ? `
      <div class="section">
        <h2 class="section-title">Work Experience</h2>
        <div class="entry">
          <div class="entry-description" style="white-space: pre-line;">${previousEmployment}</div>
        </div>
      </div>
    ` : '');
    const parsedEducation = asArray(parsedCv?.education);
    const educationHtml = parsedEducation.length > 0
        ? `
      <div class="section">
        <h2 class="section-title">Education</h2>
        ${parsedEducation.map((ed) => {
            const degree = ed?.degree || ed?.qualification || ed?.title || '';
            const institution = ed?.institution || ed?.university || ed?.school || '';
            const location = ed?.location || ed?.city || ed?.country || '';
            const dates = formatDateRange(ed?.start_year || ed?.start_date || ed?.from, ed?.end_year || ed?.end_date || ed?.to);
            const thesis = ed?.thesis || '';
            return `
          <div class="entry">
            <div class="entry-title">${escapeHtml([degree, institution].filter(Boolean).join(' - '))}</div>
            ${(location || dates) ? `<div class="entry-meta">${escapeHtml([location, dates].filter(Boolean).join(' | '))}</div>` : ''}
            ${isMeaningfulText(thesis) ? `<div class="entry-description" style="white-space: pre-line;">Thesis: ${escapeHtml(thesis)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    `
        : (candidate.education ? `
      <div class="section">
        <h2 class="section-title">Education</h2>
        <div class="entry">
          <div class="entry-description" style="white-space: pre-line;">${candidate.education}</div>
        </div>
      </div>
    ` : '');
    const parsedCerts = asArray(parsedCv?.certifications || parsedCv?.certificates);
    const certificationsHtml = parsedCerts.length > 0
        ? `
      <div class="section">
        <h2 class="section-title">Certifications</h2>
        <div class="entry">
          <ul style="padding-left: 14pt;">
            ${parsedCerts.slice(0, 20).map((c) => {
            const name = c?.name || c?.title || c;
            const issuer = c?.issuer || c?.authority || '';
            const date = c?.date || c?.year || '';
            const parts = [name, issuer, date].filter(Boolean);
            return `<li>${escapeHtml(parts.join(' - '))}</li>`;
        }).join('')}
          </ul>
        </div>
      </div>
    `
        : (candidate.certifications ? `
      <div class="section">
        <h2 class="section-title">Certifications</h2>
        <div class="entry">
          <div class="entry-description" style="white-space: pre-line;">${candidate.certifications}</div>
        </div>
      </div>
    ` : '');
    const parsedLicenses = asArray(parsedCv?.licenses);
    const licensesHtml = parsedLicenses.length > 0
        ? `
      <div class="section">
        <h2 class="section-title">Licenses</h2>
        ${parsedLicenses.slice(0, 20).map((lic) => {
            const name = lic?.name || lic?.title || '';
            const authority = lic?.authority || '';
            const reg = lic?.registration_no || lic?.registration_number || '';
            const country = lic?.country || '';
            const expiry = lic?.expiry_date || lic?.expiry || '';
            const notes = lic?.notes || '';
            const meta = [authority, country, reg ? `Reg#: ${reg}` : '', expiry ? `Expiry: ${expiry}` : ''].filter(Boolean).join(' | ');
            return `
          <div class="entry">
            <div class="entry-title">${escapeHtml(name)}</div>
            ${meta ? `<div class="entry-meta">${escapeHtml(meta)}</div>` : ''}
            ${isMeaningfulText(notes) ? `<div class="entry-description" style="white-space: pre-line;">${escapeHtml(notes)}</div>` : ''}
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
    
    .container { 
      width: 100%; 
      background: white;
      display: flex;
      min-height: 297mm;
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
      margin-top: auto;
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
  <div class="container">
    <!-- Left Sidebar - Contact & Skills -->
    <div class="sidebar">
      <!-- Profile Photo -->
      ${candidate.profile_photo_signed_url ? `<img src="${candidate.profile_photo_signed_url}" alt="Profile" class="profile-photo">` : ''}
      
      <!-- Contact Information (Protected) -->
      <div class="sidebar-section">
        <h3>Contact</h3>
        <p style="font-size: 7.5pt; color: #94a3b8; font-style: italic; margin-bottom: 4pt;">
          Contact via Recruitment Agency
        </p>
        <p>📧 falishamanpower4035@gmail.com</p>
        <p>📱 +92330 3333335</p>
      </div>
      
      <!-- Personal Details -->
      <div class="sidebar-section">
        <h3>Details</h3>
        ${candidate.nationality ? `<p><strong style="color: #94a3b8;">Nationality:</strong><br>${candidate.nationality}</p>` : ''}
        ${candidate.country_of_interest ? `<p style="margin-top: 4pt;"><strong style="color: #94a3b8;">Seeking:</strong><br>${candidate.country_of_interest}</p>` : ''}
        ${candidate.experience_years ? `<p style="margin-top: 4pt;"><strong style="color: #94a3b8;">Experience:</strong><br>${candidate.experience_years} Years</p>` : ''}
        ${candidate.ai_score ? `<p style="margin-top: 4pt;"><strong style="color: #94a3b8;">Match Score:</strong><br>${typeof candidate.ai_score === 'number' ? candidate.ai_score.toFixed(1) : candidate.ai_score}/10</p>` : ''}
      </div>
      
      <!-- Skills in Sidebar -->
      ${skills.length > 0 ? `
      <div class="sidebar-section">
        <h3>Skills</h3>
        <ul>
          ${skills.slice(0, 10).map((skill) => `<li>${skill}</li>`).join('')}
        </ul>
      </div>
      ` : ''}
      
      <!-- Languages in Sidebar -->
      ${languages.length > 0 ? `
      <div class="sidebar-section">
        <h3>Languages</h3>
        <ul>
          ${languages.map((lang) => `<li>${lang}</li>`).join('')}
        </ul>
      </div>
      ` : ''}
    </div>
    
    <!-- Main Content Area -->
    <div class="main-content">
      <!-- Header -->
      <div class="main-header">
        <h1>${candidate.name || 'Candidate'}</h1>
        <p class="position">${candidate.position || 'Professional'}</p>
      </div>
      
      <!-- Professional Summary -->
      <div class="section">
        <h2 class="section-title">Professional Summary</h2>
        <div class="section-content">
          <p>${professionalSummary || `Highly skilled ${candidate.position || 'professional'}${candidate.experience_years ? ` with ${candidate.experience_years} years of professional experience` : ''} seeking opportunities in ${candidate.country_of_interest || 'various markets'} to contribute expertise and drive excellence.`}</p>
        </div>
      </div>
      
      ${experienceHtml}
      ${educationHtml}
      ${licensesHtml}
      ${certificationsHtml}
    </div>
  </div>
  
  <!-- Footer -->
  <div class="cv-footer">
    <p><strong>Privacy Protected:</strong> This employer-safe CV generated by Falisha Manpower. Contact details secured. | ID: ${candidate.id}</p>
  </div>
    
    <!-- Footer - Contact Protection -->
    <div class="cv-footer">
      <h3>Contact Information Protected</h3>
      <p>For privacy and security, direct contact details have been removed from this CV. To connect with this candidate, please contact Falisha Manpower recruitment team.</p>
      <p><strong>Contact via Agency:</strong> falishamanpower4035@gmail.com | +92330 3333335</p>
      <p style="margin-top: 4pt; font-size: 6.5pt; color: #9ca3af;">Falisha Manpower AI Recruitment System | Candidate ID: ${candidate.id}</p>
    </div>
  </div>
</body>
</html>
  `;
}
/**
 * Generate PDF from HTML using Puppeteer
 */
async function generatePDFFromHTML(html) {
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
        const launchOptions = {
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
        const browser = await puppeteer_1.default.launch(launchOptions);
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
        }
        finally {
            await browser.close();
        }
    }
    catch (error) {
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
async function uploadPDFToStorage(storagePath, pdfBuffer) {
    const db = (0, database_1.supabaseAdminClient)();
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
async function saveCVMetadata(candidateId, format, storagePath, versionHash, fileSize, userId) {
    const db = (0, database_1.supabaseAdminClient)();
    const fileName = storagePath.split('/').pop() || 'cv.pdf';
    const sha256 = crypto_1.default.createHash('sha256').update(versionHash).digest('hex').substring(0, 64);
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
async function generateCV(options) {
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
        const candidate = await (0, candidateService_1.getCandidateById)(options.candidateId, options.userId || 'system');
        console.log(`[CVGenerator] Candidate data fetched: ${candidate.name}`);
        // 3. Fetch candidate documents (for future use - currently not displayed in employer-safe CV)
        console.log(`[CVGenerator] Step 3/9: Fetching candidate documents...`);
        const documents = await (0, candidateDocumentService_1.listCandidateDocumentsByCandidate)(options.candidateId);
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
        let html;
        if (options.format === 'employer-safe') {
            const parsedCv = await fetchLatestParsedCVFromParsingJobs(documents);
            html = generateEmployerSafeCVHTML(candidate, documents, parsedCv);
        }
        else {
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
        await saveCVMetadata(options.candidateId, options.format, storagePath, versionHash, fileSize, options.userId);
        console.log(`[CVGenerator] Metadata saved`);
        // 9. Generate signed URL
        console.log(`[CVGenerator] Step 9/9: Generating signed URL...`);
        const db = (0, database_1.supabaseAdminClient)();
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
    }
    catch (error) {
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
async function generateBulkCVs(request, userId) {
    const results = [];
    for (const candidateId of request.candidate_ids) {
        try {
            const candidate = await (0, candidateService_1.getCandidateById)(candidateId, userId);
            const format = request.format || 'employer-safe';
            const result = await generateCV({
                candidateId,
                format: format,
                template: request.template || 'professional',
                userId,
            });
            results.push({
                candidate_id: candidateId,
                candidate_name: candidate.name,
                success: true,
                cv_url: result.cv_url,
            });
        }
        catch (error) {
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
async function generateSingleCV(candidateId, format, userId) {
    const result = await generateCV({
        candidateId,
        format: format,
        userId,
    });
    return {
        cv_url: result.cv_url,
    };
}
