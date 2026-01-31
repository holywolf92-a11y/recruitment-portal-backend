import { supabaseAdminClient } from '../config/database';
import crypto from 'crypto';
import { logDocumentUploaded, logDocumentDeleted } from './timelineService';
import { documentVerificationQueue } from '../config/queue';
import { DocumentVerificationLogService, generateRequestId } from './documentVerificationLogService';
import { VERIFICATION_STATUS, DocumentCategory, DOCUMENT_CATEGORIES } from '../config/documentCategories';

export interface Document {
  id: string;
  candidate_id: string;
  doc_type: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  sha256?: string;
  is_primary: boolean;
  created_at: string;
}

export interface UploadDocumentData {
  candidate_id: string;
  doc_type: string;
  file_name: string;
  mime_type: string;
  buffer: Buffer;
  is_primary?: boolean;
}

const STORAGE_BUCKET = 'documents';

/**
 * Calculate SHA256 hash of file buffer
 */
export function calculateSHA256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Generate storage path for document
 */
export function generateStoragePath(candidateId: string, docType: string, fileName: string): string {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${candidateId}/${docType}/${timestamp}_${sanitizedFileName}`;
}

/**
 * Upload document to Supabase Storage and create database record
 * 
 * @deprecated This function is deprecated. Use candidateDocumentService.uploadCandidateDocument() instead.
 * This function creates duplicate entries in both 'documents' and 'candidate_documents' tables.
 * The new unified system only uses 'candidate_documents' with AI verification.
 * 
 * This is kept for backward compatibility only. New code should use /api/candidate-documents endpoint.
 */
export async function uploadDocument(data: UploadDocumentData, userId: string): Promise<Document> {
  const db = supabaseAdminClient();

  // Verify candidate exists
  const { data: candidate, error: candidateError } = await db
    .from('candidates')
    .select('id')
    .eq('id', data.candidate_id)
    .single();

  if (candidateError || !candidate) {
    throw new Error('Candidate not found');
  }

  // Calculate file hash
  const sha256 = calculateSHA256(data.buffer);

  // Generate storage path
  const storagePath = generateStoragePath(data.candidate_id, data.doc_type, data.file_name);

  // Upload to Supabase Storage
  const { data: uploadData, error: uploadError } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, data.buffer, {
      contentType: data.mime_type,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Failed to upload file: ${uploadError.message}`);
  }

  // If this is a primary document, unset other primary documents of the same type
  if (data.is_primary) {
    await db
      .from('documents')
      .update({ is_primary: false })
      .eq('candidate_id', data.candidate_id)
      .eq('doc_type', data.doc_type)
      .eq('is_primary', true);
  }

  // Create database record
  const documentData = {
    candidate_id: data.candidate_id,
    doc_type: data.doc_type,
    storage_bucket: STORAGE_BUCKET,
    storage_path: storagePath,
    file_name: data.file_name,
    mime_type: data.mime_type,
    sha256,
    is_primary: data.is_primary || false,
  };

  const { data: document, error: dbError } = await db
    .from('documents')
    .insert(documentData)
    .select()
    .single();

  if (dbError) {
    // Rollback: delete uploaded file
    await db.storage.from(STORAGE_BUCKET).remove([storagePath]);
    throw new Error(`Failed to create document record: ${dbError.message}`);
  }

  // Log timeline event
  try {
    await logDocumentUploaded(data.candidate_id, userId, {
      doc_type: data.doc_type,
      file_name: data.file_name,
      mime_type: data.mime_type,
      is_primary: data.is_primary,
    });
  } catch (timelineError) {
    console.error('Failed to log timeline event:', timelineError);
  }

  // Update candidate checklist flags based on document type
  try {
    const updateFlags: any = {};
    const type = data.doc_type.toLowerCase();
    const now = new Date().toISOString();
    
    if (type.includes('passport')) {
      updateFlags.passport_received = true;
      updateFlags.passport_received_at = now;
    } else if (type.includes('cnic') || type.includes('id card')) {
      updateFlags.cnic_received = true;
      updateFlags.cnic_received_at = now;
    } else if (type.includes('degree') || type.includes('diploma') || type.includes('transcript')) {
      updateFlags.degree_received = true;
      updateFlags.degree_received_at = now;
    } else if (type.includes('medical')) {
      updateFlags.medical_received = true;
      updateFlags.medical_received_at = now;
    } else if (type.includes('visa')) {
      updateFlags.visa_received = true;
      updateFlags.visa_received_at = now;
    } else if (type === 'certificate' || type.includes('certificate')) {
      // CHECK CERTIFICATE FIRST to prevent misclassification as CV
      updateFlags.certificate_received = true;
      updateFlags.certificate_received_at = now;
    } else if (type === 'cv' || type.includes('resume')) {
      // Only mark CV if it's NOT a certificate
      updateFlags.cv_received = true;
      updateFlags.cv_received_at = now;
    } else if (type === 'photo' || type.includes('profile photo')) {
      updateFlags.photo_received = true;
      updateFlags.photo_received_at = now;
    }

    if (Object.keys(updateFlags).length > 0) {
      const { error: updateError } = await db
        .from('candidates')
        .update(updateFlags)
        .eq('id', data.candidate_id);
      
      if (updateError) {
        console.error(`[uploadDocument] Failed to update candidate flags for ${data.candidate_id}:`, updateError);
        throw new Error(`Flag update failed: ${updateError.message}`);
      } else {
        console.log(`[uploadDocument] Successfully updated flags for candidate ${data.candidate_id}:`, Object.keys(updateFlags));
      }
    } else {
      console.warn(`[uploadDocument] No flags to update for doc_type: ${data.doc_type}`);
    }
  } catch (flagError) {
    console.error('[uploadDocument] Failed to update candidate flags:', flagError);
    // Don't fail the upload if flag update fails - it will be recalculated by updateDocumentFlagsController
  }

  // =============================================================================
  // ALSO CREATE candidate_documents ENTRY AND TRIGGER AI VERIFICATION
  // This ensures documents uploaded via old endpoint also go through AI verification
  // =============================================================================
  try {
    const logService = new DocumentVerificationLogService();
    const requestId = generateRequestId();
    
    // Map doc_type to category
    const docTypeLower = data.doc_type.toLowerCase();
    let category: DocumentCategory | null = null;
    
    if (docTypeLower.includes('passport')) {
      category = DOCUMENT_CATEGORIES.PASSPORT;
    } else if (docTypeLower === 'cv' || docTypeLower.includes('resume')) {
      category = DOCUMENT_CATEGORIES.CV_RESUME;
    } else if (docTypeLower.includes('certificate') || docTypeLower.includes('degree') || docTypeLower.includes('diploma')) {
      category = DOCUMENT_CATEGORIES.CERTIFICATES;
    } else if (docTypeLower.includes('medical')) {
      category = DOCUMENT_CATEGORIES.MEDICAL_REPORTS;
    } else if (docTypeLower === 'photo' || docTypeLower.includes('profile photo')) {
      category = DOCUMENT_CATEGORIES.PHOTOS;
    }
    
    // Create candidate_documents entry
    const candidateDocData = {
      candidate_id: data.candidate_id,
      document_type: data.doc_type,
      category: category || DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      file_name: data.file_name,
      mime_type: data.mime_type,
      source: 'web',
      verification_status: VERIFICATION_STATUS.PENDING_AI,
      received_at: new Date().toISOString(),
    };
    
    const { data: candidateDoc, error: candidateDocError } = await db
      .from('candidate_documents')
      .insert(candidateDocData)
      .select()
      .single();
    
    if (candidateDocError) {
      console.error('[uploadDocument] Failed to create candidate_documents entry:', candidateDocError);
      // Don't fail the upload, but log the error
    } else {
      console.log(`[uploadDocument] Created candidate_documents entry ${candidateDoc.id} for AI verification`);
      
      // Log upload for verification tracking
      try {
        await logService.logUploadStarted(
          requestId,
          data.candidate_id,
          data.file_name,
          data.mime_type,
          data.buffer.length,
          userId
        );
        
        await logService.logUploadCompleted(
          requestId,
          candidateDoc.id,
          data.candidate_id,
          STORAGE_BUCKET,
          storagePath
        );
      } catch (logError) {
        console.error('[uploadDocument] Failed to log verification events:', logError);
      }
      
      // Enqueue AI verification job
      try {
        const jobData = {
          requestId,
          documentId: candidateDoc.id,
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
        
        console.log(`[uploadDocument] Enqueued AI verification job for document ${candidateDoc.id} (from old endpoint)`);
      } catch (queueError: any) {
        console.error('[uploadDocument] Failed to enqueue AI verification job:', queueError);
        // Don't fail the upload, but log the error
        try {
          await logService.logError(
            requestId,
            `Failed to enqueue AI job: ${queueError.message}`,
            queueError.stack,
            candidateDoc.id,
            data.candidate_id
          );
        } catch (logError) {
          console.error('[uploadDocument] Failed to log queue error:', logError);
        }
      }
    }
  } catch (verificationError: any) {
    console.error('[uploadDocument] Error setting up AI verification (non-fatal):', verificationError);
    // Don't fail the upload - document is already saved to documents table
  }

  return document;
}

/**
 * Get document by ID
 */
export async function getDocumentById(id: string, userId: string): Promise<Document> {
  const db = supabaseAdminClient();

  const { data, error } = await db
    .from('documents')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * List documents for a candidate
 */
export async function listCandidateDocuments(candidateId: string, userId: string): Promise<Document[]> {
  const db = supabaseAdminClient();

  const { data, error } = await db
    .from('documents')
    .select('*')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Get signed URL for document download
 */
export async function getDocumentSignedUrl(id: string, userId: string, expiresIn: number = 3600): Promise<string> {
  const db = supabaseAdminClient();

  // Get document record
  const document = await getDocumentById(id, userId);

  // Generate signed URL
  const { data: signedUrlData, error } = await db.storage
    .from(document.storage_bucket)
    .createSignedUrl(document.storage_path, expiresIn);

  if (error) {
    throw new Error(`Failed to generate signed URL: ${error.message}`);
  }

  return signedUrlData.signedUrl;
}

/**
 * Delete document (removes from storage and database)
 */
export async function deleteDocument(id: string, userId: string): Promise<void> {
  const db = supabaseAdminClient();

  // Get document record
  const document = await getDocumentById(id, userId);

  // Delete from storage
  const { error: storageError } = await db.storage
    .from(document.storage_bucket)
    .remove([document.storage_path]);

  if (storageError) {
    console.error('Failed to delete from storage:', storageError);
    // Continue with database deletion even if storage delete fails
  }

  // Delete from database
  const { error: dbError } = await db
    .from('documents')
    .delete()
    .eq('id', id);

  if (dbError) {
    throw new Error(`Failed to delete document record: ${dbError.message}`);
  }

  // Log timeline event
  try {
    await logDocumentDeleted(document.candidate_id, userId, {
      doc_type: document.doc_type,
      file_name: document.file_name,
    });
  } catch (timelineError) {
    console.error('Failed to log timeline event:', timelineError);
  }
}

/**
 * Download document buffer (for processing)
 */
export async function downloadDocument(id: string, userId: string): Promise<Buffer> {
  const db = supabaseAdminClient();

  // Get document record
  const document = await getDocumentById(id, userId);

  // Download from storage
  const { data, error } = await db.storage
    .from(document.storage_bucket)
    .download(document.storage_path);

  if (error) {
    throw new Error(`Failed to download file: ${error.message}`);
  }

  // Convert Blob to Buffer
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
