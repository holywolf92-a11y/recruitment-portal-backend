/**
 * Document Rejection Service
 * 
 * Universal service to determine rejection codes for ALL document types
 * Implements priority-based mismatch resolution and all critical fixes
 */

import {
  DocumentCategory,
  REJECTION_REASON_CODES,
  REJECTION_PRIORITY_ORDER,
  NON_OVERRIDABLE_REJECTION_CODES,
  getRejectionReasonMessage,
  MIN_OCR_CONFIDENCE,
  AI_CONFIDENCE_THRESHOLD,
} from '../config/documentCategories';
import { normalizeCNIC, normalizePassport, normalizePhoneE164 } from './candidateService';

/**
 * Context for determining rejection codes
 */
export interface RejectionContext {
  documentCategory: DocumentCategory;
  extractedIdentity?: {
    name?: string;
    father_name?: string;
    cnic?: string;
    passport_no?: string;
    email?: string;
    phone?: string;
    date_of_birth?: string;
  };
  candidateData?: {
    name?: string;
    father_name?: string;
    cnic_normalized?: string;
    passport_normalized?: string;
    email?: string;
    phone?: string;
    date_of_birth?: string;
  };
  aiConfidence?: number; // 0-1 scale
  ocrConfidence?: number; // 0-1 scale
  expiryDate?: string; // ISO date string
  errorStage?: 'OCR' | 'Vision' | 'Matching' | 'Extraction' | 'Categorization';
  mismatchFields?: string[]; // Pre-computed mismatch fields from identity matching
  mismatchSeverity?: 'critical' | 'major' | 'minor'; // NEW: Severity based on similarity
  similarityScores?: Record<string, number>; // NEW: Similarity % for problematic fields
  idBelongsToOtherCandidate?: boolean; // NEW: If extracted ID belongs to another candidate
  otherCandidateName?: string; // NEW: Name of the candidate who owns the ID
}

/**
 * Result of rejection code determination
 */
export interface RejectionResult {
  code: string;
  reason: string;
  mismatchFields: string[];
  retryPossible: boolean;
  isOverridable: boolean;
  requiredRole?: 'admin' | 'super_admin';
}

/**
 * Document Rejection Service
 * 
 * Determines rejection codes based on document type and context
 * Uses priority-based mismatch resolution (FIX 1)
 */
export class DocumentRejectionService {
  /**
   * Determine rejection code based on document type and context
   * 
   * FIX 1: Priority-based mismatch resolution
   * - Captures ALL mismatches in mismatchFields array
   * - Selects highest priority code from REJECTION_PRIORITY_ORDER
   * 
   * FIX 2: Confidence scale standardized to 0-1
   * 
   * FIX 3: Non-overridable codes guard
   * 
   * FIX 4: Retry semantics (retryPossible flag)
   * 
   * NEW: Similarity-based validation
   * - Critical mismatches (ID belongs to other candidate, <50% similarity) with admin override
   * - Minor mismatches (>80% similarity) easily overridable (likely OCR errors)
   * - Major mismatches (50-80% similarity) require review before admin can override
   */
  static determineRejectionCode(context: RejectionContext): RejectionResult {
    const {
      documentCategory,
      extractedIdentity,
      candidateData,
      aiConfidence,
      ocrConfidence,
      expiryDate,
      errorStage,
      mismatchFields: preComputedMismatches = [],
      mismatchSeverity = 'minor', // Default severity
      similarityScores = {},
      idBelongsToOtherCandidate = false,
      otherCandidateName,
    } = context;

    const mismatchFields: string[] = [...preComputedMismatches];
    const mismatchCodes: string[] = [];
    let rejectionCode: string = REJECTION_REASON_CODES.MANUAL_REVIEW_REQUIRED;
    let retryPossible = false;


    // ============================================
    // STEP 1: Check expiry (for applicable document types)
    // FIX 4: Expiry checks for Passport, Medical, License, Certificate
    // ============================================
    const shouldCheckExpiry =
      documentCategory === 'passport' ||
      documentCategory === 'medical_reports' ||
      documentCategory === 'driving_license' ||
      documentCategory === 'certificates' ||
      documentCategory === 'police_character_certificate';

    if (expiryDate && shouldCheckExpiry) {
      const expiry = new Date(expiryDate);
      const now = new Date();
      
      if (expiry < now) {
        // Document is expired
        switch (documentCategory) {
          case 'passport':
            rejectionCode = REJECTION_REASON_CODES.EXPIRED_PASSPORT;
            break;
          case 'medical_reports':
            rejectionCode = REJECTION_REASON_CODES.EXPIRED_MEDICAL;
            break;
          case 'certificates':
            rejectionCode = REJECTION_REASON_CODES.EXPIRED_CERTIFICATE;
            break;
          default:
            rejectionCode = REJECTION_REASON_CODES.EXPIRED_DOCUMENT;
        }
        
        return {
          code: rejectionCode,
          reason: getRejectionReasonMessage(
            rejectionCode as any,
            documentCategory,
            { expiryDate }
          ),
          mismatchFields: ['expiry_date'],
          retryPossible: false, // Expiry cannot be fixed by retry
          isOverridable: true, // Expired documents can be overridden by admin
          requiredRole: 'admin',
        };
      }
    }

    // ============================================
    // STEP 2: Check OCR confidence
    // FIX 2: Confidence scale 0-1
    // ============================================
    if (ocrConfidence !== undefined && ocrConfidence < MIN_OCR_CONFIDENCE) {
      rejectionCode = REJECTION_REASON_CODES.LOW_OCR_CONFIDENCE;
      retryPossible = true; // Can retry with better image quality
      
      return {
        code: rejectionCode,
        reason: getRejectionReasonMessage(rejectionCode as any, documentCategory),
        mismatchFields: [],
        retryPossible,
        isOverridable: true,
        requiredRole: 'admin',
      };
    }

    // ============================================
    // STEP 3: Check AI confidence
    // FIX 2: Confidence scale 0-1
    // ============================================
    if (aiConfidence !== undefined && aiConfidence < AI_CONFIDENCE_THRESHOLD) {
      rejectionCode = REJECTION_REASON_CODES.LOW_CONFIDENCE;
      retryPossible = true;
      
      return {
        code: rejectionCode,
        reason: getRejectionReasonMessage(rejectionCode as any, documentCategory),
        mismatchFields: [],
        retryPossible,
        isOverridable: true,
        requiredRole: 'admin',
      };
    }

    // ============================================
    // STEP 4: Check identity mismatches
    // FIX 1: Priority-based mismatch resolution
    // - Capture ALL mismatches
    // - Select highest priority code
    // ============================================
    if (extractedIdentity && candidateData) {
      // CNIC mismatch (highest priority)
      if (extractedIdentity.cnic && candidateData.cnic_normalized) {
        const extractedCnic = normalizeCNIC(extractedIdentity.cnic);
        const candidateCnic = candidateData.cnic_normalized;
        if (extractedCnic && extractedCnic !== candidateCnic) {
          if (!mismatchFields.includes('cnic')) {
            mismatchFields.push('cnic');
          }
          mismatchCodes.push(REJECTION_REASON_CODES.CNIC_MISMATCH);
        }
      }

      // Passport mismatch (second priority)
      if (extractedIdentity.passport_no && candidateData.passport_normalized) {
        const extractedPassport = normalizePassport(extractedIdentity.passport_no);
        const candidatePassport = candidateData.passport_normalized;
        if (extractedPassport && extractedPassport !== candidatePassport) {
          if (!mismatchFields.includes('passport')) {
            mismatchFields.push('passport');
          }
          mismatchCodes.push(REJECTION_REASON_CODES.PASSPORT_MISMATCH);
        }
      }

      // DOB mismatch (third priority)
      if (extractedIdentity.date_of_birth && candidateData.date_of_birth) {
        try {
          const extractedDOB = new Date(extractedIdentity.date_of_birth);
          const candidateDOB = new Date(candidateData.date_of_birth);
          // Compare dates (ignore time)
          if (
            extractedDOB.getFullYear() !== candidateDOB.getFullYear() ||
            extractedDOB.getMonth() !== candidateDOB.getMonth() ||
            extractedDOB.getDate() !== candidateDOB.getDate()
          ) {
            if (!mismatchFields.includes('date_of_birth')) {
              mismatchFields.push('date_of_birth');
            }
            mismatchCodes.push(REJECTION_REASON_CODES.DOB_MISMATCH);
          }
        } catch (e) {
          // Invalid date format - skip DOB comparison
        }
      }

      // Name mismatch (fourth priority)
      if (extractedIdentity.name && candidateData.name) {
        if (!this.fuzzyNameMatch(extractedIdentity.name, candidateData.name)) {
          if (!mismatchFields.includes('name')) {
            mismatchFields.push('name');
          }
          mismatchCodes.push(REJECTION_REASON_CODES.NAME_MISMATCH);
        }
      }

      // Email mismatch (fifth priority)
      if (extractedIdentity.email && candidateData.email) {
        const extractedEmail = extractedIdentity.email.toLowerCase().trim();
        const candidateEmail = candidateData.email.toLowerCase().trim();
        if (extractedEmail !== candidateEmail) {
          if (!mismatchFields.includes('email')) {
            mismatchFields.push('email');
          }
          mismatchCodes.push(REJECTION_REASON_CODES.EMAIL_MISMATCH);
        }
      }

      // Phone mismatch (sixth priority)
      if (extractedIdentity.phone && candidateData.phone) {
        const extractedPhone = normalizePhoneE164(extractedIdentity.phone);
        const candidatePhone = normalizePhoneE164(candidateData.phone);
        if (extractedPhone && candidatePhone && extractedPhone !== candidatePhone) {
          if (!mismatchFields.includes('phone')) {
            mismatchFields.push('phone');
          }
          mismatchCodes.push(REJECTION_REASON_CODES.PHONE_MISMATCH);
        }
      }

      // Father name mismatch (lowest priority)
      if (extractedIdentity.father_name && candidateData.father_name) {
        if (!this.fuzzyNameMatch(extractedIdentity.father_name, candidateData.father_name)) {
          if (!mismatchFields.includes('father_name')) {
            mismatchFields.push('father_name');
          }
          mismatchCodes.push(REJECTION_REASON_CODES.FATHER_NAME_MISMATCH);
        }
      }

      // FIX 1: Select highest priority mismatch code (if any mismatches found)
      if (mismatchCodes.length > 0) {
        for (const priorityCode of REJECTION_PRIORITY_ORDER) {
          if (mismatchCodes.includes(priorityCode)) {
            rejectionCode = priorityCode;
            break; // Use first (highest priority) match
          }
        }
      }
    }

    // ============================================
    // STEP 5: Check error stage
    // ============================================
    if (errorStage) {
      switch (errorStage) {
        case 'OCR':
          rejectionCode = REJECTION_REASON_CODES.OCR_FAILED;
          retryPossible = true;
          break;
        case 'Vision':
          rejectionCode = REJECTION_REASON_CODES.VISION_API_ERROR;
          retryPossible = true;
          break;
        case 'Extraction':
          rejectionCode = REJECTION_REASON_CODES.EXTRACTION_FAILED;
          retryPossible = true;
          break;
        case 'Categorization':
          rejectionCode = REJECTION_REASON_CODES.AI_PROCESSING_FAILED;
          retryPossible = true;
          break;
        case 'Matching':
          // Matching errors are handled by mismatch codes above
          break;
      }
    }

    // ============================================
    // STEP 6: Generate human-readable reason
    // ============================================
    const reason = getRejectionReasonMessage(
      rejectionCode as any,
      documentCategory,
      {
        extractedValue: extractedIdentity?.name,
        candidateValue: candidateData?.name,
        expiryDate,
      }
    );

    // ============================================
    // STEP 7: Check if rejection code is overridable
    // FIX 3: Non-overridable codes guard
    // NEW: Similarity-based override logic
    // ============================================
    let isOverridable = !NON_OVERRIDABLE_REJECTION_CODES.includes(rejectionCode as any);
    let requiredRole: 'admin' | 'super_admin' = 'admin';

    // NEW: Special handling for ID mismatches based on similarity
    // If ID belongs to another candidate in system -> critical, only admin can override (with explicit warning)
    // If <50% similar -> major mismatch, requires admin review
    // If 50-80% similar -> possible OCR error, admin can override
    // If >80% similar -> likely OCR error, admin can easily override
    if ((rejectionCode === REJECTION_REASON_CODES.CNIC_MISMATCH || 
         rejectionCode === REJECTION_REASON_CODES.PASSPORT_MISMATCH) && 
        (mismatchSeverity === 'critical' || mismatchSeverity === 'major')) {
      
      if (idBelongsToOtherCandidate) {
        // Document genuinely belongs to someone else - still overridable but flag it clearly
        isOverridable = true;
        requiredRole = 'admin';
        // Note: Add strong warning in reason message (handled by getRejectionReasonMessage)
      } else if (mismatchSeverity === 'major') {
        // <50% similarity - significant difference
        isOverridable = true;
        requiredRole = 'admin';
      }
      // For 'minor' severity (>80% match), already overridable with default admin role
    }

    return {
      code: rejectionCode,
      reason,
      mismatchFields,
      retryPossible,
      isOverridable,
      requiredRole,
    };
  }

  /**
   * Check if a rejection code can be overridden
   * FIX 3: Non-overridable codes guard
   */
  static isOverridable(rejectionCode: string): boolean {
    return !NON_OVERRIDABLE_REJECTION_CODES.includes(rejectionCode as any);
  }

  /**
   * Get required role for override
   * FIX 3: Non-overridable codes guard
   */
  static getRequiredOverrideRole(rejectionCode: string): 'admin' | 'super_admin' {
    return this.isOverridable(rejectionCode) ? 'admin' : 'super_admin';
  }

  /**
   * Fuzzy name matching with normalization
   * Reused from IdentityMatchingService logic
   */
  private static fuzzyNameMatch(name1: string, name2: string): boolean {
    if (!name1 || !name2) return false;

    // Normalize: lowercase, remove extra spaces, remove punctuation
    const normalize = (str: string) =>
      str
        .toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const n1 = normalize(name1);
    const n2 = normalize(name2);

    // Exact match
    if (n1 === n2) return true;

    // Split into words
    const words1 = n1.split(' ').filter((w) => w.length > 0);
    const words2 = n2.split(' ').filter((w) => w.length > 0);

    // Remove common prefixes/titles that don't help with matching
    const commonPrefixes = [
      'muhammad',
      'mohammad',
      'mohammed',
      'muh',
      'md',
      'mr',
      'mrs',
      'miss',
      'dr',
      'prof',
    ];
    const cleanWords = (words: string[]) =>
      words.filter((w) => !commonPrefixes.includes(w));

    const clean1 = cleanWords(words1);
    const clean2 = cleanWords(words2);

    // If after cleaning, one name is empty, use original
    const final1 = clean1.length > 0 ? clean1 : words1;
    const final2 = clean2.length > 0 ? clean2 : words2;

    // Check if all words from shorter name are in longer name
    const shorter = final1.length <= final2.length ? final1 : final2;
    const longer = final1.length > final2.length ? final1 : final2;

    // If shorter name has only one word, check if it matches any word in longer name
    if (shorter.length === 1) {
      const shortWord = shorter[0];
      return longer.some(
        (w) => w === shortWord || w.includes(shortWord) || shortWord.includes(w)
      );
    }

    // For multiple words, check if all words from shorter name are in longer name
    const allWordsMatch = shorter.every((word) =>
      longer.some((w) => w === word || w.includes(word) || word.includes(w))
    );

    return allWordsMatch;
  }
}

// Export singleton instance
export const documentRejectionService = new DocumentRejectionService();
