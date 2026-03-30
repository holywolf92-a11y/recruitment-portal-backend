import { supabaseAdminClient } from '../config/database';
import { AppError, ErrorType, createLogger } from '../utils/errorHandling';
import { DocumentClassifier, DocumentType } from './documentClassifier';
import { CandidateMatcher } from './candidateMatcher';
import crypto from 'crypto';
import { documentVerificationQueue } from '../config/queue';

const logger = createLogger('DocumentLinkService');

const CONSTRAINED_DOCUMENT_SOURCES = new Set([
  'gmail',
  'email',
  'whatsapp',
  'web',
  'api',
  'unknown',
  'manual',
]);

function normalizeDocumentRecordSource(source: string | null | undefined): string {
  const normalized = (source || 'unknown').toLowerCase();

  if (normalized === 'google_drive') {
    return 'web';
  }

  return CONSTRAINED_DOCUMENT_SOURCES.has(normalized) ? normalized : 'unknown';
}

interface LinkDocumentInput {
  attachmentId: string;
  extractedCnic?: string;
  extractedEmail?: string;
  extractedPhone?: string;
  extractedName?: string;
  extractedFatherName?: string;
}

/**
 * Service for linking supporting documents to candidates
 */
export class DocumentLinkService {
  
  /**
   * Process a supporting document attachment
   */
  async processDocument(input: LinkDocumentInput): Promise<void> {
    const db = supabaseAdminClient();
    
    // Get attachment details
    const { data: attachment, error: attachError } = await db
      .from('inbox_attachments')
      .select('*')
      .eq('id', input.attachmentId)
      .single();

    if (attachError || !attachment) {
      throw new AppError('Attachment not found', ErrorType.NOT_FOUND, 404);
    }

    logger.info(`Processing document: ${attachment.file_name}`, { attachmentId: input.attachmentId });

    // If the attachment already has a known candidate (e.g. WhatsApp conversation-bound), link deterministically.
    if (attachment.candidate_id) {
      await this.linkDocumentToCandidate(attachment, attachment.candidate_id);
      logger.info(`Document linked using attachment.candidate_id`, { attachmentId: input.attachmentId, candidateId: attachment.candidate_id });
      return;
    }

    // Try to match candidate
    const matchResult = await CandidateMatcher.findCandidate({
      cnic: input.extractedCnic,
      email: input.extractedEmail,
      phone: input.extractedPhone,
      name: input.extractedName,
      fatherName: input.extractedFatherName
    });

    if (matchResult.needsManualReview || matchResult.multipleMatches) {
      // Multiple matches or needs review - store as unmatched
      await this.createUnmatchedDocument(attachment, input, matchResult.reviewReasons || []);
      logger.warn(`Document needs manual review: ${attachment.file_name}`, matchResult);
      return;
    }

    if (matchResult.candidateId) {
      // Single clear match - link to candidate
      await this.linkDocumentToCandidate(attachment, matchResult.candidateId);
      logger.info(`Document linked to candidate: ${matchResult.candidateId}`, { 
        matchedBy: matchResult.matchedBy,
        confidence: matchResult.confidence 
      });
    } else {
      // No match yet - store as unmatched for later reconciliation
      await this.createUnmatchedDocument(attachment, input, ['No matching candidate found']);
      logger.info(`Document stored as unmatched: ${attachment.file_name}`);
    }
  }

  /**
   * Link document to candidate
   */
  private async linkDocumentToCandidate(attachment: any, candidateId: string): Promise<void> {
    const db = supabaseAdminClient();

    // Idempotency: if already linked once, do nothing.
    const { data: existingDoc } = await db
      .from('candidate_documents')
      .select('id')
      .eq('inbox_attachment_id', attachment.id)
      .limit(1);
    if (Array.isArray(existingDoc) && existingDoc.length > 0) {
      logger.info('Attachment already linked to candidate_documents (idempotent skip)', {
        attachmentId: attachment.id,
        candidateId,
        documentId: existingDoc[0]?.id,
      });
      return;
    }

    // Get inbox message for source info
    const { data: message } = await db
      .from('inbox_messages')
      .select('source')
      .eq('id', attachment.inbox_message_id)
      .single();

    const source = message?.source || 'unknown';
    const documentSource = normalizeDocumentRecordSource(source);
    const rawDocType = (attachment.document_type || '').toString().toLowerCase();
    const documentType = (rawDocType && rawDocType !== 'unknown' ? rawDocType : 'other') as DocumentType;

    // Generate new storage path
    const newStoragePath = DocumentClassifier.generateStoragePath(
      candidateId,
      documentType,
      attachment.file_name
    );

    // Move file in storage (copy; preserve original raw upload for audit)
    await this.moveFileInStorage(
      attachment.storage_bucket,
      attachment.storage_path,
      newStoragePath
    );

    // Create candidate_documents record
    const { data: createdDoc, error: docError } = await db
      .from('candidate_documents')
      .insert({
        candidate_id: candidateId,
        inbox_attachment_id: attachment.id,
        document_type: documentType,
        storage_bucket: attachment.storage_bucket,
        storage_path: newStoragePath,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        source: documentSource,
        received_at: attachment.received_at || new Date().toISOString()
      })
      .select('id,candidate_id,storage_bucket,storage_path,file_name,mime_type')
      .single();

    if (docError) {
      logger.error('Failed to create candidate_documents record', docError);
      throw new AppError('Failed to link document', ErrorType.DATABASE, 500);
    }

    // Update inbox_attachments with link
    await db
      .from('inbox_attachments')
      .update({ 
        linked_candidate_id: candidateId
      })
      .eq('id', attachment.id);

    // Enqueue AI verification for the linked document
    try {
      if (createdDoc?.id) {
        const requestId = crypto.randomUUID();
        await documentVerificationQueue.add(
          'verify',
          {
            requestId,
            documentId: createdDoc.id,
            candidateId: createdDoc.candidate_id,
            storageBucket: createdDoc.storage_bucket,
            storagePath: createdDoc.storage_path,
            fileName: createdDoc.file_name,
            mimeType: createdDoc.mime_type,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 200,
            removeOnFail: 200,
          }
        );
        logger.info('Enqueued document verification job', { documentId: createdDoc.id, candidateId: createdDoc.candidate_id });
      }
    } catch (enqueueErr) {
      logger.error('Failed to enqueue document verification (non-fatal)', {
        attachmentId: attachment.id,
        candidateId,
        error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
      });
    }

    logger.info(`Document linked successfully: ${attachment.id} → candidate ${candidateId}`);
  }

  /**
   * Store as unmatched document
   */
  private async createUnmatchedDocument(
    attachment: any, 
    input: LinkDocumentInput,
    reasons: string[]
  ): Promise<void> {
    const db = supabaseAdminClient();

    // Get inbox message for source
    const { data: message } = await db
      .from('inbox_messages')
      .select('source, external_message_id')
      .eq('id', attachment.inbox_message_id)
      .single();

    const source = message?.source || 'unknown';
    const documentSource = normalizeDocumentRecordSource(source);
    const messageId = message?.external_message_id || attachment.inbox_message_id;

    // Generate unmatched storage path
    const unmatchedPath = DocumentClassifier.generateUnmatchedPath(
      source,
      messageId,
      attachment.file_name
    );

    // Move file to unmatched area (only if not already there)
    // Files uploaded via web already go to unmatched_documents, so avoid unnecessary move
    const isAlreadyInUnmatchedLocation = attachment.storage_path.startsWith('unmatched_documents/');
    
    if (!isAlreadyInUnmatchedLocation) {
      await this.moveFileInStorage(
        attachment.storage_bucket,
        attachment.storage_path,
        unmatchedPath
      );
    } else {
      logger.info(`File already in unmatched location, skipping move: ${attachment.storage_path}`);
    }

    // Create unmatched_documents record (use actual storage path)
    const finalPath = isAlreadyInUnmatchedLocation ? attachment.storage_path : unmatchedPath;
    const { error } = await db
      .from('unmatched_documents')
      .insert({
        inbox_attachment_id: attachment.id,
        document_type: attachment.document_type || 'unknown',
        storage_bucket: attachment.storage_bucket,
        storage_path: finalPath,
        file_name: attachment.file_name,
        source: documentSource,
        extracted_email: input.extractedEmail,
        extracted_phone: input.extractedPhone,
        extracted_name: input.extractedName,
        extracted_father_name: input.extractedFatherName,
        extracted_cnic: input.extractedCnic,
        needs_manual_review: reasons.length > 0,
        review_reasons: reasons.length > 0 ? reasons : null,
        status: 'pending_link'
      });

    if (error) {
      logger.error('Failed to create unmatched_documents record', error);
      throw new AppError('Failed to store unmatched document', ErrorType.DATABASE, 500);
    }

    // Update inbox_attachments storage path (use current path if already in unmatched location)
    await db
      .from('inbox_attachments')
      .update({ storage_path: finalPath })
      .eq('id', attachment.id);
  }

  /**
   * Move file in Supabase Storage
   */
  private async moveFileInStorage(
    bucket: string,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    const db = supabaseAdminClient();

    // Copy file to new location
    const { error: copyError } = await db.storage
      .from(bucket)
      .copy(oldPath, newPath);

    if (copyError) {
      logger.error('Failed to copy file in storage', copyError);
      throw new AppError('Failed to move file', ErrorType.DATABASE, 500);
    }

    // Preserve original uploads for auditability (do not delete the old path).
    logger.info(`File copied (original preserved): ${oldPath} → ${newPath}`);
  }

  /**
   * Reconcile unmatched documents for a newly created candidate
   */
  async reconcileDocumentsForCandidate(candidateId: string): Promise<number> {
    const db = supabaseAdminClient();
    
    // Get candidate details
    const { data: candidate, error: candError } = await db
      .from('candidates')
      .select('id')
      .eq('id', candidateId)
      .single();

    if (candError || !candidate) {
      logger.error('Candidate not found for reconciliation', candError as any, { candidateId });
      return 0;
    }

    // Get pending unmatched documents
    const { data: unmatchedDocs, error: unmatchedError } = await db
      .from('unmatched_documents')
      .select('*')
      .eq('status', 'pending_link')
      .eq('needs_manual_review', false);

    if (unmatchedError) {
      logger.warn('Unable to load unmatched documents for reconciliation', {
        candidateId,
        error: (unmatchedError as any)?.message,
      });
      return 0;
    }

    if (!unmatchedDocs || unmatchedDocs.length === 0) {
      return 0;
    }

    let linkedCount = 0;

    for (const doc of unmatchedDocs) {
      // Try to match this document to our new candidate
      const matchResult = await CandidateMatcher.findCandidate({
        cnic: doc.extracted_cnic || undefined,
        email: doc.extracted_email || undefined,
        phone: doc.extracted_phone || undefined,
        name: doc.extracted_name || undefined,
        fatherName: doc.extracted_father_name || undefined
      });

      if (matchResult.candidateId === candidateId && !matchResult.needsManualReview) {
        // This document matches our candidate!
        const { data: attachment } = await db
          .from('inbox_attachments')
          .select('*')
          .eq('id', doc.inbox_attachment_id)
          .single();

        if (attachment) {
          await this.linkDocumentToCandidate(attachment, candidateId);
          
          // Update unmatched_documents status
          await db
            .from('unmatched_documents')
            .update({
              status: 'linked',
              linked_candidate_id: candidateId,
              linked_at: new Date().toISOString()
            })
            .eq('id', doc.id);

          linkedCount++;
        }
      }
    }

    logger.info(`Reconciled ${linkedCount} documents for candidate ${candidateId}`);
    return linkedCount;
  }
}
