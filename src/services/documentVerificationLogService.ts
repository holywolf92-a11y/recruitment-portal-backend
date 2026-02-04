import { supabaseAdminClient } from '../config/database';
import { VerificationStatus, RejectionReasonCode, DocumentCategory } from '../config/documentCategories';
import crypto from 'crypto';

/**
 * Event types for document verification logs
 */
export const LOG_EVENT_TYPES = {
  UPLOAD_STARTED: 'upload_started',
  UPLOAD_COMPLETED: 'upload_completed',
  AI_SCAN_STARTED: 'ai_scan_started',
  AI_SCAN_COMPLETED: 'ai_scan_completed',
  AI_SCAN_FAILED: 'ai_scan_failed',
  IDENTITY_VERIFICATION_STARTED: 'identity_verification_started',
  IDENTITY_VERIFICATION_COMPLETED: 'identity_verification_completed',
  VERIFICATION_STATUS_CHANGED: 'verification_status_changed',
  MANUAL_REVIEW_REQUESTED: 'manual_review_requested',
  MANUAL_REVIEW_COMPLETED: 'manual_review_completed',
  ERROR: 'error',
} as const;

export type LogEventType = typeof LOG_EVENT_TYPES[keyof typeof LOG_EVENT_TYPES];

export const LOG_EVENT_STATUS = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  PENDING: 'pending',
} as const;

export type LogEventStatus = typeof LOG_EVENT_STATUS[keyof typeof LOG_EVENT_STATUS];

/**
 * Document verification log entry
 */
export interface DocumentVerificationLog {
  id: string;
  request_id: string;
  candidate_id?: string;
  document_id?: string;
  uploaded_by_user_id?: string;
  event_type: LogEventType;
  event_status?: LogEventStatus;
  file_name?: string;
  mime_type?: string;
  file_size_bytes?: number;
  storage_bucket?: string;
  storage_path?: string;
  detected_category?: DocumentCategory;
  confidence?: number;
  ocr_confidence?: number;
  extracted_fields?: Record<string, any>;
  verification_status?: VerificationStatus;
  reason_code?: RejectionReasonCode | string; // Legacy field
  mismatch_fields?: string[];
  matching_result?: Record<string, any>;
  raw_ai_response?: Record<string, any>;
  error_message?: string;
  error_stack?: string;
  created_at?: string;
  upload_time?: string;
  scan_start_time?: string;
  scan_end_time?: string;
  verify_time?: string;
  metadata?: Record<string, any>;
  // New rejection details (from migration 017)
  rejection_code?: string | null;
  rejection_reason?: string | null;
  error_stage?: 'OCR' | 'Vision' | 'Matching' | 'Extraction' | 'Categorization' | null;
  retry_possible?: boolean | null;
  retry_count?: number | null;
  max_retries?: number | null;
  document_expiry_date?: string | null;
  rejection_context?: Record<string, any> | null;
}

/**
 * Mask sensitive data for privacy
 */
export function maskSensitiveData(data: Record<string, any>): Record<string, any> {
  const masked = { ...data };

  // Mask CNIC: 12345-1234567-1 → *****-*******-*
  if (masked.cnic) {
    const parts = masked.cnic.toString().split('-');
    if (parts.length === 3) {
      masked.cnic = `*****-*******-${parts[2].slice(-1)}`;
    } else {
      masked.cnic = '*****-*******-*';
    }
  }

  // Mask passport: AB1234567 → ****4567
  if (masked.passport_no) {
    const passport = masked.passport_no.toString();
    masked.passport_no = `****${passport.slice(-4)}`;
  }

  // Mask email: user@example.com → u***@e***
  if (masked.email) {
    const email = masked.email.toString();
    const [local, domain] = email.split('@');
    if (local && domain) {
      masked.email = `${local[0]}***@${domain[0]}***`;
    } else {
      masked.email = '***@***';
    }
  }

  // Mask phone: +92 300 1234567 → ***1234567 (keep last 7 digits)
  if (masked.phone) {
    const phone = masked.phone.toString().replace(/\D/g, '');
    masked.phone = `***${phone.slice(-7)}`;
  }

  return masked;
}

/**
 * Service for logging document verification events
 */
export class DocumentVerificationLogService {
  private db: ReturnType<typeof supabaseAdminClient> | null = null;

  private getDb() {
    if (!this.db) {
      this.db = supabaseAdminClient();
    }
    return this.db;
  }

  /**
   * Create a new log entry
   */
  async log(logData: Omit<DocumentVerificationLog, 'id' | 'created_at'>): Promise<DocumentVerificationLog> {
    // Mask sensitive fields if provided
    const maskedExtractedFields = logData.extracted_fields
      ? maskSensitiveData(logData.extracted_fields)
      : undefined;

    const { data, error } = await this.getDb()
      .from('document_verification_logs')
      .insert({
        ...logData,
        extracted_fields: maskedExtractedFields,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to create verification log:', error);
      throw new Error(`Failed to log verification event: ${error.message}`);
    }

    return data;
  }

  /**
   * Log upload started event
   */
  async logUploadStarted(
    requestId: string,
    candidateId: string,
    fileName: string,
    mimeType: string,
    fileSizeBytes: number,
    uploadedBy?: string
  ): Promise<DocumentVerificationLog> {
    return this.log({
      request_id: requestId,
      candidate_id: candidateId,
      uploaded_by_user_id: uploadedBy,
      event_type: LOG_EVENT_TYPES.UPLOAD_STARTED,
      event_status: LOG_EVENT_STATUS.PENDING,
      file_name: fileName,
      mime_type: mimeType,
      file_size_bytes: fileSizeBytes,
      upload_time: new Date().toISOString(),
    });
  }

  /**
   * Log upload completed event
   */
  async logUploadCompleted(
    requestId: string,
    documentId: string,
    candidateId: string,
    storageBucket: string,
    storagePath: string
  ): Promise<DocumentVerificationLog> {
    return this.log({
      request_id: requestId,
      document_id: documentId,
      candidate_id: candidateId,
      event_type: LOG_EVENT_TYPES.UPLOAD_COMPLETED,
      event_status: LOG_EVENT_STATUS.SUCCESS,
      storage_bucket: storageBucket,
      storage_path: storagePath,
    });
  }

  /**
   * Log AI scan started event
   */
  async logAIScanStarted(requestId: string, documentId: string, candidateId: string): Promise<DocumentVerificationLog> {
    return this.log({
      request_id: requestId,
      document_id: documentId,
      candidate_id: candidateId,
      event_type: LOG_EVENT_TYPES.AI_SCAN_STARTED,
      event_status: LOG_EVENT_STATUS.PENDING,
      scan_start_time: new Date().toISOString(),
    });
  }

  /**
   * Log AI scan completed event
   */
  async logAIScanCompleted(
    requestId: string,
    documentId: string,
    candidateId: string,
    detectedCategory: DocumentCategory,
    confidence: number,
    ocrConfidence: number,
    extractedFields: Record<string, any>,
    rawAiResponse?: Record<string, any>
  ): Promise<DocumentVerificationLog> {
    return this.log({
      request_id: requestId,
      document_id: documentId,
      candidate_id: candidateId,
      event_type: LOG_EVENT_TYPES.AI_SCAN_COMPLETED,
      event_status: LOG_EVENT_STATUS.SUCCESS,
      detected_category: detectedCategory,
      confidence,
      ocr_confidence: ocrConfidence,
      extracted_fields: extractedFields,
      raw_ai_response: rawAiResponse,
      scan_end_time: new Date().toISOString(),
    });
  }

  /**
   * Log AI scan failed event with rejection details
   */
  async logAIScanFailed(
    requestId: string,
    documentId: string,
    candidateId: string,
    errorMessage: string,
    errorStack?: string,
    rejectionDetails?: {
      rejection_code?: string;
      rejection_reason?: string;
      error_stage?: 'OCR' | 'Vision' | 'Matching' | 'Extraction' | 'Categorization';
      retry_possible?: boolean;
      retry_count?: number;
      max_retries?: number;
      rejection_context?: Record<string, any>;
    }
  ): Promise<DocumentVerificationLog> {
    return this.log({
      request_id: requestId,
      document_id: documentId,
      candidate_id: candidateId,
      event_type: LOG_EVENT_TYPES.AI_SCAN_FAILED,
      event_status: LOG_EVENT_STATUS.FAILURE,
      error_message: errorMessage,
      error_stack: errorStack,
      scan_end_time: new Date().toISOString(),
      // Include rejection details if provided
      rejection_code: rejectionDetails?.rejection_code || null,
      rejection_reason: rejectionDetails?.rejection_reason || null,
      error_stage: rejectionDetails?.error_stage || null,
      retry_possible: rejectionDetails?.retry_possible ?? false,
      retry_count: rejectionDetails?.retry_count ?? 0,
      max_retries: rejectionDetails?.max_retries ?? 2,
      rejection_context: rejectionDetails?.rejection_context || null,
    });
  }

  /**
   * Log identity verification completed event with detailed rejection information
   */
  async logIdentityVerificationCompleted(
    requestId: string,
    documentId: string,
    candidateId: string,
    verificationStatus: VerificationStatus,
    reasonCode?: RejectionReasonCode | string,
    mismatchFields?: string[],
    matchingResult?: Record<string, any>,
    rejectionDetails?: {
      rejection_code?: string;
      rejection_reason?: string;
      error_stage?: 'OCR' | 'Vision' | 'Matching' | 'Extraction' | 'Categorization';
      retry_possible?: boolean;
      retry_count?: number;
      max_retries?: number;
      document_expiry_date?: string;
      rejection_context?: Record<string, any>;
    }
  ): Promise<DocumentVerificationLog> {
    return this.log({
      request_id: requestId,
      document_id: documentId,
      candidate_id: candidateId,
      event_type: LOG_EVENT_TYPES.IDENTITY_VERIFICATION_COMPLETED,
      event_status: LOG_EVENT_STATUS.SUCCESS,
      verification_status: verificationStatus,
      reason_code: reasonCode, // Legacy field for backward compatibility
      mismatch_fields: mismatchFields,
      matching_result: matchingResult,
      verify_time: new Date().toISOString(),
      // Include detailed rejection information if provided
      rejection_code: rejectionDetails?.rejection_code || null,
      rejection_reason: rejectionDetails?.rejection_reason || null,
      error_stage: rejectionDetails?.error_stage || null,
      retry_possible: rejectionDetails?.retry_possible ?? false,
      retry_count: rejectionDetails?.retry_count ?? 0,
      max_retries: rejectionDetails?.max_retries ?? 2,
      document_expiry_date: rejectionDetails?.document_expiry_date || null,
      rejection_context: rejectionDetails?.rejection_context || null,
    });
  }

  /**
   * Log error event
   */
  async logError(
    requestId: string,
    errorMessage: string,
    errorStack?: string,
    documentId?: string,
    candidateId?: string,
    metadata?: Record<string, any>
  ): Promise<DocumentVerificationLog> {
    return this.log({
      request_id: requestId,
      document_id: documentId,
      candidate_id: candidateId,
      event_type: LOG_EVENT_TYPES.ERROR,
      event_status: LOG_EVENT_STATUS.FAILURE,
      error_message: errorMessage,
      error_stack: errorStack,
      metadata,
    });
  }

  /**
   * Get logs by request ID (trace all events for a single upload)
   */
  async getLogsByRequestId(requestId: string): Promise<DocumentVerificationLog[]> {
    const { data, error } = await this.getDb()
      .from('document_verification_logs')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch logs: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get logs by document ID
   */
  async getLogsByDocumentId(documentId: string): Promise<DocumentVerificationLog[]> {
    // First, get one log with document_id to find the request_id
    // This includes upload_started which is logged before document_id exists
    const { data: docLog, error: docLogError } = await this.getDb()
      .from('document_verification_logs')
      .select('request_id')
      .eq('document_id', documentId)
      .limit(1)
      .single();

    if (docLogError || !docLog) {
      // If no logs found with document_id, return empty array
      return [];
    }

    const requestId = docLog.request_id;

    // Get all logs with this request_id (includes upload_started which has no document_id)
    const { data: allLogs, error: allLogsError } = await this.getDb()
      .from('document_verification_logs')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });

    if (allLogsError) {
      throw new Error(`Failed to fetch logs: ${allLogsError.message}`);
    }

    return allLogs || [];
  }

  /**
   * Get logs by candidate ID
   */
  async getLogsByCandidateId(candidateId: string, limit: number = 50): Promise<DocumentVerificationLog[]> {
    const { data, error } = await this.getDb()
      .from('document_verification_logs')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch logs: ${error.message}`);
    }

    return data || [];
  }
}

// Export singleton instance
export const documentVerificationLogService = new DocumentVerificationLogService();

/**
 * Generate a unique request ID for tracing
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}
