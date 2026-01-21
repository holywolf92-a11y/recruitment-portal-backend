import { supabaseAdminClient } from '../config/database';
import crypto from 'crypto';
import { VERIFICATION_STATUS, DocumentCategory } from '../config/documentCategories';
import { DocumentVerificationLogService, generateRequestId } from './documentVerificationLogService';
import { documentVerificationQueue } from '../config/queue';
import { AppError, ErrorType } from '../utils/errorHandling';

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
    // File validation
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/jpg',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (!data.file_name || !data.mime_type || !data.buffer) {
      const errMsg = 'Missing file_name, mime_type, or buffer';
      await logService.logError(requestId, errMsg, undefined, undefined, data.candidate_id);
      throw new AppError(errMsg, ErrorType.VALIDATION, 400);
    }
    if (data.buffer.length === 0) {
      const errMsg = 'File is empty';
      await logService.logError(requestId, errMsg, undefined, undefined, data.candidate_id);
      throw new AppError(errMsg, ErrorType.VALIDATION, 400);
    }
    if (data.buffer.length > maxSize) {
      const errMsg = 'File exceeds 10MB size limit';
      await logService.logError(requestId, errMsg, undefined, undefined, data.candidate_id);
      throw new AppError(errMsg, ErrorType.VALIDATION, 400);
    }
    if (!allowedTypes.includes(data.mime_type)) {
      const errMsg = `Unsupported file type: ${data.mime_type}`;
      await logService.logError(requestId, errMsg, undefined, undefined, data.candidate_id);
      throw new AppError(errMsg, ErrorType.VALIDATION, 400);
    }

    // Validate candidate_id format first (before any logging)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(data.candidate_id) || data.candidate_id === '00000000-0000-0000-0000-000000000000') {
      const errMsg = 'Invalid candidate_id format';
      throw new AppError(errMsg, ErrorType.VALIDATION, 400);
    }

    // Verify candidate exists BEFORE logging (to avoid foreign key violations)
    const { data: candidate, error: candidateError } = await db
      .from('candidates')
      .select('id')
      .eq('id', data.candidate_id)
      .single();

    if (candidateError || !candidate) {
      const errMsg = `Candidate not found: ${data.candidate_id}`;
      throw new AppError(errMsg, ErrorType.VALIDATION, 404);
    }

    // Generate unique request ID for tracing
    console.log(`[UploadDocument] Starting upload for candidate ${data.candidate_id}, request_id: ${requestId}`);

    // Log upload started (now safe because candidate exists)
    await logService.logUploadStarted(
      requestId,
      data.candidate_id,
      data.file_name,
      data.mime_type,
      data.buffer.length,
      data.uploaded_by_user_id
    );

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
      // Provide a safe default to satisfy NOT NULL constraint
      document_type: 'other',
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      file_name: data.file_name,
      mime_type: data.mime_type,
      source: data.source || 'manual', // Use 'manual' as safe default (constraint allows it)
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

    // Update candidate document flags based on category
    // This ensures the candidate card shows correct document status
    try {
      const updateFlags: any = {};
      const category = document.category?.toLowerCase() || '';
      const now = new Date().toISOString();

      if (category === 'cv_resume' || category === 'cv') {
        updateFlags.cv_received = true;
        updateFlags.cv_received_at = now;
      } else if (category === 'passport') {
        updateFlags.passport_received = true;
        updateFlags.passport_received_at = now;
      } else if (category === 'certificates' || category === 'certificate') {
        updateFlags.certificate_received = true;
        updateFlags.certificate_received_at = now;
      } else if (category === 'photos' || category === 'photo') {
        updateFlags.photo_received = true;
        updateFlags.photo_received_at = now;
      } else if (category === 'medical_reports' || category === 'medical') {
        updateFlags.medical_received = true;
        updateFlags.medical_received_at = now;
      }

      if (Object.keys(updateFlags).length > 0) {
        await db
          .from('candidates')
          .update(updateFlags)
          .eq('id', data.candidate_id);
        
        console.log(`[UploadDocument] Updated candidate flags for ${data.candidate_id}:`, Object.keys(updateFlags));
      }
    } catch (flagError: any) {
      console.error('[UploadDocument] Failed to update candidate flags:', flagError);
      // Don't fail the upload if flag update fails
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
 * Delete candidate document and update candidate flags
 */
export async function deleteCandidateDocument(documentId: string): Promise<void> {
  const db = supabaseAdminClient();

  const document = await getCandidateDocumentById(documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  const candidateId = document.candidate_id;
  const category = document.category?.toLowerCase() || '';

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

  // After deletion, recalculate and update candidate flags
  // Check if there are any remaining documents of this category
  try {
    // Check candidate_documents table
    const { data: remainingDocs } = await db
      .from('candidate_documents')
      .select('category')
      .eq('candidate_id', candidateId);

    // Check inbox_attachments for CVs
    const { data: inboxAttachments } = await db
      .from('inbox_attachments')
      .select('attachment_type, file_name, document_type, attachment_kind')
      .or(`candidate_id.eq.${candidateId},linked_candidate_id.eq.${candidateId}`);

    // Check old documents table
    const { data: oldDocuments } = await db
      .from('documents')
      .select('doc_type, file_name')
      .eq('candidate_id', candidateId)
      .eq('deleted_at', null);

    // Combine all document sources
    const allDocs = [
      ...(remainingDocs || []).map(d => ({ category: d.category, type: null, file_name: null, source_table: 'candidate_documents' })),
      ...(inboxAttachments || []).map(d => ({ 
        category: d.attachment_kind === 'cv' ? 'cv_resume' : d.document_type, 
        type: d.attachment_type, 
        file_name: d.file_name, 
        source_table: 'inbox_attachments' 
      })),
      ...(oldDocuments || []).map(d => ({ category: null, type: d.doc_type, file_name: d.file_name, source_table: 'documents' }))
    ];

    // Determine which flags to set based on remaining documents
    const updateFlags: any = {};

    // Initialize all flags to false first
    updateFlags.cv_received = false;
    updateFlags.passport_received = false;
    updateFlags.certificate_received = false;
    updateFlags.photo_received = false;
    updateFlags.medical_received = false;

    // Set flags to true if documents exist
    for (const doc of allDocs) {
      const docCategory = (doc.category || '').toLowerCase();
      const docType = (doc.type || '').toLowerCase();
      const fileName = (doc.file_name || '').toLowerCase();

      // Check category first (new system)
      if (docCategory === 'cv_resume' || docCategory === 'cv') {
        updateFlags.cv_received = true;
      } 
      // Check doc_type (old system or inbox attachment document_type)
      else if (docType === 'cv' || docType.includes('resume')) {
        updateFlags.cv_received = true;
      }
      // Check filename as fallback
      else if (fileName.includes('cv') || fileName.includes('resume')) {
        updateFlags.cv_received = true;
      }

      if (docCategory === 'passport' || docType === 'passport' || fileName.includes('passport')) {
        updateFlags.passport_received = true;
      }
      // Check for certificates - handle both singular and plural, and also check for 'cert' abbreviation
      if (docCategory === 'certificates' || docCategory === 'certificate' || docCategory === 'cert' || 
          docType === 'certificate' || docType === 'cert' || 
          fileName.includes('certificate') || fileName.includes('cert')) {
        updateFlags.certificate_received = true;
      }
      if (docCategory === 'photos' || docCategory === 'photo' || docType === 'photo' || fileName.includes('photo')) {
        updateFlags.photo_received = true;
      }
      if (docCategory === 'medical_reports' || docCategory === 'medical' || docType === 'medical' || fileName.includes('medical')) {
        updateFlags.medical_received = true;
      }
    }

    // Update candidate flags
    if (Object.keys(updateFlags).length > 0) {
      const { error: updateError } = await db
        .from('candidates')
        .update(updateFlags)
        .eq('id', candidateId);
      
      if (updateError) {
        console.error(`[DeleteDocument] Failed to update flags:`, updateError);
      } else {
        console.log(`[DeleteDocument] Updated candidate flags for ${candidateId} after deletion:`, {
          cv: updateFlags.cv_received,
          passport: updateFlags.passport_received,
          certificate: updateFlags.certificate_received,
          photo: updateFlags.photo_received,
          medical: updateFlags.medical_received,
        });
        console.log(`[DeleteDocument] Found ${allDocs.length} remaining documents for candidate ${candidateId}`);
      }
    } else {
      console.log(`[DeleteDocument] No flags to update for candidate ${candidateId}`);
    }
  } catch (flagError: any) {
    console.error('[DeleteDocument] Failed to update candidate flags after deletion:', flagError);
    // Don't fail the deletion if flag update fails
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

/**
 * Reprocess document verification - re-enqueue AI verification job
 * This is useful when matching logic is updated and we want to re-process existing documents
 */
export async function reprocessDocumentVerification(documentId: string): Promise<{ success: boolean; request_id: string }> {
  const db = supabaseAdminClient();
  const logService = new DocumentVerificationLogService();
  const requestId = generateRequestId();

  try {
    // Get document details
    const { data: document, error: docError } = await db
      .from('candidate_documents')
      .select('id, candidate_id, storage_path, file_name, mime_type, storage_bucket')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new AppError('Document not found', ErrorType.NOT_FOUND, 404);
    }

    // Reset document status to pending_ai
    await db
      .from('candidate_documents')
      .update({
        verification_status: VERIFICATION_STATUS.PENDING_AI,
        verification_reason_code: null,
        mismatch_fields: null,
        ai_processing_started_at: null,
        ai_processing_completed_at: null,
        verification_completed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    // Enqueue AI processing job
    const jobData = {
      requestId,
      documentId: document.id,
      candidateId: document.candidate_id,
      storageBucket: document.storage_bucket || STORAGE_BUCKET,
      storagePath: document.storage_path,
      fileName: document.file_name,
      mimeType: document.mime_type || 'application/pdf',
    };

    await documentVerificationQueue.add('verify-document', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });

    console.log(`[ReprocessDocument] Re-enqueued AI verification job for document ${documentId}`);

    // Log reprocess event (using logUploadStarted to track the reprocess)
    await logService.logUploadStarted(
      requestId,
      document.candidate_id,
      document.file_name,
      document.mime_type || 'application/pdf',
      0 // file size not needed for reprocess
    );

    return {
      success: true,
      request_id: requestId,
    };
  } catch (error: any) {
    console.error('[ReprocessDocument] Failed to reprocess document:', error);
    await logService.logError(
      requestId,
      `Failed to reprocess document: ${error.message}`,
      error.stack,
      documentId,
      undefined
    );
    throw error;
  }
}
