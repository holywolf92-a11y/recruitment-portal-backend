"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentVerificationLogService = exports.DocumentVerificationLogService = exports.LOG_EVENT_STATUS = exports.LOG_EVENT_TYPES = void 0;
exports.maskSensitiveData = maskSensitiveData;
exports.generateRequestId = generateRequestId;
const database_1 = require("../config/database");
const crypto_1 = __importDefault(require("crypto"));
/**
 * Event types for document verification logs
 */
exports.LOG_EVENT_TYPES = {
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
};
exports.LOG_EVENT_STATUS = {
    SUCCESS: 'success',
    FAILURE: 'failure',
    PENDING: 'pending',
};
/**
 * Mask sensitive data for privacy
 */
function maskSensitiveData(data) {
    const masked = { ...data };
    // Mask CNIC: 12345-1234567-1 → *****-*******-*
    if (masked.cnic) {
        const parts = masked.cnic.toString().split('-');
        if (parts.length === 3) {
            masked.cnic = `*****-*******-${parts[2].slice(-1)}`;
        }
        else {
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
        }
        else {
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
class DocumentVerificationLogService {
    constructor() {
        this.db = null;
    }
    getDb() {
        if (!this.db) {
            this.db = (0, database_1.supabaseAdminClient)();
        }
        return this.db;
    }
    /**
     * Create a new log entry
     */
    async log(logData) {
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
    async logUploadStarted(requestId, candidateId, fileName, mimeType, fileSizeBytes, uploadedBy) {
        return this.log({
            request_id: requestId,
            candidate_id: candidateId,
            uploaded_by_user_id: uploadedBy,
            event_type: exports.LOG_EVENT_TYPES.UPLOAD_STARTED,
            event_status: exports.LOG_EVENT_STATUS.PENDING,
            file_name: fileName,
            mime_type: mimeType,
            file_size_bytes: fileSizeBytes,
            upload_time: new Date().toISOString(),
        });
    }
    /**
     * Log upload completed event
     */
    async logUploadCompleted(requestId, documentId, candidateId, storageBucket, storagePath) {
        return this.log({
            request_id: requestId,
            document_id: documentId,
            candidate_id: candidateId,
            event_type: exports.LOG_EVENT_TYPES.UPLOAD_COMPLETED,
            event_status: exports.LOG_EVENT_STATUS.SUCCESS,
            storage_bucket: storageBucket,
            storage_path: storagePath,
        });
    }
    /**
     * Log AI scan started event
     */
    async logAIScanStarted(requestId, documentId, candidateId) {
        return this.log({
            request_id: requestId,
            document_id: documentId,
            candidate_id: candidateId,
            event_type: exports.LOG_EVENT_TYPES.AI_SCAN_STARTED,
            event_status: exports.LOG_EVENT_STATUS.PENDING,
            scan_start_time: new Date().toISOString(),
        });
    }
    /**
     * Log AI scan completed event
     */
    async logAIScanCompleted(requestId, documentId, candidateId, detectedCategory, confidence, ocrConfidence, extractedFields, rawAiResponse) {
        return this.log({
            request_id: requestId,
            document_id: documentId,
            candidate_id: candidateId,
            event_type: exports.LOG_EVENT_TYPES.AI_SCAN_COMPLETED,
            event_status: exports.LOG_EVENT_STATUS.SUCCESS,
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
    async logAIScanFailed(requestId, documentId, candidateId, errorMessage, errorStack, rejectionDetails) {
        return this.log({
            request_id: requestId,
            document_id: documentId,
            candidate_id: candidateId,
            event_type: exports.LOG_EVENT_TYPES.AI_SCAN_FAILED,
            event_status: exports.LOG_EVENT_STATUS.FAILURE,
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
    async logIdentityVerificationCompleted(requestId, documentId, candidateId, verificationStatus, reasonCode, mismatchFields, matchingResult, rejectionDetails) {
        return this.log({
            request_id: requestId,
            document_id: documentId,
            candidate_id: candidateId,
            event_type: exports.LOG_EVENT_TYPES.IDENTITY_VERIFICATION_COMPLETED,
            event_status: exports.LOG_EVENT_STATUS.SUCCESS,
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
    async logError(requestId, errorMessage, errorStack, documentId, candidateId, metadata) {
        return this.log({
            request_id: requestId,
            document_id: documentId,
            candidate_id: candidateId,
            event_type: exports.LOG_EVENT_TYPES.ERROR,
            event_status: exports.LOG_EVENT_STATUS.FAILURE,
            error_message: errorMessage,
            error_stack: errorStack,
            metadata,
        });
    }
    /**
     * Get logs by request ID (trace all events for a single upload)
     */
    async getLogsByRequestId(requestId) {
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
    async getLogsByDocumentId(documentId) {
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
    async getLogsByCandidateId(candidateId, limit = 50) {
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
exports.DocumentVerificationLogService = DocumentVerificationLogService;
// Export singleton instance
exports.documentVerificationLogService = new DocumentVerificationLogService();
/**
 * Generate a unique request ID for tracing
 */
function generateRequestId() {
    return crypto_1.default.randomUUID();
}
