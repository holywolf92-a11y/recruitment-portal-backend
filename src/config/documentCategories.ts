/**
 * Document categorization configuration
 * Maps to document_category_enum in database
 */

export const DOCUMENT_CATEGORIES = {
  CV_RESUME: 'cv_resume',
  PASSPORT: 'passport',
  CERTIFICATES: 'certificates',
  CONTRACTS: 'contracts',
  MEDICAL_REPORTS: 'medical_reports',
  PHOTOS: 'photos',
  OTHER_DOCUMENTS: 'other_documents',
} as const;

export type DocumentCategory = typeof DOCUMENT_CATEGORIES[keyof typeof DOCUMENT_CATEGORIES];

export const DOCUMENT_CATEGORY_DISPLAY_NAMES: Record<DocumentCategory, string> = {
  [DOCUMENT_CATEGORIES.CV_RESUME]: 'CV / Resume',
  [DOCUMENT_CATEGORIES.PASSPORT]: 'Passport',
  [DOCUMENT_CATEGORIES.CERTIFICATES]: 'Certificates',
  [DOCUMENT_CATEGORIES.CONTRACTS]: 'Contracts',
  [DOCUMENT_CATEGORIES.MEDICAL_REPORTS]: 'Medical Reports',
  [DOCUMENT_CATEGORIES.PHOTOS]: 'Photos',
  [DOCUMENT_CATEGORIES.OTHER_DOCUMENTS]: 'Other Documents',
};

/**
 * Document verification status
 * Maps to document_verification_status_enum in database
 */
export const VERIFICATION_STATUS = {
  PENDING_AI: 'pending_ai',
  VERIFIED: 'verified',
  NEEDS_REVIEW: 'needs_review',
  REJECTED_MISMATCH: 'rejected_mismatch',
  FAILED: 'failed',
} as const;

export type VerificationStatus = typeof VERIFICATION_STATUS[keyof typeof VERIFICATION_STATUS];

/**
 * Verification reason codes
 */
export const VERIFICATION_REASON_CODES = {
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
} as const;

export type VerificationReasonCode = typeof VERIFICATION_REASON_CODES[keyof typeof VERIFICATION_REASON_CODES];

/**
 * Confidence threshold for auto-assignment
 */
export const AI_CONFIDENCE_THRESHOLD = 0.70;

/**
 * Minimum OCR confidence for text extraction
 */
export const MIN_OCR_CONFIDENCE = 0.50;
