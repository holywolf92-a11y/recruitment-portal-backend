import dotenv from 'dotenv';
dotenv.config();

const { extractProfilePhotoHybrid, uploadExtractedPhotoToCandidatePhotos } = await import('../dist/services/hybridPhotoExtractionService.js');
const { supabaseAdminClient } = await import('../dist/config/database.js');

const candidateId = '713b6428-42e9-432c-bcb4-1170d6aab316';
const attachmentId = '306ffa8f-3b18-48c1-b7f0-e04e6961f4e9';
const STORAGE_BUCKET = 'documents';

const db = supabaseAdminClient();

// Download the PDF
const { data: attachmentMeta } = await db.from('inbox_attachments').select('storage_bucket, storage_path, file_name').eq('id', attachmentId).maybeSingle();
console.log('Attachment:', attachmentMeta?.file_name, 'Path:', attachmentMeta?.storage_path);

const download = await db.storage.from(attachmentMeta.storage_bucket || STORAGE_BUCKET).download(attachmentMeta.storage_path);
const fileBytes = Buffer.from(await download.data.arrayBuffer());
console.log('Downloaded PDF size:', fileBytes.length, 'bytes');

console.log('Attempting hybrid photo extraction...');
const hybridResult = await extractProfilePhotoHybrid(candidateId, attachmentId, fileBytes);
console.log('Hybrid result:', { success: hybridResult.success, method: hybridResult.method, hasBuffer: !!hybridResult.photoBuffer, size: hybridResult.photoBuffer?.length });

if (hybridResult.success && hybridResult.photoBuffer) {
  await uploadExtractedPhotoToCandidatePhotos(candidateId, attachmentId, hybridResult.photoBuffer);
  console.log('Photo uploaded successfully!');
} else {
  console.log('No photo found in CV (or extraction failed). This CV may not contain a headshot photo.');
}
