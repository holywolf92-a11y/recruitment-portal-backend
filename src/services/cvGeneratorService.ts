import { supabaseAdminClient } from '../config/database';
import { getCandidateById } from './candidateService';
import { listCandidateDocumentsByCandidate } from './candidateDocumentService';
import puppeteer from 'puppeteer';
import crypto from 'crypto';

const STORAGE_BUCKET = 'documents';

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
async function calculateCandidateVersionHash(candidateId: string): Promise<string> {
  const db = supabaseAdminClient();
  
  const { data: candidate, error } = await db
    .from('candidates')
    .select('name, position, nationality, experience_years, skills, languages, education, certifications, previous_employment, professional_summary, country_of_interest, updated_at')
    .eq('id', candidateId)
    .single();
  
  if (error || !candidate) {
    throw new Error(`Candidate not found: ${candidateId}`);
  }
  
  const dataString = [
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
  const currentVersionHash = await calculateCandidateVersionHash(options.candidateId);
  
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
 * Generate HTML template for employer-safe CV
 */
function generateEmployerSafeCVHTML(candidate: any, documents: any[]): string {
  // Parse skills - handle JSON array or comma-separated string
  let skills: string[] = [];
  if (candidate.skills) {
    try {
      const parsed = JSON.parse(candidate.skills);
      if (Array.isArray(parsed)) {
        skills = parsed;
      } else {
        skills = candidate.skills.split(',').map((s: string) => s.trim());
      }
    } catch {
      skills = candidate.skills.split(',').map((s: string) => s.trim());
    }
  }
  
  const languages = candidate.languages ? candidate.languages.split(',').map((l: string) => l.trim()) : [];
  const initial = (candidate.name || '?').charAt(0).toUpperCase();
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Employer-Safe CV - ${candidate.name || 'Candidate'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background: linear-gradient(135deg, #EFF6FF 0%, #F3E8FF 50%, #FCE7F3 100%);
      padding: 40px 20px;
    }
    .container { max-width: 900px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.15); }
    
    /* Colorful Header with Avatar */
    .cv-header {
      text-align: center;
      padding: 50px 40px;
      border-bottom: 4px solid #2563eb;
    }
    .avatar {
      width: 140px;
      height: 140px;
      margin: 0 auto 20px;
      background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 60px;
      font-weight: bold;
      box-shadow: 0 10px 30px rgba(59, 130, 246, 0.4);
      position: relative;
    }
    .avatar::after {
      content: '✓';
      position: absolute;
      bottom: 0;
      right: 0;
      width: 44px;
      height: 44px;
      background: #10b981;
      border-radius: 50%;
      border: 5px solid white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      color: white;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
    }
    .cv-header h1 {
      font-size: 42px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 8px;
    }
    .cv-header .position {
      font-size: 22px;
      color: #6b7280;
      margin-bottom: 20px;
    }
    
    /* Info Badges */
    .info-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: center;
      margin-top: 20px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 50px;
      font-size: 14px;
      font-weight: 600;
      border: 2px solid;
    }
    .badge-blue { background: #dbeafe; color: #1e40af; border-color: #93c5fd; }
    .badge-purple { background: #f3e8ff; color: #6b21a8; border-color: #c084fc; }
    .badge-green { background: #d1fae5; color: #065f46; border-color: #6ee7b7; }
    
    /* Content Section */
    .content {
      padding: 40px;
    }
    
    /* Contact Protection Notice */
    .protection-notice {
      background: #fef3c7;
      border: 2px solid #fbbf24;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .protection-notice h3 {
      font-size: 18px;
      font-weight: 700;
      color: #92400e;
      margin-bottom: 8px;
    }
    .protection-notice p {
      font-size: 14px;
      color: #78350f;
      margin-bottom: 12px;
    }
    .protection-contact {
      background: white;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid #fbbf24;
    }
    .protection-contact p {
      font-size: 13px;
      color: #374151;
      margin: 4px 0;
    }
    .protection-contact strong {
      color: #111827;
    }
    
    /* Section Title */
    .section-title {
      font-size: 24px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 3px solid #2563eb;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    /* Stats Cards */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-bottom: 30px;
    }
    .stat-card {
      padding: 20px;
      border-radius: 12px;
      border: 2px solid;
    }
    .stat-card-blue { background: #eff6ff; border-color: #93c5fd; }
    .stat-card-purple { background: #f5f3ff; border-color: #c4b5fd; }
    .stat-card .label {
      font-size: 14px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 8px;
    }
    .stat-card .value {
      font-size: 32px;
      font-weight: 700;
    }
    .stat-card-blue .value { color: #1e40af; }
    .stat-card-purple .value { color: #6b21a8; }
    
    /* Content Box */
    .content-box {
      background: #f9fafb;
      border-left: 4px solid #3b82f6;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    .content-box p {
      font-size: 15px;
      color: #374151;
      line-height: 1.7;
    }
    
    /* Skills Grid */
    .skills-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .skill-badge {
      background: linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%);
      color: #1e40af;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      border: 2px solid #93c5fd;
    }
    
    /* Footer Notice */
    .footer-notice {
      background: linear-gradient(135deg, #eff6ff 0%, #f5f3ff 100%);
      border: 2px solid #93c5fd;
      border-radius: 12px;
      padding: 20px;
      margin-top: 30px;
      text-align: center;
    }
    .footer-notice h3 {
      font-size: 16px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 8px;
    }
    .footer-notice p {
      font-size: 13px;
      color: #4b5563;
      margin: 4px 0;
    }
    .footer-notice strong {
      color: #1e40af;
    }
    
    @media print {
      body { padding: 0; background: white; }
      .container { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Colorful Header -->
    <div class="cv-header">
      <div class="avatar">${initial}</div>
      <h1>${candidate.name || 'Candidate'}</h1>
      <p class="position">${candidate.position || 'Professional'}</p>
      
      <!-- Info Badges -->
      <div class="info-badges">
        ${candidate.nationality ? `<span class="badge badge-blue">🌍 ${candidate.nationality}</span>` : ''}
        ${candidate.country_of_interest ? `<span class="badge badge-purple">📍 Seeking: ${candidate.country_of_interest}</span>` : ''}
        ${candidate.experience_years ? `<span class="badge badge-green">📅 ${candidate.experience_years} Years Experience</span>` : ''}
      </div>
    </div>
    
    <!-- Content -->
    <div class="content">
      <!-- Contact Protection Notice -->
      <div class="protection-notice">
        <h3>🛡️ Contact Information Protected</h3>
        <p>
          For privacy and security, direct contact details have been removed from this CV. 
          To connect with this candidate, please contact Falisha Manpower recruitment team.
        </p>
        <div class="protection-contact">
          <p><strong>📧 Contact via Recruitment Agency:</strong></p>
          <p>Email: falishamanpower4035@gmail.com</p>
          <p>Phone: +92330 3333335</p>
        </div>
      </div>
      
      <!-- Professional Summary -->
      <h2 class="section-title">💼 Professional Summary</h2>
      
      <!-- Stats Cards -->
      ${candidate.experience_years || candidate.ai_score ? `
      <div class="stats-grid">
        ${candidate.experience_years ? `
        <div class="stat-card stat-card-blue">
          <div class="label">📅 Experience</div>
          <div class="value">${candidate.experience_years} Years</div>
        </div>
        ` : ''}
        ${candidate.ai_score ? `
        <div class="stat-card stat-card-purple">
          <div class="label">⭐ AI Match Score</div>
          <div class="value">${typeof candidate.ai_score === 'number' ? candidate.ai_score.toFixed(1) : candidate.ai_score}/10</div>
        </div>
        ` : ''}
      </div>
      ` : ''}
      
      ${candidate.professional_summary ? `
      <div class="content-box">
        <p>${candidate.professional_summary}</p>
      </div>
      ` : `
      <div class="content-box">
        <p>Highly skilled ${candidate.position || 'professional'} with ${candidate.experience_years || 0} years of professional experience. 
        Seeking opportunities in ${candidate.country_of_interest || 'various markets'} to contribute expertise and drive excellence.</p>
      </div>
      `}
      
      <!-- Skills -->
      ${skills.length > 0 ? `
      <h2 class="section-title">⭐ Core Skills & Competencies</h2>
      <div class="skills-grid">
        ${skills.map((skill: string) => `<span class="skill-badge">${skill}</span>`).join('')}
      </div>
      <br><br>
      ` : ''}
      
      <!-- Work Experience -->
      ${candidate.previous_employment ? `
      <h2 class="section-title">💼 Work Experience</h2>
      <div class="content-box">
        <p style="white-space: pre-line;">${candidate.previous_employment}</p>
      </div>
      ` : ''}
      
      <!-- Education -->
      ${candidate.education ? `
      <h2 class="section-title">🎓 Education</h2>
      <div class="content-box">
        <p style="white-space: pre-line;">${candidate.education}</p>
      </div>
      ` : ''}
      
      <!-- Certifications -->
      ${candidate.certifications ? `
      <h2 class="section-title">✅ Certifications</h2>
      <div class="content-box">
        <p style="white-space: pre-line;">${candidate.certifications}</p>
      </div>
      ` : ''}
      
      <!-- Languages -->
      ${languages.length > 0 ? `
      <h2 class="section-title">🌐 Languages</h2>
      <div class="content-box">
        <p>${languages.join(', ')}</p>
      </div>
      ` : ''}
      
      <!-- Footer Notice -->
      <div class="footer-notice">
        <h3>🛡️ Protected by Falisha Manpower</h3>
        <p>This employer-safe CV protects candidate privacy. Contact information has been secured.</p>
        <p><strong>For interviews:</strong> falishamanpower4035@gmail.com | +92330 3333335</p>
        <p style="margin-top: 12px; font-size: 11px; color: #9ca3af;">Falisha Manpower AI Recruitment System | Candidate ID: ${candidate.id}</p>
      </div>
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
    const browser = await puppeteer.launch(launchOptions);
    console.log(`[CVGenerator] Puppeteer launched successfully`);
    
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm',
        },
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
    const versionHash = await calculateCandidateVersionHash(options.candidateId);
    console.log(`[CVGenerator] Version hash: ${versionHash}`);
    
    // 5. Generate HTML based on format
    console.log(`[CVGenerator] Step 5/9: Generating HTML template...`);
    let html: string;
    if (options.format === 'employer-safe') {
      html = generateEmployerSafeCVHTML(candidate, documents);
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
