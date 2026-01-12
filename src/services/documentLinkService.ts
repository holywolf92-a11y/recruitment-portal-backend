import { supabaseAdminClient } from '../config/database';
import { AppError, ErrorType, createLogger } from '../utils/errorHandling';
import { DocumentClassifier, DocumentType } from './documentClassifier';
import { CandidateMatcher } from './candidateMatcher';

const logger = createLogger('DocumentLinkService');

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

    // Get inbox message for source info
    const { data: message } = await db
      .from('inbox_messages')
      .select('source')
      .eq('id', attachment.inbox_message_id)
      .single();

    const source = message?.source || 'unknown';
    const documentType = attachment.document_type || 'other';

    // Generate new storage path
    const newStoragePath = DocumentClassifier.generateStoragePath(
      candidateId,
      documentType,
      attachment.file_name
    );

    // Move file in storage
    await this.moveFileInStorage(
      attachment.storage_bucket,
      attachment.storage_path,
      newStoragePath
    );

    // Create candidate_documents record
    const { error: docError } = await db
      .from('candidate_documents')
      .insert({
        candidate_id: candidateId,
        inbox_attachment_id: attachment.id,
        document_type: documentType,
        storage_bucket: attachment.storage_bucket,
        storage_path: newStoragePath,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        source: source,
        received_at: attachment.received_at || new Date().toISOString()
      });

    if (docError) {
      logger.error('Failed to create candidate_documents record', docError);
      throw new AppError('Failed to link document', ErrorType.DATABASE, 500);
    }

    // Update inbox_attachments with link
    await db
      .from('inbox_attachments')
      .update({ 
        linked_candidate_id: candidateId,
        storage_path: newStoragePath
      })
      .eq('id', attachment.id);

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
    const messageId = message?.external_message_id || attachment.inbox_message_id;

    // Generate unmatched storage path
    const unmatchedPath = DocumentClassifier.generateUnmatchedPath(
      source,
      messageId,
      attachment.file_name
    );

    // Move file to unmatched area
    await this.moveFileInStorage(
      attachment.storage_bucket,
      attachment.storage_path,
      unmatchedPath
    );

    // Create unmatched_documents record
    const { error } = await db
      .from('unmatched_documents')
      .insert({
        inbox_attachment_id: attachment.id,
        document_type: attachment.document_type || 'unknown',
        storage_bucket: attachment.storage_bucket,
        storage_path: unmatchedPath,
        file_name: attachment.file_name,
        source: source,
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

    // Update inbox_attachments storage path
    await db
      .from('inbox_attachments')
      .update({ storage_path: unmatchedPath })
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

    // Delete old file
    const { error: deleteError } = await db.storage
      .from(bucket)
      .remove([oldPath]);

    if (deleteError) {
      logger.warn('Failed to delete old file after move', deleteError);
      // Non-fatal - file was copied successfully
    }

    logger.info(`File moved: ${oldPath} → ${newPath}`);
  }

  /**
   * Reconcile unmatched documents for a newly created candidate
   */
  async reconcileDocumentsForCandidate(candidateId: string): Promise<number> {
    const db = supabaseAdminClient();
    
    // Get candidate details
    const { data: candidate, error: candError } = await db
      .from('candidates')
      .select('email, phone, name, father_name, cnic_normalized')
      .eq('id', candidateId)
      .single();

    if (candError || !candidate) {
      logger.error('Candidate not found for reconciliation', { candidateId });
      return 0;
    }

    // Get pending unmatched documents
    const { data: unmatchedDocs, error: unmatchedError } = await db
      .from('unmatched_documents')
      .select('*')
      .eq('status', 'pending_link')
      .eq('needs_manual_review', false);

    if (unmatchedError || !unmatchedDocs || unmatchedDocs.length === 0) {
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
