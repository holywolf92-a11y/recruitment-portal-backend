import { supabaseAdminClient } from '../config/database';
import crypto from 'crypto';
import { logDocumentUploaded, logDocumentDeleted } from './timelineService';

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
    } else if (type === 'cv' || type.includes('resume')) {
      updateFlags.cv_received = true;
      updateFlags.cv_received_at = now;
    } else if (type === 'photo' || type.includes('profile photo')) {
      updateFlags.photo_received = true;
      updateFlags.photo_received_at = now;
    } else if (type === 'certificate' || type.includes('certificate')) {
      updateFlags.certificate_received = true;
      updateFlags.certificate_received_at = now;
    }

    if (Object.keys(updateFlags).length > 0) {
      await db
        .from('candidates')
        .update(updateFlags)
        .eq('id', data.candidate_id);
    }
  } catch (flagError) {
    console.error('Failed to update candidate flags:', flagError);
    // Don't fail the upload if flag update fails
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
