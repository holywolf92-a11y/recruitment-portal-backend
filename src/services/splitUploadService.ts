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

const STORAGE_BUCKET = 'documents';
const ORIGINAL_PREFIX = 'original_uploads';

const PARSER_URL = process.env.PYTHON_CV_PARSER_URL || process.env.PARSER_URL || 'http://127.0.0.1:8000';
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET || '';

/**
 * Mandatory doc_type -> storage folder mapping.
 * Unknown / unmapped -> other_documents/
 */
export const DOC_TYPE_TO_FOLDER: Record<string, string> = {
  passport: 'passport',
  driving_license: 'driving_license',
  national_id: 'cnic',
  cnic: 'cnic',
  police_character_certificate: 'police_character_certificate',
  cv_resume: 'cv_resume',
  medical_certificate: 'medical_reports',
  medical_reports: 'medical_reports',
  certificate: 'certificates',
  certificates: 'certificates',
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
 */
export async function createCandidateFromIdentity(
  identity: Record<string, unknown> | undefined,
  userId: string
): Promise<{ id: string }> {
  const cnic = (identity?.cnic as string) || undefined;
  const passport = (identity?.passport_no as string) || undefined;
  const duplicates = await checkForDuplicates(cnic, passport);
  if (duplicates.length > 0) {
    return { id: duplicates[0].id };
  }
  const name = (identity?.name as string) || (identity?.father_name as string) || 'Unknown';
  const data: CreateCandidateData = {
    name: String(name).trim() || 'Unknown',
    email: (identity?.email as string) || undefined,
    phone: (identity?.phone as string) || undefined,
    date_of_birth: (identity?.date_of_birth as string) || undefined,
    cnic,
    passport,
  };
  const candidate = await createCandidate(data, userId);
  return { id: candidate.id };
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
 */
async function uploadOneSplitDoc(
  candidateId: string,
  doc: SplitDoc,
  uploadId: string,
  userId: string,
  engineUsed: string
): Promise<void> {
  const db = supabaseAdminClient();
  const fileBuffer = Buffer.from(doc.pdf_base64, 'base64');
  const ts = Date.now();
  
  // CRITICAL FIX: If this is a photo (extracted image), ALSO save it as profile photo
  const isImage = doc.is_image === true;
  const mimeType = doc.mime_type || (isImage ? 'image/jpeg' : 'application/pdf');
  const ext = isImage ? 'jpg' : 'pdf';
  const folder = docTypeToFolder(doc.doc_type);
  const sha256 = calculateSHA256(fileBuffer);
  const storagePath = `${candidateId}/${folder}/${ts}_${uploadId}_${(doc.pages || []).join('-')}.${ext}`;
  
  // If this is a photo, also save it as the candidate's profile photo
  if (isImage && (doc.doc_type === 'photos' || doc.doc_type === 'photo')) {
    const profilePhotoPath = `candidates/${candidateId}/profile_photos/${ts}_extracted.jpg`;
    
    const { error: photoUploadErr } = await db.storage.from(STORAGE_BUCKET).upload(profilePhotoPath, fileBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });
    
    if (!photoUploadErr) {
      // Update candidate's profile photo fields
      const { error: updateErr } = await db
        .from('candidates')
        .update({
          profile_photo_bucket: STORAGE_BUCKET,
          profile_photo_path: profilePhotoPath,
          profile_photo_url: null,
          photo_received: true,
          photo_received_at: new Date().toISOString(),
        })
        .eq('id', candidateId);
      
      if (!updateErr) {
        console.log(`[SplitUpload] ✅ Saved profile photo for candidate ${candidateId}: ${profilePhotoPath}`);
      }
    }
  }

  const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(storagePath, fileBuffer, {
    contentType: mimeType,
    upsert: false,
  });
  if (upErr) throw new Error(`Failed to upload split doc: ${upErr.message}`);

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

  // For profile photos that were extracted as images, set verification_status to 'verified'
  // to skip the approval workflow since we've already saved them as the candidate's profile photo
  const verificationStatus = isImage && (doc.doc_type === 'photos' || doc.doc_type === 'photo') 
    ? 'verified' 
    : undefined;

  const { error: insErr } = await db.from('documents').insert({
    candidate_id: candidateId,
    doc_type: doc.doc_type,
    storage_bucket: STORAGE_BUCKET,
    storage_path: storagePath,
    file_name: descriptiveFilename,
    mime_type: mimeType,  // Use detected MIME type (image/jpeg for photos)
    sha256,
    is_primary: false,
    pages: doc.pages ?? [],
    confidence: doc.confidence ?? null,
    needs_review: false,  // Photos are auto-verified, no review needed
    verification_status: verificationStatus,  // Set to 'verified' for extracted photos
    metadata,
  });

  if (insErr) {
    await db.storage.from(STORAGE_BUCKET).remove([storagePath]);
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
