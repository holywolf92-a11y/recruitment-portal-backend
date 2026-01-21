"use strict";
/**
 * Document categorization configuration
 * Maps to document_category_enum in database
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_OCR_CONFIDENCE = exports.AI_CONFIDENCE_THRESHOLD = exports.VERIFICATION_REASON_CODES = exports.VERIFICATION_STATUS = exports.DOCUMENT_CATEGORY_DISPLAY_NAMES = exports.DOCUMENT_CATEGORIES = void 0;
exports.DOCUMENT_CATEGORIES = {
    CV_RESUME: 'cv_resume',
    PASSPORT: 'passport',
    CERTIFICATES: 'certificates',
    CONTRACTS: 'contracts',
    MEDICAL_REPORTS: 'medical_reports',
    PHOTOS: 'photos',
    OTHER_DOCUMENTS: 'other_documents',
};
exports.DOCUMENT_CATEGORY_DISPLAY_NAMES = {
    [exports.DOCUMENT_CATEGORIES.CV_RESUME]: 'CV / Resume',
    [exports.DOCUMENT_CATEGORIES.PASSPORT]: 'Passport',
    [exports.DOCUMENT_CATEGORIES.CERTIFICATES]: 'Certificates',
    [exports.DOCUMENT_CATEGORIES.CONTRACTS]: 'Contracts',
    [exports.DOCUMENT_CATEGORIES.MEDICAL_REPORTS]: 'Medical Reports',
    [exports.DOCUMENT_CATEGORIES.PHOTOS]: 'Photos',
    [exports.DOCUMENT_CATEGORIES.OTHER_DOCUMENTS]: 'Other Documents',
};
/**
 * Document verification status
 * Maps to document_verification_status_enum in database
 */
exports.VERIFICATION_STATUS = {
    PENDING_AI: 'pending_ai',
    VERIFIED: 'verified',
    NEEDS_REVIEW: 'needs_review',
    REJECTED_MISMATCH: 'rejected_mismatch',
    FAILED: 'failed',
};
/**
 * Verification reason codes
 */
exports.VERIFICATION_REASON_CODES = {
    VERIFIED: 'VERIFIED',
    IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
    CNIC_MISMATCH: 'CNIC_MISMATCH',
    PASSPORT_MISMATCH: 'PASSPORT_MISMATCH',
    EMAIL_MISMATCH: 'EMAIL_MISMATCH',
    NAME_MISMATCH: 'NAME_MISMATCH',
    LOW_CONFIDENCE: 'LOW_CONFIDENCE',
    NO_ID_FOUND: 'NO_ID_FOUND',
    NO_TEXT_EXTRACTED: 'NO_TEXT_EXTRACTED',
    MULTIPLE_CANDIDATES: 'MULTIPLE_CANDIDATES',
    OCR_FAILED: 'OCR_FAILED',
    AI_PROCESSING_ERROR: 'AI_PROCESSING_ERROR',
};
/**
 * Confidence threshold for auto-assignment
 */
exports.AI_CONFIDENCE_THRESHOLD = 0.70;
/**
 * Minimum OCR confidence for text extraction
 */
exports.MIN_OCR_CONFIDENCE = 0.50;
