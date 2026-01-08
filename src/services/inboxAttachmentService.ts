import { supabaseAdminClient } from '../config/database';
import { AppError, ErrorType, NotFoundError, createLogger } from '../utils/errorHandling';
import { hashFile } from '../utils/hashing';
import { memCreateAttachment, memListAttachmentsForMessage, memDeleteAttachment } from './inboxMemory';

const logger = createLogger('InboxAttachmentService');

export interface InboxAttachmentCreateInput {
  inboxMessageId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType?: string;
  attachmentType?: string; // e.g., cv, document, form
  storageBucket: string;
  storagePath: string;
  candidateId?: string;
}

export async function createAttachment(input: InboxAttachmentCreateInput) {
  if (!input.inboxMessageId) throw new AppError('inboxMessageId is required', ErrorType.VALIDATION, 400);
  if (!input.fileBuffer || input.fileBuffer.length === 0) throw new AppError('fileBuffer is required', ErrorType.VALIDATION, 400);
  if (!input.fileName) throw new AppError('fileName is required', ErrorType.VALIDATION, 400);
  if (!input.storageBucket) throw new AppError('storageBucket is required', ErrorType.VALIDATION, 400);
  if (!input.storagePath) throw new AppError('storagePath is required', ErrorType.VALIDATION, 400);

  const sha256 = hashFile(input.fileBuffer);
  try {
    const db = supabaseAdminClient();

    // Pre-check for duplicates when DB is accessible
    if (input.attachmentType === 'cv' && sha256) {
      const { data: exists, error: checkErr } = await db
        .from('inbox_attachments')
        .select('id')
        .eq('sha256', sha256)
        .eq('attachment_type', 'cv')
        .limit(1);
      if (!checkErr && Array.isArray(exists) && exists.length > 0) {
        throw new AppError('Duplicate attachment (sha256 + type)', ErrorType.DUPLICATE, 409);
      }
    }
    const { data, error } = await db
      .from('inbox_attachments')
      .insert({
        inbox_message_id: input.inboxMessageId,
        candidate_id: input.candidateId ?? null,
        storage_bucket: input.storageBucket,
        storage_path: input.storagePath,
        file_name: input.fileName,
        mime_type: input.mimeType ?? null,
        sha256,
        attachment_type: input.attachmentType ?? 'cv',
      })
      .select()
      .single();

    if (error) {
      const msg = String(error.message || '');
      const code = (error as any).code || '';
      // Robust duplicate detection for Postgres unique violations
      if (code === '23505' || /duplicate key|unique constraint|already exists/i.test(msg)) {
        throw new AppError('Duplicate attachment (sha256 + type)', ErrorType.DUPLICATE, 409);
      }
      throw error;
    }
    return data;
  } catch (err: any) {
    // If we already classified as duplicate, surface it without falling back
    if (err instanceof AppError && err.type === ErrorType.DUPLICATE) {
      throw err;
    }

    // Try robust duplicate detection on raw error blob
    const raw = JSON.stringify(err || {});
    if (/23505|duplicate key|unique constraint|uq_inboxattachments_sha256_type/i.test(raw)) {
      throw new AppError('Duplicate attachment (sha256 + type)', ErrorType.DUPLICATE, 409);
    }

    // Heuristic: only fallback to memory if the inboxMessageId looks like a memory ID
    if (input.inboxMessageId.startsWith('msg_')) {
      logger.warn('Falling back to memory createAttachment due to DB error (memory messageId detected)');
      return memCreateAttachment({
      inboxMessageId: input.inboxMessageId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      attachmentType: input.attachmentType,
      storageBucket: input.storageBucket,
      storagePath: input.storagePath,
      sha256,
      candidateId: input.candidateId,
      });
    }

    // Otherwise treat as DB error to avoid incorrect 404 from memory fallback
    throw new AppError('Failed to create attachment (database error)', ErrorType.DATABASE, 500);
  }
}

export async function listAttachmentsForMessage(messageId: string) {
  try {
    const db = supabaseAdminClient();
    const { data, error } = await db
      .from('inbox_attachments')
      .select('*')
      .eq('inbox_message_id', messageId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }
    return data;
  } catch (err) {
    logger.warn('Falling back to memory listAttachmentsForMessage due to DB error');
    return memListAttachmentsForMessage(messageId);
  }
}

export async function deleteAttachment(id: string) {
  try {
    const db = supabaseAdminClient();
    const { data, error } = await db
      .from('inbox_attachments')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.details?.includes('Results contain 0 rows')) {
        throw new NotFoundError('Inbox attachment');
      }
      throw error;
    }
    return data;
  } catch (err) {
    logger.warn('Falling back to memory deleteAttachment due to DB error');
    return memDeleteAttachment(id);
  }
}
