/**
 * Split-and-categorize upload flow:
 * 1. Preserve original PDF in original_uploads/upload_<uuid>.pdf
 * 2. Call POST /split-and-categorize (parser, HMAC)
 * 3. Create candidate if none
 * 4. For each documents[]: decode, upload to folder by doc_type, create document record
 */

import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { supabaseAdminClient } from '../config/database';
import { createCandidate, checkForDuplicates, CreateCandidateData } from './candidateService';
import { logDocumentUploaded } from './timelineService';
import { calculateSHA256 } from './documentService';
import { generateDescriptiveFilename } from '../utils/documentNaming';
import { processSplitDocument } from '../utils/splitDocumentProcessor';
import { isGovernmentEmail } from './progressiveDataCompletionService';
import { extractProfilePhotoHybrid, uploadExtractedPhotoToCandidatePhotos } from './hybridPhotoExtractionService';
import { CandidateMatcher } from './candidateMatcher';
import { emailService } from './emailService';

const STORAGE_BUCKET = 'documents';
const ORIGINAL_PREFIX = 'original_uploads';

const PARSER_URL = process.env.PYTHON_CV_PARSER_URL || process.env.PARSER_URL || 'http://127.0.0.1:8000';
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET || '';

/**
 * Mandatory doc_type -> storage folder mapping.
 * Unknown / unmapped -> other_documents/
 * 
 * ⚠️ BUSINESS RULE: certificates folder = Professional/IT certifications ONLY
 * - Educational documents (degrees, diplomas) → educational_documents
 * - Experience letters → experience_certificates
 * - NAVTTC vocational certs → navttc_reports
 * - Police clearance → police_character_certificate
 */
export const DOC_TYPE_TO_FOLDER: Record<string, string> = {
  // Identity documents
  passport: 'passport',
  driving_license: 'driving_license',
  national_id: 'cnic',
  cnic: 'cnic',
  
  // Police clearance certificates
  police_character_certificate: 'police_character_certificate',
  police_certificate: 'police_character_certificate',
  police_clearance: 'police_character_certificate',
  character_certificate: 'police_character_certificate',
  pcc: 'police_character_certificate',
  
  // Educational documents (academic qualifications)
  educational_documents: 'educational_documents',
  educational_document: 'educational_documents',
  degree: 'educational_documents',
  diploma: 'educational_documents',
  transcript: 'educational_documents',
  marksheet: 'educational_documents',
  academic_certificate: 'educational_documents',
  university_degree: 'educational_documents',
  college_diploma: 'educational_documents',
  
  // Experience certificates (employment proof)
  experience_certificate: 'experience_certificates',
  experience_certificates: 'experience_certificates',
  employment_certificate: 'experience_certificates',
  experience_letter: 'experience_certificates',
  service_certificate: 'experience_certificates',
  employment_letter: 'experience_certificates',
  work_reference: 'experience_certificates',
  
  // NAVTTC vocational training (government technical training)
  navttc_report: 'navttc_reports',
  navttc_reports: 'navttc_reports',
  navtic_report: 'navttc_reports',
  nvtc_report: 'navttc_reports',
  navttc: 'navttc_reports',
  navttc_certificate: 'navttc_reports',
  vocational_certificate: 'navttc_reports',
  trade_certificate: 'navttc_reports',
  technical_training: 'navttc_reports',
  
  // Professional/IT certifications ONLY
  cv_resume: 'cv_resume',
  medical_certificate: 'medical_reports',
  medical_reports: 'medical_reports',
  certificate: 'certificates',
  certificates: 'certificates',
  professional_certificate: 'certificates',
  skill_certificate: 'certificates',
  contract: 'contracts',
  contracts: 'contracts',
  photos: 'other_documents',
  other_documents: 'other_documents',
};

export function docTypeToFolder(docType: string): string {
  const t = (docType || '').trim().toLowerCase();
  return DOC_TYPE_TO_FOLDER[t] ?? 'other_documents';
}

export interface SplitDoc {
  doc_type: string;
  pages: number[];
  regions?: unknown[];
  confidence: number;
  identity?: Record<string, unknown>;
  pdf_base64: string;
  split_strategy: 'page' | 'region' | 'grouped';
  needs_review?: boolean;
  is_image?: boolean;  // True if this is an image (e.g., JPEG photo), not a PDF
  mime_type?: string;  // MIME type: 'image/jpeg' for photos, 'application/pdf' for others
}

export interface SplitAndCategorizeResponse {
  success: boolean;
  engine_used: 'vision_only' | 'textract+vision';
  documents: SplitDoc[];
}

/**
 * Preserve original upload: store raw file as-is at original_uploads/upload_<uuid>.pdf (immutable).
 * Uses actual mimeType for Content-Type when storing.
 */
export async function preserveOriginalPdf(
  buffer: Buffer,
  uploadId: string,
  mimeType: string = 'application/pdf'
): Promise<string> {
  const db = supabaseAdminClient();
  const path = `${ORIGINAL_PREFIX}/upload_${uploadId}.pdf`;
  const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, buffer, {
    contentType: mimeType || 'application/pdf',
    upsert: false,
  });
  if (error) throw new Error(`Failed to preserve original PDF: ${error.message}`);
  return path;
}

/**
 * Compute HMAC-SHA256(secret, body) hex for parser x-hmac-signature.
 */
function hmacSignature(body: Buffer): string {
  if (!HMAC_SECRET) throw new Error('PYTHON_HMAC_SECRET is required for split-and-categorize');
  return crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

/**
 * Call POST /split-and-categorize on Python parser. HMAC auth.
 */
export async function callSplitAndCategorize(
  fileContentBase64: string,
  fileName: string,
  mimeType: string,
  candidateData?: Record<string, unknown>,
  useTextract?: boolean
): Promise<SplitAndCategorizeResponse> {
  const payload = {
    file_content: fileContentBase64,
    file_name: fileName,
    mime_type: mimeType,
    candidate_data: candidateData ?? null,
    use_textract: useTextract ?? true,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = hmacSignature(body);

  const res = await fetch(`${PARSER_URL.replace(/\/$/, '')}/split-and-categorize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hmac-signature': sig,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Parser split-and-categorize failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as SplitAndCategorizeResponse;
  if (!json.success || !Array.isArray(json.documents)) {
    throw new Error('Parser returned invalid split-and-categorize response');
  }
  return json;
}

/**
 * Create candidate from parser identity when no candidate_id. Use name or placeholder.
 * If identity matches existing (cnic/passport), return existing candidate id.
 * 
 * DEDUPLICATION FLOW (multi-layer, matches Gmail worker):
 * Layer 1: CNIC check (highest confidence)
 * Layer 2: Passport check
 * Layer 3: Email/Phone check via CandidateMatcher (NEW - prevents manual upload duplicates)
 * Layer 4: Create new candidate only if no match found
 */
export async function createCandidateFromIdentity(
  identity: Record<string, unknown> | undefined,
  userId: string
): Promise<{ id: string }> {
  let pendingDuplicateAlert: {
    matchCount: number;
    matchedBy: string | null;
    reviewReasons?: string[];
  } | null = null;

  const cnic = (identity?.cnic as string) || undefined;
  const passport = (identity?.passport_no as string) || undefined;
  const phone = (identity?.phone as string) || undefined;
  const name = (identity?.name as string) || (identity?.father_name as string) || 'Unknown';
  
  // Filter government emails
  let email = (identity?.email as string) || undefined;
  if (email && isGovernmentEmail(email)) {
    console.log(`🚫 Filtered government email in split upload: ${email}`);
    email = undefined;
  }
  
  // LAYER 1 & 2: Check for duplicates by CNIC/Passport (existing logic)
  const duplicates = await checkForDuplicates(cnic, passport);
  if (duplicates.length > 0) {
    console.log(`🔗 [Manual Upload] Found existing candidate ${duplicates[0].candidate_code} via ${duplicates[0].matchReason}`);
    return { id: duplicates[0].id };
  }
  
  // LAYER 3: Pre-create deduplication via CandidateMatcher (email/phone)
  // CRITICAL: This prevents duplicates when admin manually uploads CV for existing
  // candidate who doesn't have CNIC/passport filled yet (e.g., pending missing data)
  if (email || phone) {
    console.log(`[Manual Upload] Pre-create dedup: checking email=${email?.substring(0, 20)}..., phone=${phone}`);
    
    const matchResult = await CandidateMatcher.findCandidate({
      cnic,
      email,
      phone,
      name,
    });
    
    if (matchResult.candidateId) {
      console.log(`✅ [Manual Upload] Matched existing candidate via ${matchResult.matchedBy} (confidence: ${matchResult.confidence})`);
      return { id: matchResult.candidateId };
    }
    
    if (matchResult.needsManualReview) {
      console.warn(`⚠️  [Manual Upload] Multiple candidates found, creating anyway (admin can merge later):`, matchResult.reviewReasons);
      pendingDuplicateAlert = {
        matchCount: matchResult.matchCount,
        matchedBy: matchResult.matchedBy,
        reviewReasons: matchResult.reviewReasons,
      };
      // Continue to create - admin will see duplicate warning and can merge
    }
  }
  
  // LAYER 4: No match found - create new candidate
  console.log(`➕ [Manual Upload] Creating new candidate: ${name}`);
  
  const data: CreateCandidateData = {
    name: String(name).trim() || 'Unknown',
    email,
    phone,
    date_of_birth: (identity?.date_of_birth as string) || undefined,
    cnic,
    passport,
  };
  const candidate = await createCandidate(data, userId);

  if (pendingDuplicateAlert) {
    await sendHighSimilarityAlert({
      candidateCode: candidate.candidate_code,
      candidateId: candidate.id,
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
      matchCount: pendingDuplicateAlert.matchCount,
      matchedBy: pendingDuplicateAlert.matchedBy,
      reviewReasons: pendingDuplicateAlert.reviewReasons,
    });
  }

  return { id: candidate.id };
}

async function sendHighSimilarityAlert(details: {
  candidateCode?: string | null;
  candidateId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  matchCount: number;
  matchedBy: string | null;
  reviewReasons?: string[];
}) {
  const alertRecipient = process.env.DUPLICATE_ALERT_EMAIL || 'falishamanpower4035@gmail.com';
  const subject = `Possible duplicate created (manual upload): ${details.candidateCode || details.candidateId}`;
  const reasons = details.reviewReasons?.length
    ? details.reviewReasons.join('; ')
    : 'Multiple potential matches detected.';

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2 style="margin: 0 0 12px 0;">Possible duplicate candidate created</h2>
      <p style="margin: 0 0 12px 0;">A new candidate was created via manual upload with high similarity to existing records.</p>
      <table style="border-collapse: collapse;">
        <tr><td style="padding: 4px 8px; font-weight: bold;">Candidate Code:</td><td style="padding: 4px 8px;">${details.candidateCode || 'N/A'}</td></tr>
        <tr><td style="padding: 4px 8px; font-weight: bold;">Candidate ID:</td><td style="padding: 4px 8px;">${details.candidateId}</td></tr>
        <tr><td style="padding: 4px 8px; font-weight: bold;">Name:</td><td style="padding: 4px 8px;">${details.name}</td></tr>
        <tr><td style="padding: 4px 8px; font-weight: bold;">Email:</td><td style="padding: 4px 8px;">${details.email || 'N/A'}</td></tr>
        <tr><td style="padding: 4px 8px; font-weight: bold;">Phone:</td><td style="padding: 4px 8px;">${details.phone || 'N/A'}</td></tr>
        <tr><td style="padding: 4px 8px; font-weight: bold;">Matches Found:</td><td style="padding: 4px 8px;">${details.matchCount}</td></tr>
        <tr><td style="padding: 4px 8px; font-weight: bold;">Matched By:</td><td style="padding: 4px 8px;">${details.matchedBy || 'Multiple'}</td></tr>
        <tr><td style="padding: 4px 8px; font-weight: bold;">Reasons:</td><td style="padding: 4px 8px;">${reasons}</td></tr>
      </table>
      <p style="margin: 12px 0 0 0;">Please review and merge if needed.</p>
    </div>
  `;

  const text = [
    'Possible duplicate candidate created (manual upload)',
    `Candidate Code: ${details.candidateCode || 'N/A'}`,
    `Candidate ID: ${details.candidateId}`,
    `Name: ${details.name}`,
    `Email: ${details.email || 'N/A'}`,
    `Phone: ${details.phone || 'N/A'}`,
    `Matches Found: ${details.matchCount}`,
    `Matched By: ${details.matchedBy || 'Multiple'}`,
    `Reasons: ${reasons}`,
    'Please review and merge if needed.',
  ].join('\n');

  try {
    await emailService.sendEmail({ to: alertRecipient, subject, html, text });
    console.log(`[Manual Upload] High-similarity alert sent to ${alertRecipient}`);
  } catch (error) {
    console.warn('[Manual Upload] Failed to send high-similarity alert:', error);
  }
}

/**
 * Ensure we have a candidate_id: use existing (if found) or create from identity.
 * If candidate_id provided but not found, create new candidate from identity.
 */
export async function ensureCandidateId(
  candidateId: string | undefined,
  identity: Record<string, unknown> | undefined,
  userId: string
): Promise<string> {
  if (candidateId) {
    const db = supabaseAdminClient();
    const { data, error } = await db.from('candidates').select('id').eq('id', candidateId).single();
    if (!error && data) return candidateId;
  }
  const { id } = await createCandidateFromIdentity(identity, userId);
  return id;
}

/**
 * Upload one split document to storage and create DB record.
 * 
 * Special handling for photos:
 * - Use hybrid extraction (Python parser → Backend AI → manual review)
 * - Skip creating a candidate_document if extraction succeeds
 * - Mark photo as received and set profile photo
 */
async function uploadOneSplitDoc(
  candidateId: string,
  doc: SplitDoc,
  uploadId: string,
  userId: string,
  engineUsed: string
): Promise<void> {
  const db = supabaseAdminClient();
  const docType = (doc.doc_type || '').toLowerCase();
  
  // SPECIAL HANDLING FOR PHOTOS: Use hybrid extraction
  if (docType === 'photo' || docType === 'photos') {
    console.log(`[UploadOneSplitDoc] Photos detected for candidate ${candidateId}, attempting hybrid extraction`);
    
    const fileBuffer = Buffer.from(doc.pdf_base64, 'base64');
    
    try {
      const extractionResult = await extractProfilePhotoHybrid(candidateId, uploadId, fileBuffer);
      
      if (extractionResult.success && extractionResult.photoBuffer) {
        // Extraction succeeded - save photo directly
        console.log(`[UploadOneSplitDoc] Hybrid extraction succeeded using ${extractionResult.method} method`);
        
        await uploadExtractedPhotoToCandidatePhotos(candidateId, uploadId, extractionResult.photoBuffer);
        
        // Log the successful extraction
        try {
          await logDocumentUploaded(candidateId, userId, {
            doc_type: doc.doc_type,
            file_name: `profile_photo_${Date.now()}.jpg`,
            mime_type: 'image/jpeg',
            split_strategy: doc.split_strategy,
            needs_review: false,
            extraction_method: extractionResult.method,
            extraction_status: 'success',
          });
        } catch (e) {
          console.error('Failed to log timeline for extracted photo:', e);
        }
        
        // Successfully processed - don't create a document record, photo is now the candidate's profile
        return;
      } else {
        // Extraction failed - create document record for manual review
        console.log(`[UploadOneSplitDoc] Hybrid extraction failed for candidate ${candidateId}. Creating document for manual review.`);
      }
    } catch (error) {
      console.error(`[UploadOneSplitDoc] Hybrid extraction error for candidate ${candidateId}:`, error);
      // Fall through to create document for manual review
    }
    
    // If we get here, extraction failed - create split_photos_*.pdf for manual review
    // Continue with normal document creation below
  }
  
  // NORMAL DOCUMENT PROCESSING (for non-photos or failed photo extraction)
  const folder = docTypeToFolder(doc.doc_type);
  
  // Use shared utility to process the split document (handles images, profile photos, etc.)
  const processed = await processSplitDocument(doc, candidateId, uploadId, folder);
  
  const fileBuffer = Buffer.from(doc.pdf_base64, 'base64');
  const sha256 = calculateSHA256(fileBuffer);

  // Fetch candidate name for better filename
  let candidateName: string | undefined;
  try {
    const { data: candidate } = await db
      .from('candidates')
      .select('name')
      .eq('id', candidateId)
      .single();
    candidateName = candidate?.name;
  } catch (e) {
    console.log('[uploadOneSplitDoc] Could not fetch candidate name, using default');
  }

  // Generate descriptive filename
  const ts = Date.now();
  const descriptiveFilename = generateDescriptiveFilename(
    {
      doc_type: doc.doc_type,
      pages: doc.pages,
      split_strategy: doc.split_strategy,
      page_number: doc.pages && doc.pages.length === 1 ? doc.pages[0] : undefined,
    },
    candidateName,
    ts
  );

  const metadata: Record<string, unknown> = {
    split_strategy: doc.split_strategy,
    engine_used: engineUsed,
    needs_review: !!doc.needs_review,
  };

  // For photos that failed extraction, mark as needing review
  const needsReview = (docType === 'photo' || docType === 'photos');

  const { error: insErr } = await db.from('documents').insert({
    candidate_id: candidateId,
    doc_type: doc.doc_type,
    storage_bucket: STORAGE_BUCKET,
    storage_path: processed.storagePath,
    file_name: descriptiveFilename,
    mime_type: processed.mimeType,
    sha256,
    is_primary: false,
    pages: doc.pages ?? [],
    confidence: doc.confidence ?? null,
    needs_review: needsReview,  // Photos that failed extraction need review
    verification_status: undefined,  // Pending review
    metadata: {
      ...metadata,
      extraction_status: 'failed',
      extraction_reason: 'Hybrid extraction could not find profile photo',
    },
  });

  if (insErr) {
    await db.storage.from(STORAGE_BUCKET).remove([processed.storagePath]);
    throw new Error(`Failed to create document record: ${insErr.message}`);
  }

  // Update candidate flags based on document type
  // Note: Database trigger should handle this, but we also update here for immediate consistency
  try {
    const updateFlags: Record<string, unknown> = {};
    const docType = (doc.doc_type || '').toLowerCase();
    const now = new Date().toISOString();

    if (docType === 'passport') {
      updateFlags.passport_received = true;
      updateFlags.passport_received_at = now;
    } else if (docType === 'cnic' || docType === 'national_id') {
      updateFlags.cnic_received = true;
      updateFlags.cnic_received_at = now;
    } else if (docType === 'driving_license' || docType === 'drivers_license' || docType === 'driver_license') {
      updateFlags.driving_license_received = true;
      updateFlags.driving_license_received_at = now;
    } else if (docType === 'police_character_certificate' || docType === 'police_clearance' || docType === 'pcc') {
      updateFlags.police_character_received = true;
      updateFlags.police_character_received_at = now;
    } else if (docType === 'cv' || docType === 'cv_resume') {
      updateFlags.cv_received = true;
      updateFlags.cv_received_at = now;
    } else if (docType === 'photo' || docType === 'photos') {
      updateFlags.photo_received = true;
      updateFlags.photo_received_at = now;
    } else if (docType.includes('medical')) {
      updateFlags.medical_received = true;
      updateFlags.medical_received_at = now;
    } else if (docType === 'degree' || docType.includes('diploma') || docType.includes('transcript')) {
      updateFlags.degree_received = true;
      updateFlags.degree_received_at = now;
    } else if (docType === 'visa') {
      updateFlags.visa_received = true;
      updateFlags.visa_received_at = now;
    } else if (docType === 'certificate' || docType === 'certificates') {
      updateFlags.certificate_received = true;
      updateFlags.certificate_received_at = now;
    }

    if (Object.keys(updateFlags).length > 0) {
      const { error: flagError } = await db
        .from('candidates')
        .update(updateFlags)
        .eq('id', candidateId);
      
      if (flagError) {
        console.error(`[SplitUpload] Failed to update flags for ${doc.doc_type}:`, flagError);
        // Don't throw - flag update is not critical, trigger should handle it
      }
    }
  } catch (flagErr) {
    console.error('[SplitUpload] Error updating candidate flags:', flagErr);
    // Don't throw - flag update is not critical
  }

  try {
    await logDocumentUploaded(candidateId, userId, {
      doc_type: doc.doc_type,
      file_name: descriptiveFilename,
      mime_type: 'application/pdf',
      split_strategy: doc.split_strategy,
      needs_review: doc.needs_review,
    });
  } catch (e) {
    console.error('Failed to log timeline for split doc:', e);
  }
}

export interface SplitUploadInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  candidateId?: string;
  candidateData?: Record<string, unknown>;
  useTextract?: boolean;
  userId: string;
}

export interface SplitUploadResult {
  uploadId: string;
  originalPath: string;
  candidateId: string;
  engineUsed: string;
  documentCount: number;
}

/**
 * Full flow: preserve original -> call parser -> create candidate if none -> create one doc per documents[].
 */
export async function splitUpload(input: SplitUploadInput): Promise<SplitUploadResult> {
  const { buffer, fileName, mimeType, candidateId, candidateData, useTextract, userId } = input;
  const uploadId = randomUUID();

  // 1. Preserve original PDF
  const originalPath = await preserveOriginalPdf(buffer, uploadId, mimeType);

  // 2. Call split-and-categorize
  const base64 = buffer.toString('base64');
  const res = await callSplitAndCategorize(base64, fileName, mimeType, candidateData, useTextract);

  // 3. Resolve candidate_id (create if none)
  const firstIdentity = res.documents[0]?.identity;
  const resolvedCandidateId = await ensureCandidateId(candidateId, firstIdentity, userId);

  // 4. Create one document record per documents[]
  for (const doc of res.documents) {
    await uploadOneSplitDoc(resolvedCandidateId, doc, uploadId, userId, res.engine_used);
  }

  return {
    uploadId,
    originalPath,
    candidateId: resolvedCandidateId,
    engineUsed: res.engine_used,
    documentCount: res.documents.length,
  };
}
