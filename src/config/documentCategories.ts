/**
 * Document categorization configuration
 * Maps to document_category_enum in database
 */

export const DOCUMENT_CATEGORIES = {
  CV_RESUME: 'cv_resume',
  PASSPORT: 'passport',
  CNIC: 'cnic',
  DRIVING_LICENSE: 'driving_license',
  POLICE_CHARACTER_CERTIFICATE: 'police_character_certificate',
  EDUCATIONAL_DOCUMENTS: 'educational_documents',
  EXPERIENCE_CERTIFICATES: 'experience_certificates',
  NAVTTC_REPORTS: 'navttc_reports',
  CERTIFICATES: 'certificates', // Professional/IT certifications ONLY
  CONTRACTS: 'contracts',
  MEDICAL_REPORTS: 'medical_reports',
  PHOTOS: 'photos',
  OTHER_DOCUMENTS: 'other_documents',
} as const;

export type DocumentCategory = typeof DOCUMENT_CATEGORIES[keyof typeof DOCUMENT_CATEGORIES];

export const DOCUMENT_CATEGORY_DISPLAY_NAMES: Record<DocumentCategory, string> = {
  [DOCUMENT_CATEGORIES.CV_RESUME]: 'CV / Resume',
  [DOCUMENT_CATEGORIES.PASSPORT]: 'Passport',
  [DOCUMENT_CATEGORIES.CNIC]: 'CNIC (National ID)',
  [DOCUMENT_CATEGORIES.DRIVING_LICENSE]: 'Driving License',
  [DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE]: 'Police Character Certificate',
  [DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS]: 'Educational Documents',
  [DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES]: 'Experience Certificates',
  [DOCUMENT_CATEGORIES.NAVTTC_REPORTS]: 'NAVTTC Reports',
  [DOCUMENT_CATEGORIES.CERTIFICATES]: 'Professional Certificates',
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
 * Universal rejection reason codes applicable to all document types
 * These codes are used when documents are rejected or fail verification
 */
export const REJECTION_REASON_CODES = {
  // Identity Mismatch (All Documents)
  NAME_MISMATCH: 'NAME_MISMATCH',
  CNIC_MISMATCH: 'CNIC_MISMATCH',
  PASSPORT_MISMATCH: 'PASSPORT_MISMATCH',
  DOB_MISMATCH: 'DOB_MISMATCH',
  EMAIL_MISMATCH: 'EMAIL_MISMATCH',
  PHONE_MISMATCH: 'PHONE_MISMATCH',
  FATHER_NAME_MISMATCH: 'FATHER_NAME_MISMATCH',
  
  // Document-Specific Expiry (Passport, Medical, License, Certificate)
  EXPIRED_DOCUMENT: 'EXPIRED_DOCUMENT', // Generic expiry
  EXPIRED_PASSPORT: 'EXPIRED_PASSPORT',
  EXPIRED_MEDICAL: 'EXPIRED_MEDICAL',
  EXPIRED_LICENSE: 'EXPIRED_LICENSE',
  EXPIRED_CERTIFICATE: 'EXPIRED_CERTIFICATE',
  
  // Quality Issues (All Documents)
  LOW_OCR_CONFIDENCE: 'LOW_OCR_CONFIDENCE',
  UNREADABLE_DOCUMENT: 'UNREADABLE_DOCUMENT',
  BLURRED_IMAGE: 'BLURRED_IMAGE',
  POOR_QUALITY: 'POOR_QUALITY',
  
  // Security & Integrity (All Documents)
  DOCUMENT_TAMPERED: 'DOCUMENT_TAMPERED',
  PHOTO_MISMATCH: 'PHOTO_MISMATCH', // For ID documents
  SIGNATURE_MISMATCH: 'SIGNATURE_MISMATCH',
  
  // Processing Errors (All Documents)
  AI_PROCESSING_FAILED: 'AI_PROCESSING_FAILED',
  OCR_FAILED: 'OCR_FAILED',
  VISION_API_ERROR: 'VISION_API_ERROR',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  
  // Content Issues (Document-Specific)
  INVALID_FORMAT: 'INVALID_FORMAT', // Wrong document format
  WRONG_DOCUMENT_TYPE: 'WRONG_DOCUMENT_TYPE', // CV uploaded as passport, etc.
  INCOMPLETE_DOCUMENT: 'INCOMPLETE_DOCUMENT', // Missing pages/sections
  DUPLICATE_DOCUMENT: 'DUPLICATE_DOCUMENT', // Already exists
  
  // Matching Issues (All Documents)
  NO_ID_FOUND: 'NO_ID_FOUND', // No identity fields extracted
  MULTIPLE_CANDIDATES: 'MULTIPLE_CANDIDATES', // Matches multiple candidates
  CANDIDATE_NOT_FOUND: 'CANDIDATE_NOT_FOUND', // No matching candidate
  
  // CV-Specific
  CV_INCOMPLETE: 'CV_INCOMPLETE', // Missing required sections
  CV_FORMAT_ERROR: 'CV_FORMAT_ERROR',
  
  // Certificate-Specific
  CERTIFICATE_INVALID: 'CERTIFICATE_INVALID',
  ISSUING_AUTHORITY_MISMATCH: 'ISSUING_AUTHORITY_MISMATCH',
  
  // Medical-Specific
  MEDICAL_INVALID: 'MEDICAL_INVALID',
  MEDICAL_EXPIRED: 'MEDICAL_EXPIRED',
  
  // Generic
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  MANUAL_REVIEW_REQUIRED: 'MANUAL_REVIEW_REQUIRED',
} as const;

export type RejectionReasonCode = typeof REJECTION_REASON_CODES[keyof typeof REJECTION_REASON_CODES];

/**
 * Priority order for rejection codes (highest priority first)
 * When multiple mismatches exist, use the highest priority code
 * but keep all mismatches in mismatchFields array
 */
export const REJECTION_PRIORITY_ORDER: RejectionReasonCode[] = [
  REJECTION_REASON_CODES.CNIC_MISMATCH,
  REJECTION_REASON_CODES.PASSPORT_MISMATCH,
  REJECTION_REASON_CODES.DOB_MISMATCH,
  REJECTION_REASON_CODES.NAME_MISMATCH,
  REJECTION_REASON_CODES.EMAIL_MISMATCH,
  REJECTION_REASON_CODES.PHONE_MISMATCH,
  REJECTION_REASON_CODES.FATHER_NAME_MISMATCH,
];

/**
 * Rejection codes that cannot be overridden by regular admin
 * Require super_admin role for override
 */
export const NON_OVERRIDABLE_REJECTION_CODES: RejectionReasonCode[] = [
  REJECTION_REASON_CODES.DOCUMENT_TAMPERED,
  REJECTION_REASON_CODES.PHOTO_MISMATCH,
];

/**
 * Map rejection codes to human-readable messages
 * Document-type aware messages
 * 
 * @param code - Rejection reason code
 * @param documentCategory - Document category for context-aware messages
 * @param context - Additional context (extractedValue, candidateValue, fieldName, expiryDate)
 * @returns Human-readable rejection reason message
 */
export function getRejectionReasonMessage(
  code: RejectionReasonCode,
  documentCategory?: DocumentCategory,
  context?: {
    extractedValue?: string;
    candidateValue?: string;
    fieldName?: string;
    expiryDate?: string;
  }
): string {
  const category = documentCategory || DOCUMENT_CATEGORIES.OTHER_DOCUMENTS;
  const docType = DOCUMENT_CATEGORY_DISPLAY_NAMES[category] || 'Document';
  
  switch (code) {
    // Identity Mismatches
    case REJECTION_REASON_CODES.NAME_MISMATCH:
      return `${docType} name "${context?.extractedValue || 'N/A'}" does not match candidate name "${context?.candidateValue || 'N/A'}"`;
    
    case REJECTION_REASON_CODES.CNIC_MISMATCH:
      return `CNIC number in ${docType.toLowerCase()} does not match candidate's CNIC`;
    
    case REJECTION_REASON_CODES.PASSPORT_MISMATCH:
      return `Passport number in ${docType.toLowerCase()} does not match candidate's passport`;
    
    case REJECTION_REASON_CODES.DOB_MISMATCH:
      return `Date of birth in ${docType.toLowerCase()} does not match candidate's date of birth`;
    
    case REJECTION_REASON_CODES.EMAIL_MISMATCH:
      return `Email in ${docType.toLowerCase()} does not match candidate's email`;
    
    case REJECTION_REASON_CODES.PHONE_MISMATCH:
      return `Phone number in ${docType.toLowerCase()} does not match candidate's phone`;
    
    case REJECTION_REASON_CODES.FATHER_NAME_MISMATCH:
      return `Father's name in ${docType.toLowerCase()} does not match candidate's father's name`;
    
    // Expiry
    case REJECTION_REASON_CODES.EXPIRED_DOCUMENT:
      return `${docType} expired on ${context?.expiryDate || 'unknown date'}`;
    
    case REJECTION_REASON_CODES.EXPIRED_PASSPORT:
      return `Passport expired on ${context?.expiryDate || 'unknown date'}`;
    
    case REJECTION_REASON_CODES.EXPIRED_MEDICAL:
      return `Medical report expired on ${context?.expiryDate || 'unknown date'}`;
    
    case REJECTION_REASON_CODES.EXPIRED_LICENSE:
      return `Driving license expired on ${context?.expiryDate || 'unknown date'}`;
    
    case REJECTION_REASON_CODES.EXPIRED_CERTIFICATE:
      return `Certificate expired on ${context?.expiryDate || 'unknown date'}`;
    
    // Quality
    case REJECTION_REASON_CODES.LOW_OCR_CONFIDENCE:
      return `${docType} quality is too low for reliable text extraction`;
    
    case REJECTION_REASON_CODES.UNREADABLE_DOCUMENT:
      return `${docType} is unreadable or corrupted`;
    
    case REJECTION_REASON_CODES.BLURRED_IMAGE:
      return `${docType} image is blurred and cannot be processed`;
    
    case REJECTION_REASON_CODES.POOR_QUALITY:
      return `${docType} quality is insufficient for verification`;
    
    // Security
    case REJECTION_REASON_CODES.DOCUMENT_TAMPERED:
      return `${docType} shows signs of tampering or manipulation`;
    
    case REJECTION_REASON_CODES.PHOTO_MISMATCH:
      return `Photo in ${docType.toLowerCase()} does not match candidate's profile photo`;
    
    case REJECTION_REASON_CODES.SIGNATURE_MISMATCH:
      return `Signature in ${docType.toLowerCase()} does not match candidate's signature`;
    
    // Processing
    case REJECTION_REASON_CODES.AI_PROCESSING_FAILED:
      return `AI processing failed for ${docType.toLowerCase()}`;
    
    case REJECTION_REASON_CODES.OCR_FAILED:
      return `OCR extraction failed for ${docType.toLowerCase()}`;
    
    case REJECTION_REASON_CODES.VISION_API_ERROR:
      return `Vision API error while processing ${docType.toLowerCase()}`;
    
    case REJECTION_REASON_CODES.EXTRACTION_FAILED:
      return `Failed to extract data from ${docType.toLowerCase()}`;
    
    // Content
    case REJECTION_REASON_CODES.INVALID_FORMAT:
      return `${docType} format is invalid or unsupported`;
    
    case REJECTION_REASON_CODES.WRONG_DOCUMENT_TYPE:
      // User-friendly "not a passport" style messages per document type
      switch (category) {
        case DOCUMENT_CATEGORIES.PASSPORT:
          return 'This is not a passport. Please upload a valid passport document.';
        case DOCUMENT_CATEGORIES.CNIC:
          return 'This is not a CNIC / national ID. Please upload a valid CNIC document.';
        case DOCUMENT_CATEGORIES.DRIVING_LICENSE:
          return 'This is not a driving license. Please upload a valid driving license document.';
        case DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE:
          return 'This is not a police character certificate. Please upload a valid PCC document.';
        case DOCUMENT_CATEGORIES.CERTIFICATES:
          return 'This is not a certificate or degree. Please upload a valid certificate document.';
        case DOCUMENT_CATEGORIES.MEDICAL_REPORTS:
          return 'This is not a medical report. Please upload a valid medical certificate.';
        case DOCUMENT_CATEGORIES.PHOTOS:
          return 'This is not a valid photo. Please upload a clear profile photo.';
        case DOCUMENT_CATEGORIES.CV_RESUME:
          return 'This is not a CV or resume. Please upload a valid CV/resume document.';
        default:
          return `Document type mismatch: expected ${docType.toLowerCase()}, got different type`;
      }
    
    case REJECTION_REASON_CODES.INCOMPLETE_DOCUMENT:
      return `${docType} is incomplete or missing required sections`;
    
    case REJECTION_REASON_CODES.DUPLICATE_DOCUMENT:
      return `Duplicate ${docType.toLowerCase()} already exists for this candidate`;
    
    // Matching
    case REJECTION_REASON_CODES.NO_ID_FOUND:
      return `No identity fields found in ${docType.toLowerCase()}`;
    
    case REJECTION_REASON_CODES.MULTIPLE_CANDIDATES:
      return `${docType} matches multiple candidates`;
    
    case REJECTION_REASON_CODES.CANDIDATE_NOT_FOUND:
      return `No matching candidate found for ${docType.toLowerCase()}`;
    
    // CV-Specific
    case REJECTION_REASON_CODES.CV_INCOMPLETE:
      return `CV is missing required sections`;
    
    case REJECTION_REASON_CODES.CV_FORMAT_ERROR:
      return `CV format error or unsupported structure`;
    
    // Certificate-Specific
    case REJECTION_REASON_CODES.CERTIFICATE_INVALID:
      return `Certificate is invalid or not recognized`;
    
    case REJECTION_REASON_CODES.ISSUING_AUTHORITY_MISMATCH:
      return `Issuing authority does not match expected authority`;
    
    // Medical-Specific
    case REJECTION_REASON_CODES.MEDICAL_INVALID:
      return `Medical report is invalid or not recognized`;
    
    case REJECTION_REASON_CODES.MEDICAL_EXPIRED:
      return `Medical report has expired`;
    
    // Generic
    case REJECTION_REASON_CODES.LOW_CONFIDENCE:
      return `Low confidence in ${docType.toLowerCase()} verification`;
    
    case REJECTION_REASON_CODES.MANUAL_REVIEW_REQUIRED:
      return `${docType} requires manual review`;
    
    default:
      return `${docType} verification failed: ${code}`;
  }
}

/**
 * Check if a rejection code can be overridden by regular admin
 * Returns true if overridable, false if requires super_admin
 */
export function isRejectionOverridable(rejectionCode: RejectionReasonCode): boolean {
  return !NON_OVERRIDABLE_REJECTION_CODES.includes(rejectionCode);
}

/**
 * Get required role for override
 * Returns 'super_admin' for non-overridable codes, 'admin' otherwise
 */
export function getRequiredOverrideRole(rejectionCode: RejectionReasonCode): 'admin' | 'super_admin' {
  return isRejectionOverridable(rejectionCode) ? 'admin' : 'super_admin';
}

/**
 * Confidence threshold for auto-assignment
 */
export const AI_CONFIDENCE_THRESHOLD = 0.70;

/**
 * Minimum OCR confidence for text extraction
 */
export const MIN_OCR_CONFIDENCE = 0.50;
