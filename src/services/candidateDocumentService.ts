import { supabaseAdminClient } from '../config/database';
import crypto from 'crypto';
import { VERIFICATION_STATUS, DocumentCategory } from '../config/documentCategories';
import { DocumentVerificationLogService, generateRequestId } from './documentVerificationLogService';
import { documentVerificationQueue } from '../config/queue';

export interface CandidateDocument {
  id: string;
  candidate_id: string;
  document_type?: string;
  category?: DocumentCategory;
  detected_category?: DocumentCategory;
  confidence?: number;
  verification_status?: string;
  verification_reason_code?: string;
  mismatch_fields?: string[];
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type?: string;
  source: string;
  status?: string;
  received_at: string;
  created_at: string;
  updated_at: string;
}

export interface UploadCandidateDocumentData {
  candidate_id: string;
  file_name: string;
  mime_type: string;
  buffer: Buffer;
  source?: string; // 'web' | 'email' | 'api' | 'manual'
  uploaded_by_user_id?: string;
}

const STORAGE_BUCKET = 'documents';

/**
 * Calculate SHA256 hash of file buffer
 */
function calculateSHA256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Generate storage path for candidate document
 */
function generateStoragePath(candidateId: string, fileName: string): string {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `candidates/${candidateId}/documents/${timestamp}_${sanitizedFileName}`;
}

/**
 * Upload document with AI verification workflow
 * - Stores file in private bucket
 * - Creates candidate_documents record with status = PENDING_AI
 * - Enqueues AI processing job
 * - Logs upload event to verification logs
 */
export async function uploadCandidateDocument(
  data: UploadCandidateDocumentData
): Promise<{ document: CandidateDocument; request_id: string }> {
  const db = supabaseAdminClient();
  const logService = new DocumentVerificationLogService();
  const requestId = generateRequestId();

  try {
    // Generate unique request ID for tracing
    console.log(`[UploadDocument] Starting upload for candidate ${data.candidate_id}, request_id: ${requestId}`);

    // Log upload started
    await logService.logUploadStarted(
      requestId,
      data.candidate_id,
      data.file_name,
      data.mime_type,
      data.buffer.length,
      data.uploaded_by_user_id
    );

    // Verify candidate exists
    const { data: candidate, error: candidateError } = await db
      .from('candidates')
      .select('id')
      .eq('id', data.candidate_id)
      .single();

    if (candidateError || !candidate) {
      await logService.logError(
        requestId,
        'Candidate not found',
        undefined,
        undefined,
        data.candidate_id
      );
      throw new Error('Candidate not found');
    }

    // Generate storage path
    const storagePath = generateStoragePath(data.candidate_id, data.file_name);

    // Upload to Supabase Storage (private bucket)
    const { error: uploadError } = await db.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, data.buffer, {
        contentType: data.mime_type,
        upsert: false,
      });

    if (uploadError) {
      await logService.logError(
        requestId,
        `Failed to upload file: ${uploadError.message}`,
        undefined,
        undefined,
        data.candidate_id
      );
      throw new Error(`Failed to upload file: ${uploadError.message}`);
    }

    console.log(`[UploadDocument] File uploaded to storage: ${storagePath}`);

    // Create candidate_documents record with status = PENDING_AI
    const documentData = {
      candidate_id: data.candidate_id,
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      file_name: data.file_name,
      mime_type: data.mime_type,
      source: data.source || 'web',
      status: 'received', // Legacy field
      verification_status: VERIFICATION_STATUS.PENDING_AI, // New AI workflow status
      received_at: new Date().toISOString(),
    };

    const { data: document, error: dbError } = await db
      .from('candidate_documents')
      .insert(documentData)
      .select()
      .single();

    if (dbError) {
      // Rollback: delete uploaded file
      await db.storage.from(STORAGE_BUCKET).remove([storagePath]);
      
      await logService.logError(
        requestId,
        `Failed to create document record: ${dbError.message}`,
        undefined,
        undefined,
        data.candidate_id
      );
      
      throw new Error(`Failed to create document record: ${dbError.message}`);
    }

    console.log(`[UploadDocument] Document record created: ${document.id}`);

    // Log upload completed
    await logService.logUploadCompleted(
      requestId,
      document.id,
      data.candidate_id,
      STORAGE_BUCKET,
      storagePath
    );

    // Enqueue AI processing job
    try {
      const jobData = {
        requestId,
        documentId: document.id,
        candidateId: data.candidate_id,
        storageBucket: STORAGE_BUCKET,
        storagePath,
        fileName: data.file_name,
        mimeType: data.mime_type,
      };

      await documentVerificationQueue.add('verify-document', jobData, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      });

      console.log(`[UploadDocument] Enqueued AI verification job for document ${document.id}`);
    } catch (queueError: any) {
      console.error('[UploadDocument] Failed to enqueue AI job:', queueError);
      
      // Don't fail the upload, but log the error
      await logService.logError(
        requestId,
        `Failed to enqueue AI job: ${queueError.message}`,
        queueError.stack,
        document.id,
        data.candidate_id
      );
    }

    return {
      document: document as CandidateDocument,
      request_id: requestId,
    };
  } catch (error: any) {
    console.error('[UploadDocument] Upload failed:', error);
    
    // Log error if not already logged
    try {
      await logService.logError(
        requestId,
        error.message || 'Upload failed',
        error.stack,
        undefined,
        data.candidate_id
      );
    } catch (logError) {
      console.error('[UploadDocument] Failed to log error:', logError);
    }
    
    throw error;
  }
}

/**
 * Get candidate document by ID
 */
export async function getCandidateDocumentById(documentId: string): Promise<CandidateDocument | null> {
  const db = supabaseAdminClient();

  const { data, error } = await db
    .from('candidate_documents')
    .select('*')
    .eq('id', documentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch document: ${error.message}`);
  }

  return data as CandidateDocument;
}

/**
 * List all documents for a candidate
 */
export async function listCandidateDocumentsByCandidate(
  candidateId: string,
  category?: DocumentCategory
): Promise<CandidateDocument[]> {
  const db = supabaseAdminClient();

  let query = db
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false });

  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list documents: ${error.message}`);
  }

  return (data || []) as CandidateDocument[];
}

/**
 * Get document signed URL for download
 */
export async function getCandidateDocumentSignedUrl(
  documentId: string,
  expiresIn: number = 3600
): Promise<string> {
  const db = supabaseAdminClient();

  const document = await getCandidateDocumentById(documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  const { data, error } = await db.storage
    .from(document.storage_bucket)
    .createSignedUrl(document.storage_path, expiresIn);

  if (error || !data) {
    throw new Error(`Failed to generate signed URL: ${error?.message}`);
  }

  return data.signedUrl;
}

/**
 * Delete candidate document
 */
export async function deleteCandidateDocument(documentId: string): Promise<void> {
  const db = supabaseAdminClient();

  const document = await getCandidateDocumentById(documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  // Delete from storage
  const { error: storageError } = await db.storage
    .from(document.storage_bucket)
    .remove([document.storage_path]);

  if (storageError) {
    console.error('Failed to delete file from storage:', storageError);
    // Continue with database deletion even if storage deletion fails
  }

  // Delete from database
  const { error: dbError } = await db
    .from('candidate_documents')
    .delete()
    .eq('id', documentId);

  if (dbError) {
    throw new Error(`Failed to delete document: ${dbError.message}`);
  }
}

/**
 * Update document verification status and category
 */
export async function updateDocumentVerification(
  documentId: string,
  updates: {
    verification_status?: string;
    category?: DocumentCategory;
    detected_category?: DocumentCategory;
    confidence?: number;
    verification_reason_code?: string;
    mismatch_fields?: string[];
    extracted_identity_json?: Record<string, any>;
    ai_processing_started_at?: string;
    ai_processing_completed_at?: string;
    verification_completed_at?: string;
  }
): Promise<CandidateDocument> {
  const db = supabaseAdminClient();

  const { data, error } = await db
    .from('candidate_documents')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update document: ${error.message}`);
  }

  return data as CandidateDocument;
}
