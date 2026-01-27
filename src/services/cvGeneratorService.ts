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
  await db
    .from('generated_cvs')
    .update({
      access_count: db.raw('access_count + 1'),
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
  const skills = candidate.skills ? candidate.skills.split(',').map((s: string) => s.trim()) : [];
  const languages = candidate.languages ? candidate.languages.split(',').map((l: string) => l.trim()) : [];
  
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
      background: #ffffff;
      padding: 40px;
    }
    .container { max-width: 800px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      color: white;
      padding: 40px;
      border-radius: 12px;
      margin-bottom: 30px;
      text-align: center;
    }
    .header h1 { font-size: 32px; margin-bottom: 10px; font-weight: 700; }
    .header .position { font-size: 18px; opacity: 0.95; }
    .section {
      margin-bottom: 30px;
      padding: 25px;
      background: #f9fafb;
      border-radius: 8px;
      border-left: 4px solid #3b82f6;
    }
    .section h2 {
      font-size: 20px;
      color: #1f2937;
      margin-bottom: 15px;
      font-weight: 600;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      margin-bottom: 20px;
    }
    .info-item {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .info-label { font-weight: 600; color: #6b7280; }
    .info-value { color: #1f2937; }
    .skills-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 10px;
    }
    .skill-badge {
      background: #dbeafe;
      color: #1e40af;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
    }
    .notice {
      background: #fef3c7;
      border: 2px solid #f59e0b;
      padding: 15px;
      border-radius: 8px;
      margin-top: 20px;
      text-align: center;
    }
    .notice strong { color: #92400e; }
    @media print {
      body { padding: 20px; }
      .section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${candidate.name || 'Candidate'}</h1>
      <div class="position">${candidate.position || 'Professional'}</div>
    </div>
    
    <div class="section">
      <h2>Professional Overview</h2>
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Nationality:</span>
          <span class="info-value">${candidate.nationality || 'Not specified'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Experience:</span>
          <span class="info-value">${candidate.experience_years ? `${candidate.experience_years} years` : 'Not specified'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Country of Interest:</span>
          <span class="info-value">${candidate.country_of_interest || 'Not specified'}</span>
        </div>
        ${candidate.ai_score ? `
        <div class="info-item">
          <span class="info-label">AI Match Score:</span>
          <span class="info-value">${candidate.ai_score}%</span>
        </div>
        ` : ''}
      </div>
    </div>
    
    ${candidate.professional_summary ? `
    <div class="section">
      <h2>Professional Summary</h2>
      <p>${candidate.professional_summary}</p>
    </div>
    ` : ''}
    
    ${skills.length > 0 ? `
    <div class="section">
      <h2>Skills & Competencies</h2>
      <div class="skills-grid">
        ${skills.map((skill: string) => `<span class="skill-badge">${skill}</span>`).join('')}
      </div>
    </div>
    ` : ''}
    
    ${languages.length > 0 ? `
    <div class="section">
      <h2>Languages</h2>
      <p>${languages.join(', ')}</p>
    </div>
    ` : ''}
    
    ${candidate.previous_employment ? `
    <div class="section">
      <h2>Previous Employment</h2>
      <p>${candidate.previous_employment}</p>
    </div>
    ` : ''}
    
    ${candidate.education ? `
    <div class="section">
      <h2>Education</h2>
      <p>${candidate.education}</p>
    </div>
    ` : ''}
    
    ${candidate.certifications ? `
    <div class="section">
      <h2>Certifications</h2>
      <p>${candidate.certifications}</p>
    </div>
    ` : ''}
    
    <div class="notice">
      <strong>🔒 Privacy Protected</strong><br>
      This is an employer-safe CV generated by Falisha Manpower recruitment system.<br>
      Contact information has been secured for candidate privacy.<br>
      For candidate details, please contact Falisha Manpower.
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
  // Use system Chromium if available (for Railway/production)
  // Otherwise fall back to bundled Chromium (for local dev)
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  
  // Try to find system Chromium if not explicitly set
  if (!executablePath && process.platform === 'linux') {
    // Common paths for Chromium in Linux containers
    const possiblePaths = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/nix/store/*chromium*/bin/chromium',
    ];
    
    // Use first available path (simplified - in production, Railway will set PUPPETEER_EXECUTABLE_PATH)
    executablePath = '/usr/bin/chromium';
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
  
  const browser = await puppeteer.launch(launchOptions);
  
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
    
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
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
      generated_by: userId || null,
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
    // 1. Check cache
    if (!options.forceRegenerate) {
      const cached = await checkCache(options);
      if (cached.exists && cached.signed_url) {
        console.log(`[CVGenerator] Cache hit for candidate ${options.candidateId}, format: ${options.format}`);
        return {
          cv_url: cached.signed_url,
          cached: true,
          version_hash: cached.version_hash || '',
        };
      }
    }
    
    console.log(`[CVGenerator] Generating new CV for candidate ${options.candidateId}, format: ${options.format}`);
    
    // 2. Fetch candidate data
    const candidate = await getCandidateById(options.candidateId, options.userId || 'system');
    
    // 3. Fetch candidate documents (for future use - currently not displayed in employer-safe CV)
    const documents = await listCandidateDocumentsByCandidate(options.candidateId);
    
    // 4. Calculate version hash
    const versionHash = await calculateCandidateVersionHash(options.candidateId);
    
    // 5. Generate HTML based on format
    let html: string;
    if (options.format === 'employer-safe') {
      html = generateEmployerSafeCVHTML(candidate, documents);
    } else {
      // For internal/standard format, include contact info (to be implemented)
      html = generateEmployerSafeCVHTML(candidate, documents); // Placeholder
    }
    
    // 6. Generate PDF
    const pdfBuffer = await generatePDFFromHTML(html);
    const fileSize = pdfBuffer.length;
    
    // 7. Upload to storage
    const storagePath = `cvs/${options.candidateId}/${options.format}_${versionHash}.pdf`;
    await uploadPDFToStorage(storagePath, pdfBuffer);
    
    // 8. Save metadata
    await saveCVMetadata(
      options.candidateId,
      options.format,
      storagePath,
      versionHash,
      fileSize,
      options.userId
    );
    
    // 9. Generate signed URL
    const db = supabaseAdminClient();
    const { data: signedUrlData, error: urlError } = await db.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, 7 * 24 * 60 * 60); // 7 days
    
    if (urlError || !signedUrlData) {
      throw new Error(`Failed to generate signed URL: ${urlError?.message}`);
    }
    
    const generationTime = Date.now() - startTime;
    console.log(`[CVGenerator] CV generated successfully in ${generationTime}ms, size: ${fileSize} bytes`);
    
    return {
      cv_url: signedUrlData.signedUrl,
      cached: false,
      version_hash: versionHash,
      file_size: fileSize,
    };
  } catch (error: any) {
    console.error(`[CVGenerator] Failed to generate CV:`, error);
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
