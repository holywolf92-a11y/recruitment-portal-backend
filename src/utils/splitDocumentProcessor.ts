/**
 * Shared utility for processing split documents from Vision AI parser
 * Handles both PDF documents and extracted images (photos)
 */

import { supabaseAdminClient } from '../config/database';

const STORAGE_BUCKET = 'documents';

export interface ProcessedSplitDoc {
  storagePath: string;
  mimeType: string;
  fileExtension: string;
  isImage: boolean;
  shouldAutoVerify: boolean;
}

/**
 * Process a split document and handle profile photo extraction if applicable
 * Returns metadata about the processed document
 */
export async function processSplitDocument(
  splitDoc: {
    doc_type: string;
    pdf_base64: string;
    is_image?: boolean;
    mime_type?: string;
    pages?: number[];
  },
  candidateId: string,
  uploadId: string,
  folderPath: string
): Promise<ProcessedSplitDoc> {
  const db = supabaseAdminClient();
  const ts = Date.now();
  
  // Detect if this is an extracted image (not a PDF)
  const isImage = splitDoc.is_image === true;
  const mimeType = isImage ? (splitDoc.mime_type || 'image/jpeg') : 'application/pdf';
  const fileExtension = isImage ? (mimeType === 'image/png' ? 'png' : 'jpg') : 'pdf';
  
  const storagePath = `candidates/${candidateId}/${folderPath}/${ts}_${uploadId}_pages_${(splitDoc.pages || []).join('-')}.${fileExtension}`;
  const fileBuffer = Buffer.from(splitDoc.pdf_base64, 'base64');
  
  // If this is a photo image, save it as the candidate's profile photo
  if (isImage && (splitDoc.doc_type === 'photos' || splitDoc.doc_type === 'photo')) {
    await saveAsProfilePhoto(candidateId, fileBuffer, ts);
  }
  
  // Upload the document to storage
  const { error: uploadErr } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });
  
  if (uploadErr) {
    throw new Error(`Failed to upload split document: ${uploadErr.message}`);
  }
  
  // Photos should be auto-verified ONLY if they're actually image files (JPG/PNG)
  // Never auto-verify PDFs, even if marked as is_image
  const shouldAutoVerify = isImage && 
                           (splitDoc.doc_type === 'photos' || splitDoc.doc_type === 'photo') &&
                           (mimeType === 'image/jpeg' || mimeType === 'image/png');
  
  return {
    storagePath,
    mimeType,
    fileExtension,
    isImage,
    shouldAutoVerify,
  };
}

/**
 * Save extracted photo as candidate's profile photo
 */
async function saveAsProfilePhoto(
  candidateId: string,
  imageBuffer: Buffer,
  timestamp: number
): Promise<void> {
  const db = supabaseAdminClient();
  const profilePhotoPath = `candidates/${candidateId}/profile_photos/${timestamp}_extracted.jpg`;
  
  const { error: photoUploadErr } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(profilePhotoPath, imageBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  
  if (!photoUploadErr) {
    // Update candidate's profile photo fields
    await db
      .from('candidates')
      .update({
        profile_photo_bucket: STORAGE_BUCKET,
        profile_photo_path: profilePhotoPath,
        profile_photo_url: null,
        photo_received: true,
        photo_received_at: new Date().toISOString(),
      })
      .eq('id', candidateId);
    
    console.log(`[SplitDocProcessor] ✅ Saved profile photo for candidate ${candidateId}: ${profilePhotoPath}`);
  } else {
    console.error(`[SplitDocProcessor] Failed to save profile photo:`, photoUploadErr);
  }
}
