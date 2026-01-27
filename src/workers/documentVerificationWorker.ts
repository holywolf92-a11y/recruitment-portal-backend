import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import crypto from 'crypto';
import { supabaseAdminClient } from '../config/database';
import { documentVerificationLogService } from '../services/documentVerificationLogService';
import { identityMatchingService } from '../services/identityMatchingService';
import { CandidateMatcher } from '../services/candidateMatcher';
import { normalizePassport } from '../services/candidateService';
import { 
  DOCUMENT_CATEGORIES, 
  VERIFICATION_STATUS, 
  REJECTION_REASON_CODES,
  AI_CONFIDENCE_THRESHOLD,
  VerificationStatus,
  DocumentCategory,
  getRejectionReasonMessage,
} from '../config/documentCategories';
import { DocumentRejectionService, RejectionContext } from '../services/documentRejectionService';

const PY_URL = (process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-portal-python-parser-production.up.railway.app') as string;
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET as string;

if (!HMAC_SECRET) {
  throw new Error('PYTHON_HMAC_SECRET environment variable is required for document verification worker');
}

/**
 * Parse date string in various formats (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD) to ISO format (YYYY-MM-DD)
 * Returns null if date cannot be parsed
 */
function parseDateToISO(dateStr: string | null | undefined): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  
  // Try ISO format first (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return trimmed; // Already in correct format
    }
  }
  
  // Try DD/MM/YYYY or DD-MM-YYYY format
  const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyyMatch) {
    const [, day, month, year] = ddmmyyyyMatch;
    const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const date = new Date(isoDate);
    if (!isNaN(date.getTime())) {
      return isoDate;
    }
  }
  
  // Try YYYY/MM/DD format
  const yyyymmddMatch = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (yyyymmddMatch) {
    const [, year, month, day] = yyyymmddMatch;
    const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const date = new Date(isoDate);
    if (!isNaN(date.getTime())) {
      return isoDate;
    }
  }
  
  // Try parsing as-is (might work for some formats)
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  console.warn(`[DateParser] Could not parse date: ${dateStr}`);
  return null;
}

interface DocumentVerificationJobData {
  requestId: string;
  documentId: string;
  candidateId: string;
  storageBucket: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
}

interface AICategorizationResponse {
  success: boolean;
  category?: string;
  confidence?: number;
  ocr_confidence?: number;
  extracted_identity?: {
    name?: string;
    father_name?: string;
    cnic?: string;
    passport_no?: string;
    email?: string;
    phone?: string;
    date_of_birth?: string;
    document_number?: string;
    nationality?: string;
    passport_expiry?: string;
    expiry_date?: string;
    issue_date?: string;
    place_of_issue?: string;
  };
  raw_text?: string;
  error?: string;
}

/**
 * Sign request body with HMAC-SHA256
 */
function signHmac(body: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}

/**
 * Call Python AI service to categorize document and extract identity fields
 */
async function callAICategorizationService(
  fileContent: string,
  fileName: string,
  mimeType: string
): Promise<AICategorizationResponse> {
  try {
    // Log what we're about to send
    console.log(`[AI Categorization] Preparing request - fileName: ${fileName}, mimeType: ${mimeType}`);
    console.log(`[AI Categorization] Base64 content length: ${fileContent.length}, first 50 chars: ${fileContent.substring(0, 50)}`);
    
    const requestBody = JSON.stringify({
      file_content: fileContent,
      file_name: fileName,
      mime_type: mimeType,
      operation: 'categorize_document', // New operation for document categorization
    });
    
    // Verify JSON stringify didn't corrupt the base64
    const parsed = JSON.parse(requestBody);
    if (parsed.file_content !== fileContent) {
      console.error(`[AI Categorization] ERROR: JSON.stringify corrupted base64! Original length: ${fileContent.length}, Parsed length: ${parsed.file_content.length}`);
    }

    const signature = signHmac(requestBody);

    const response = await fetch(`${PY_URL}/categorize-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HMAC-Signature': signature,
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI service error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    console.log('[AI Categorization] Raw parser response:', JSON.stringify(result, null, 2));
    
    // Map Python parser response to our expected format
    // Python returns: { success, category, confidence, extracted_identity: {...} } OR { identity_fields: {...} }
    // We need: { success, category, confidence, extracted_identity: {...} }
    if (result.extracted_identity) {
      // Python parser already returns extracted_identity format - use it directly
      // Ensure all fields are present
      const identity = result.extracted_identity;
      result.extracted_identity = {
        name: identity.name || null,
        father_name: identity.father_name || null,
        cnic: identity.cnic || null,
        passport_no: identity.passport_no || null,
        email: identity.email || null,
        phone: identity.phone || null,
        date_of_birth: identity.date_of_birth || identity.dob || null,
        document_number: identity.document_number || null,
        nationality: identity.nationality || null,
        passport_expiry: identity.passport_expiry || identity.expiry_date || null,
        expiry_date: identity.expiry_date || identity.passport_expiry || null,
        issue_date: identity.issue_date || null,
        place_of_issue: identity.place_of_issue || null,
      };
    } else if (result.identity_fields) {
      // Backward compatibility: map identity_fields to extracted_identity
      const identityFields = result.identity_fields;
      result.extracted_identity = {
        name: identityFields.name || null,
        father_name: identityFields.father_name || null,
        cnic: identityFields.cnic || null,
        passport_no: identityFields.passport_no || null,
        email: identityFields.email || null,
        phone: identityFields.phone || null,
        date_of_birth: identityFields.date_of_birth || identityFields.dob || null,
        document_number: identityFields.document_number || null,
        nationality: identityFields.nationality || null,
        passport_expiry: identityFields.passport_expiry || identityFields.expiry_date || null,
        expiry_date: identityFields.expiry_date || identityFields.passport_expiry || null,
        issue_date: identityFields.issue_date || null,
        place_of_issue: identityFields.place_of_issue || null,
      };
      console.log('[AI Categorization] Mapped identity_fields to extracted_identity:', {
        hasName: !!result.extracted_identity.name,
        hasNationality: !!result.extracted_identity.nationality,
        hasPassport: !!result.extracted_identity.passport_no,
        hasExpiry: !!result.extracted_identity.passport_expiry,
        hasDOB: !!result.extracted_identity.date_of_birth,
      });
    }
    
    // Log final extracted_identity for debugging
    if (result.extracted_identity) {
      const nonNullFields = Object.entries(result.extracted_identity)
        .filter(([_, val]) => val !== null && val !== undefined && val !== '')
        .map(([key, _]) => key);
      console.log('[AI Categorization] Final extracted_identity has', nonNullFields.length, 'non-null fields:', nonNullFields);
    }
    
    return result;
  } catch (error: any) {
    console.error('[AI Categorization] Service call failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Process document verification job
 * 
 * Workflow:
 * 1. Download document from storage
 * 2. Call AI service for categorization + identity extraction
 * 3. Match extracted identity against candidate record
 * 4. Make verification decision (VERIFIED, NEEDS_REVIEW, REJECTED_MISMATCH)
 * 5. Update document record with results
 * 6. Log all events to verification logs
 */
async function processDocumentVerification(job: Job<DocumentVerificationJobData>) {
  const { requestId, documentId, candidateId: initialCandidateId, storageBucket, storagePath, fileName, mimeType } = job.data;
  let candidateId = initialCandidateId; // Allow reassignment for auto-matching

  console.log(`[DocumentVerification] Processing job for document ${documentId}, request ${requestId}`);

  const db = supabaseAdminClient();

  try {
    // =============================================================================
    // STEP 1: Log AI scan started
    // =============================================================================
    await documentVerificationLogService.logAIScanStarted(requestId, documentId, candidateId);

    // Update document record: AI processing started
    await db
      .from('candidate_documents')
      .update({
        ai_processing_started_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    // =============================================================================
    // STEP 2: Download document from Supabase Storage
    // =============================================================================
    const { data: fileData, error: downloadError } = await db.storage
      .from(storageBucket)
      .download(storagePath);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download document from storage: ${downloadError?.message}`);
    }

    // Convert file to base64 for AI service
    // Supabase storage.download() returns a Blob, so we need to convert it to ArrayBuffer first
    console.log(`[DocumentVerification] FileData type: ${typeof fileData}, is Blob: ${fileData instanceof Blob}`);
    
    const arrayBuffer = await (fileData as Blob).arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Validate file is not empty
    if (buffer.length === 0) {
      throw new Error('Downloaded file is empty');
    }
    
    // Log file size and raw content preview for debugging
    console.log(`[DocumentVerification] File size: ${buffer.length} bytes, fileName: ${fileName}`);
    console.log(`[DocumentVerification] Raw content preview (first 50 bytes as hex): ${buffer.toString('hex').substring(0, 100)}`);
    console.log(`[DocumentVerification] Raw content preview (first 50 bytes as text): ${buffer.toString('utf8', 0, Math.min(50, buffer.length))}`);
    
    const base64Content = buffer.toString('base64');
    
    // Validate base64 encoding
    if (!base64Content || base64Content.length < 4) {
      throw new Error(`Invalid base64 content: length=${base64Content?.length || 0}`);
    }
    
    // Log base64 preview for debugging (first 50 chars)
    console.log(`[DocumentVerification] Base64 preview (first 50 chars): ${base64Content.substring(0, 50)}`);
    console.log(`[DocumentVerification] Base64 length: ${base64Content.length}`);
    
    // Verify base64 is valid (only base64 chars)
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(base64Content)) {
      console.error(`[DocumentVerification] WARNING: Base64 contains invalid characters! First 100 chars: ${base64Content.substring(0, 100)}`);
    }

    // =============================================================================
    // STEP 3: Call AI categorization service
    // =============================================================================
    const aiResult = await callAICategorizationService(base64Content, fileName, mimeType);

    // Declare errorStage early to avoid "used before declaration" error
    let errorStage: 'OCR' | 'Vision' | 'Matching' | 'Extraction' | 'Categorization' | null = null;
    
    if (!aiResult.success || aiResult.error) {
      // AI scan failed - use DocumentRejectionService to determine rejection code
      errorStage = 'Categorization';
      const rejectionContext: RejectionContext = {
        documentCategory: DOCUMENT_CATEGORIES.OTHER_DOCUMENTS, // Unknown category
        extractedIdentity: undefined,
        candidateData: undefined,
        aiConfidence: undefined,
        ocrConfidence: undefined,
        expiryDate: undefined,
        errorStage: 'Categorization',
      };
      const rejectionResult = DocumentRejectionService.determineRejectionCode(rejectionContext);
      
      await documentVerificationLogService.logAIScanFailed(
        requestId,
        documentId,
        candidateId,
        aiResult.error || 'Unknown AI service error',
        undefined, // errorStack
        {
          rejection_code: rejectionResult.code,
          rejection_reason: rejectionResult.reason,
          error_stage: 'Categorization',
          retry_possible: rejectionResult.retryPossible,
          retry_count: 0,
          max_retries: 2,
          rejection_context: {
            error_message: aiResult.error,
          },
        }
      );

      // Update document with failure status and rejection details
      // FIX 5: Mandatory rejection_code
      await db
        .from('candidate_documents')
        .update({
          verification_status: VERIFICATION_STATUS.FAILED,
          ai_processing_completed_at: new Date().toISOString(),
          rejection_code: rejectionResult.code,
          rejection_reason: rejectionResult.reason,
          error_stage: 'Categorization',
          retry_possible: rejectionResult.retryPossible,
          retry_count: 0,
          max_retries: 2,
        })
        .eq('id', documentId);

      throw new Error(`AI categorization failed: ${aiResult.error}`);
    }

    // =============================================================================
    // STEP 3b: Document-type validation — reject if user uploaded as "passport" (etc.) but AI says it's not
    // =============================================================================
    const { data: docRow } = await db
      .from('candidate_documents')
      .select('category')
      .eq('id', documentId)
      .single();
    const expectedCategory = (docRow?.category || '').toString().toLowerCase();
    const aiCategory = (aiResult.category || '').toString().toLowerCase().replace(/^photo$/, 'photos').replace(/^cv$/, 'cv_resume');
    const strictTypes = [
      DOCUMENT_CATEGORIES.PASSPORT,
      DOCUMENT_CATEGORIES.CNIC,
      DOCUMENT_CATEGORIES.DRIVING_LICENSE,
      DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE,
      DOCUMENT_CATEGORIES.CERTIFICATES,
      DOCUMENT_CATEGORIES.MEDICAL_REPORTS,
      DOCUMENT_CATEGORIES.PHOTOS,
      DOCUMENT_CATEGORIES.CV_RESUME,
    ];
    const expectedNorm = expectedCategory.replace(/^photo$/, 'photos').replace(/^cv$/, 'cv_resume');
    const isStrictExpected = strictTypes.some((t) => t.toLowerCase() === expectedNorm);
    const categoriesMatch =
      expectedNorm === aiCategory ||
      (expectedNorm === 'photos' && aiCategory === 'photo') ||
      (expectedNorm === 'cv_resume' && (aiCategory === 'cv' || aiCategory === 'cv_resume'));

    if (isStrictExpected && !categoriesMatch) {
      const rejectCategory = strictTypes.find((t) => t.toLowerCase() === expectedNorm) || (expectedNorm as DocumentCategory);
      const rejectionReason = getRejectionReasonMessage(REJECTION_REASON_CODES.WRONG_DOCUMENT_TYPE, rejectCategory);
      console.log(`[DocumentVerification] Wrong document type: expected ${expectedNorm}, AI detected ${aiCategory}. Rejecting with: ${rejectionReason}`);

      await documentVerificationLogService.logIdentityVerificationCompleted(
        requestId,
        documentId,
        candidateId,
        VERIFICATION_STATUS.REJECTED_MISMATCH,
        REJECTION_REASON_CODES.WRONG_DOCUMENT_TYPE,
        ['document_type_mismatch'],
        { notes: `Expected ${expectedNorm}, AI detected ${aiCategory}` },
        {
          rejection_code: REJECTION_REASON_CODES.WRONG_DOCUMENT_TYPE,
          rejection_reason: rejectionReason,
          error_stage: 'Categorization',
          retry_possible: false,
          retry_count: 0,
          max_retries: 2,
          rejection_context: { expected_category: expectedNorm, detected_category: aiCategory },
        }
      );

      await db
        .from('candidate_documents')
        .update({
          verification_status: VERIFICATION_STATUS.REJECTED_MISMATCH,
          verification_reason_code: REJECTION_REASON_CODES.WRONG_DOCUMENT_TYPE,
          rejection_code: REJECTION_REASON_CODES.WRONG_DOCUMENT_TYPE,
          rejection_reason: rejectionReason,
          category: expectedNorm as DocumentCategory,
          detected_category: aiResult.category as DocumentCategory,
          confidence: aiResult.confidence,
          ai_processing_completed_at: new Date().toISOString(),
          verification_completed_at: new Date().toISOString(),
          error_stage: 'Categorization',
          retry_possible: false,
          retry_count: 0,
          max_retries: 2,
        })
        .eq('id', documentId);

      return; // Job completed — document rejected with clear reason, no retry
    }

    // =============================================================================
    // STEP 4: Log AI scan completed
    // =============================================================================
    await documentVerificationLogService.logAIScanCompleted(
      requestId,
      documentId,
      candidateId,
      (aiResult.category as DocumentCategory) || DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
      aiResult.confidence || 0,
      aiResult.ocr_confidence || 0,
      aiResult.extracted_identity || {},
      aiResult // raw AI response
    );

    // Update document: AI processing completed, store results
    await db
      .from('candidate_documents')
      .update({
        detected_category: aiResult.category,
        confidence: aiResult.confidence,
        extracted_identity_json: aiResult.extracted_identity || {},
        ai_processing_completed_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    // =============================================================================
    // STEP 5: Identity matching (if identity fields were extracted)
    // =============================================================================
    let matchResult = null;
    let finalCategory = aiResult.category;
    let finalStatus: string = VERIFICATION_STATUS.VERIFIED;
    let reasonCode: string = ''; // Empty string for verified (no rejection code needed)
    let mismatchFields: string[] = [];
    // New rejection details (from DocumentRejectionService)
    let rejectionCode: string | null = null;
    let rejectionReason: string | undefined = undefined;
    let retryPossible: boolean = false;
    let isOverridable: boolean = true;
    let requiredRole: 'admin' | 'super_admin' = 'admin';

    if (aiResult.extracted_identity && Object.keys(aiResult.extracted_identity).length > 0) {
      // PRIORITY: Match by extracted identity FIRST (document contains real data, not system-generated ID)
      // The document has name, CNIC, passport, email, phone - use these to find the correct candidate
      console.log(`[DocumentVerification] Attempting to find candidate by extracted identity from document...`);
      
      try {
        // Try to find candidate using extracted identity (name, email, phone, passport, CNIC)
        const matchCriteria = {
          cnic: aiResult.extracted_identity.cnic,
          email: aiResult.extracted_identity.email,
          phone: aiResult.extracted_identity.phone,
          name: aiResult.extracted_identity.name,
          fatherName: aiResult.extracted_identity.father_name,
        };
        
        const candidateMatch = await CandidateMatcher.findCandidate(matchCriteria);
        
        if (candidateMatch.candidateId && !candidateMatch.needsManualReview) {
          // Found candidate by extracted identity - use this candidate ID (even if different from provided one)
          console.log(`[DocumentVerification] Found candidate ${candidateMatch.candidateId} by ${candidateMatch.matchedBy} from document, updating...`);
          
          // Update document's candidate_id to the correct one
          await db
            .from('candidate_documents')
            .update({ candidate_id: candidateMatch.candidateId })
            .eq('id', documentId);
          
          // Update candidateId for rest of processing
          candidateId = candidateMatch.candidateId;
          
          // Now run identity matching with the correct candidate ID
          // Pass document category and confidence scores for detailed rejection
          matchResult = await identityMatchingService.matchIdentity(
            candidateId,
            aiResult.extracted_identity,
            finalCategory as DocumentCategory,
            aiResult.confidence,
            aiResult.ocr_confidence,
            aiResult.extracted_identity?.passport_expiry || aiResult.extracted_identity?.expiry_date,
            undefined // errorStage - set later if needed
          );
          
          console.log(`[DocumentVerification] Identity matching successful: ${matchResult.matched ? 'VERIFIED' : 'NEEDS_REVIEW'}`);
        } else {
          // Could not find candidate by extracted identity - try using provided candidate_id as fallback
          console.log(`[DocumentVerification] Could not find candidate by extracted identity, trying provided candidate_id ${candidateId}...`);
          
          try {
            matchResult = await identityMatchingService.matchIdentity(
              candidateId,
              aiResult.extracted_identity,
              finalCategory as DocumentCategory,
              aiResult.confidence,
              aiResult.ocr_confidence,
              aiResult.extracted_identity?.passport_expiry || aiResult.extracted_identity?.expiry_date,
              undefined
            );
          } catch (matchError: any) {
            // Provided candidate_id also doesn't exist - needs manual review
            if (matchError.message?.includes('Candidate not found')) {
              console.log(`[DocumentVerification] Provided candidate_id ${candidateId} also not found, marking for review`);
              finalStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
              reasonCode = REJECTION_REASON_CODES.NO_ID_FOUND;
              mismatchFields = ['candidate_not_found'];
              
              await documentVerificationLogService.logIdentityVerificationCompleted(
                requestId,
                documentId,
                candidateId,
                VERIFICATION_STATUS.NEEDS_REVIEW,
                reasonCode,
                mismatchFields,
                { 
                  notes: `Candidate not found. Attempted matching by: ${JSON.stringify(matchCriteria)}. Provided candidate_id also not found.`,
                  auto_match_attempted: true,
                  match_result: candidateMatch
                },
                {
                  rejection_code: rejectionCode || REJECTION_REASON_CODES.CANDIDATE_NOT_FOUND,
                  rejection_reason: rejectionReason || 'No matching candidate found',
                  error_stage: 'Matching',
                  retry_possible: false,
                  retry_count: 0,
                  max_retries: 2,
                  rejection_context: {
                    mismatch_fields: mismatchFields,
                    match_criteria: matchCriteria,
                  },
                }
              );
            } else {
              // Other identity matching errors
              console.error(`[DocumentVerification] Identity matching failed:`, matchError);
              finalStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
              reasonCode = REJECTION_REASON_CODES.NO_ID_FOUND;
              mismatchFields = ['identity_matching_error'];
              
              await documentVerificationLogService.logIdentityVerificationCompleted(
                requestId,
                documentId,
                candidateId,
                VERIFICATION_STATUS.NEEDS_REVIEW,
                reasonCode,
                mismatchFields,
                { notes: `Identity matching error: ${matchError.message}` },
                {
                  rejection_code: rejectionCode || REJECTION_REASON_CODES.NO_ID_FOUND,
                  rejection_reason: rejectionReason || 'Identity matching failed',
                  error_stage: 'Matching',
                  retry_possible: false,
                  retry_count: 0,
                  max_retries: 2,
                  rejection_context: {
                    mismatch_fields: mismatchFields,
                    error_message: matchError.message,
                  },
                }
              );
            }
          }
        }
      } catch (autoMatchError: any) {
        // Auto-matching failed - try provided candidate_id as fallback
        console.error(`[DocumentVerification] Auto-matching failed, trying provided candidate_id:`, autoMatchError);
        
        try {
          matchResult = await identityMatchingService.matchIdentity(
            candidateId,
            aiResult.extracted_identity,
            finalCategory as DocumentCategory,
            aiResult.confidence,
            aiResult.ocr_confidence,
            aiResult.extracted_identity?.passport_expiry || aiResult.extracted_identity?.expiry_date,
            undefined
          );
        } catch (matchError: any) {
          // Both failed - needs manual review
          console.error(`[DocumentVerification] Both auto-match and provided candidate_id failed`);
          finalStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
          reasonCode = REJECTION_REASON_CODES.NO_ID_FOUND;
          mismatchFields = ['identity_matching_error'];
          
          await documentVerificationLogService.logIdentityVerificationCompleted(
            requestId,
            documentId,
            candidateId,
            VERIFICATION_STATUS.NEEDS_REVIEW,
            reasonCode,
            mismatchFields,
            { notes: `Auto-match failed: ${autoMatchError.message}. Identity matching also failed: ${matchError.message}` },
            {
              rejection_code: rejectionCode || REJECTION_REASON_CODES.NO_ID_FOUND,
              rejection_reason: rejectionReason || 'Auto-matching and identity matching both failed',
              error_stage: 'Matching',
              retry_possible: false,
              retry_count: 0,
              max_retries: 2,
              rejection_context: {
                mismatch_fields: mismatchFields,
                auto_match_error: autoMatchError.message,
                identity_match_error: matchError.message,
              },
            }
          );
        }
      }

      // Log identity verification result (only if matching succeeded)
      if (matchResult) {
        // Prepare rejection details from matchResult
        const rejectionDetails = matchResult.rejection_code ? {
          rejection_code: matchResult.rejection_code,
          rejection_reason: matchResult.rejection_reason || undefined,
          error_stage: errorStage || undefined,
          retry_possible: matchResult.retry_possible || false,
          retry_count: 0, // Initial attempt
          max_retries: 2,
          document_expiry_date: parseDateToISO(aiResult.extracted_identity?.passport_expiry || aiResult.extracted_identity?.expiry_date) || undefined,
          rejection_context: {
            mismatch_fields: matchResult.mismatch_fields || [],
            matched: matchResult.matched,
            matched_on: matchResult.matched_on || [],
            confidence: matchResult.confidence,
          },
        } : undefined;

        await documentVerificationLogService.logIdentityVerificationCompleted(
          requestId,
          documentId,
          candidateId,
          matchResult.matched ? VERIFICATION_STATUS.VERIFIED : VERIFICATION_STATUS.NEEDS_REVIEW,
          matchResult.reason_code,
          matchResult.mismatch_fields,
          matchResult,
          rejectionDetails
        );

        // Determine verification status based on identity match
        if (matchResult.matched) {
          finalStatus = VERIFICATION_STATUS.VERIFIED;
          reasonCode = ''; // Empty string for verified (no rejection code needed)
        } else if (matchResult.reason_code === REJECTION_REASON_CODES.NO_ID_FOUND) {
          // No IDs found - needs manual review
          finalStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
          reasonCode = REJECTION_REASON_CODES.NO_ID_FOUND;
          // Extract rejection details if available
          if (matchResult.rejection_code) {
            rejectionCode = matchResult.rejection_code;
            rejectionReason = matchResult.rejection_reason || undefined;
            retryPossible = matchResult.retry_possible || false;
            isOverridable = matchResult.is_overridable !== undefined ? matchResult.is_overridable : true;
            requiredRole = matchResult.required_role || 'admin';
          }
        } else {
          // Identity mismatch - rejected
          finalStatus = VERIFICATION_STATUS.REJECTED_MISMATCH;
          reasonCode = matchResult.reason_code;
          mismatchFields = matchResult.mismatch_fields || [];
          // Extract rejection details (FIX 5: Mandatory rejection_code)
          if (matchResult.rejection_code) {
            rejectionCode = matchResult.rejection_code;
            rejectionReason = matchResult.rejection_reason || undefined;
            retryPossible = matchResult.retry_possible || false;
            isOverridable = matchResult.is_overridable !== undefined ? matchResult.is_overridable : true;
            requiredRole = matchResult.required_role || 'admin';
          } else {
            // FIX 5: Enforce mandatory rejection_code
            console.error(`[DocumentVerification] ERROR: Document ${documentId} reached rejected_mismatch without rejection_code!`);
            // Use DocumentRejectionService to determine rejection code
            const rejectionContext: RejectionContext = {
              documentCategory: finalCategory as DocumentCategory,
              extractedIdentity: aiResult.extracted_identity,
              candidateData: undefined, // Not available in this context
              aiConfidence: aiResult.confidence,
              ocrConfidence: aiResult.ocr_confidence,
              expiryDate: aiResult.extracted_identity?.passport_expiry || aiResult.extracted_identity?.expiry_date,
              errorStage: undefined,
              mismatchFields,
            };
            const rejectionResult = DocumentRejectionService.determineRejectionCode(rejectionContext);
            rejectionCode = rejectionResult.code;
            rejectionReason = rejectionResult.reason;
            retryPossible = rejectionResult.retryPossible;
            isOverridable = rejectionResult.isOverridable;
            requiredRole = rejectionResult.requiredRole || 'admin';
          }
        }
      }
    } else {
      // No identity fields extracted from document
      // If document was manually uploaded for a specific candidate AND category is correctly identified,
      // we can still verify it since the user explicitly linked it to that candidate
      
      // Special handling for photos: Photos don't have identity fields, so auto-verify if manually uploaded
      if (aiResult.category === 'photos' || aiResult.category === 'photo') {
        if (candidateId && aiResult.confidence && aiResult.confidence >= AI_CONFIDENCE_THRESHOLD) {
          console.log(`[DocumentVerification] Photo document detected. No identity fields needed. Verifying based on manual upload and high confidence (${aiResult.confidence}).`);
          finalStatus = VERIFICATION_STATUS.VERIFIED;
          reasonCode = ''; // Empty string for verified (no rejection code needed)

          await documentVerificationLogService.logIdentityVerificationCompleted(
            requestId,
            documentId,
            candidateId,
            VERIFICATION_STATUS.VERIFIED,
            reasonCode,
            undefined,
            { notes: 'Photo document verified - no identity fields required for photos' },
            undefined // No rejection details for verified documents
          );
        } else {
          // Low confidence or no candidate_id - needs manual review
          finalStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
          reasonCode = REJECTION_REASON_CODES.NO_ID_FOUND;

          await documentVerificationLogService.logIdentityVerificationCompleted(
            requestId,
            documentId,
            candidateId,
            VERIFICATION_STATUS.NEEDS_REVIEW,
            reasonCode,
            undefined,
            { notes: `Photo document - low confidence (${aiResult.confidence || 'N/A'}) or no candidate_id provided` },
            {
              rejection_code: REJECTION_REASON_CODES.NO_ID_FOUND,
              rejection_reason: 'Photo document - needs manual review',
              error_stage: 'Extraction',
              retry_possible: true,
              retry_count: 0,
              max_retries: 2,
              rejection_context: {
                ai_confidence: aiResult.confidence,
                candidate_id_provided: !!candidateId,
                document_type: 'photo',
              },
            }
          );
        }
      } else if (candidateId && aiResult.confidence && aiResult.confidence >= AI_CONFIDENCE_THRESHOLD) {
        // Document category was correctly identified (high confidence) and candidate_id is provided
        // This is a manual upload - trust the user's selection
        console.log(`[DocumentVerification] No identity fields extracted, but document category correctly identified (confidence: ${aiResult.confidence}) and candidate_id provided. Verifying based on manual upload.`);
        finalStatus = VERIFICATION_STATUS.VERIFIED;
        reasonCode = ''; // Empty string for verified (no rejection code needed)

        await documentVerificationLogService.logIdentityVerificationCompleted(
          requestId,
          documentId,
          candidateId,
          VERIFICATION_STATUS.VERIFIED,
          reasonCode,
          undefined,
          { notes: 'No identity fields extracted, but verified based on manual upload and correct category identification' },
          undefined // No rejection details for verified documents
        );
      } else {
        // Low confidence or no candidate_id - needs manual review
        finalStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
        reasonCode = REJECTION_REASON_CODES.NO_ID_FOUND;

        await documentVerificationLogService.logIdentityVerificationCompleted(
          requestId,
          documentId,
          candidateId,
          VERIFICATION_STATUS.NEEDS_REVIEW,
          reasonCode,
          undefined,
          { notes: `No identity fields extracted. Confidence: ${aiResult.confidence || 'N/A'}, Candidate ID provided: ${!!candidateId}` },
          {
            rejection_code: REJECTION_REASON_CODES.NO_ID_FOUND,
            rejection_reason: 'No identity fields extracted from document',
            error_stage: 'Extraction',
            retry_possible: true, // Can retry with better image/processing
            retry_count: 0,
            max_retries: 2,
            rejection_context: {
              ai_confidence: aiResult.confidence,
              candidate_id_provided: !!candidateId,
            },
          }
        );
      }
    }

    // =============================================================================
    // STEP 6: Category assignment decision
    // =============================================================================
    // Auto-assign category if confidence >= threshold, otherwise set to 'other_documents'
    if (aiResult.confidence && aiResult.confidence >= AI_CONFIDENCE_THRESHOLD) {
      finalCategory = aiResult.category;
    } else {
      finalCategory = DOCUMENT_CATEGORIES.OTHER_DOCUMENTS;
      if (finalStatus === VERIFICATION_STATUS.VERIFIED) {
        // Low confidence but identity verified - needs review for category
        finalStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
        reasonCode = REJECTION_REASON_CODES.LOW_CONFIDENCE;
        
        // Use DocumentRejectionService for low confidence rejection
        const rejectionContext: RejectionContext = {
          documentCategory: finalCategory as DocumentCategory,
          extractedIdentity: aiResult.extracted_identity,
          candidateData: undefined,
          aiConfidence: aiResult.confidence,
          ocrConfidence: aiResult.ocr_confidence,
          expiryDate: aiResult.extracted_identity?.passport_expiry || aiResult.extracted_identity?.expiry_date,
          errorStage: undefined,
        };
        const rejectionResult = DocumentRejectionService.determineRejectionCode(rejectionContext);
        rejectionCode = rejectionResult.code;
        rejectionReason = rejectionResult.reason;
        retryPossible = rejectionResult.retryPossible;
        isOverridable = rejectionResult.isOverridable;
        requiredRole = rejectionResult.requiredRole || 'admin';
      }
    }

    // =============================================================================
    // STEP 7: Update document with final verification decision
    // =============================================================================
    // FIX 5: Enforce mandatory rejection_code for rejected_mismatch and failed statuses
    if ((finalStatus === VERIFICATION_STATUS.REJECTED_MISMATCH || finalStatus === VERIFICATION_STATUS.FAILED) && !rejectionCode) {
      console.error(`[DocumentVerification] ERROR: Document ${documentId} reached ${finalStatus} without rejection_code! Using DocumentRejectionService...`);
      
      // Determine rejection code using DocumentRejectionService
      const rejectionContext: RejectionContext = {
        documentCategory: finalCategory as DocumentCategory,
        extractedIdentity: aiResult.extracted_identity,
        candidateData: undefined,
        aiConfidence: aiResult.confidence,
        ocrConfidence: aiResult.ocr_confidence,
        expiryDate: aiResult.extracted_identity?.passport_expiry || aiResult.extracted_identity?.expiry_date,
        errorStage: errorStage || undefined,
        mismatchFields,
      };
      const rejectionResult = DocumentRejectionService.determineRejectionCode(rejectionContext);
      rejectionCode = rejectionResult.code;
      rejectionReason = rejectionResult.reason;
      retryPossible = rejectionResult.retryPossible;
      isOverridable = rejectionResult.isOverridable;
      requiredRole = rejectionResult.requiredRole || 'admin';
    }
    
    // Prepare update object with all rejection details
    const updateData: any = {
      category: finalCategory,
      confidence: aiResult.confidence, // Ensure confidence is saved
      verification_status: finalStatus as VerificationStatus,
      verification_reason_code: reasonCode,
      mismatch_fields: mismatchFields.length > 0 ? mismatchFields : null,
      verification_completed_at: new Date().toISOString(),
    };
    
    // Add rejection details if document is rejected or failed
    if (finalStatus === VERIFICATION_STATUS.REJECTED_MISMATCH || finalStatus === VERIFICATION_STATUS.FAILED) {
      if (!rejectionCode) {
        throw new Error(`FIX 5 Violation: Document ${documentId} reached ${finalStatus} without mandatory rejection_code`);
      }
      
      updateData.rejection_code = rejectionCode;
      updateData.rejection_reason = rejectionReason || null; // Convert undefined to null for database
      updateData.ai_confidence = aiResult.confidence !== undefined ? aiResult.confidence : null;
      updateData.ocr_confidence = aiResult.ocr_confidence !== undefined ? aiResult.ocr_confidence : null;
      updateData.error_stage = errorStage;
      updateData.retry_possible = retryPossible;
      updateData.retry_count = 0; // Initialize retry count
      updateData.max_retries = 2; // Default max retries
      
      // Set document expiry date if available (parse to ISO format)
      const expiryDate = parseDateToISO(aiResult.extracted_identity?.passport_expiry || aiResult.extracted_identity?.expiry_date);
      if (expiryDate) {
        updateData.document_expiry_date = expiryDate;
      }
      
      // Set rejection context (JSONB) with mismatch fields
      if (mismatchFields.length > 0) {
        updateData.rejection_context = {
          mismatch_fields: mismatchFields,
          extracted_values: aiResult.extracted_identity || {},
        };
      }
    }
    
    await db
      .from('candidate_documents')
      .update(updateData)
      .eq('id', documentId);

    // Update candidate document flags based on final category
    // This ensures the candidate card shows correct document status
    try {
      const updateFlags: any = {};
      const category = finalCategory?.toLowerCase() || '';
      const now = new Date().toISOString();

      if (category === 'cv_resume' || category === 'cv') {
        updateFlags.cv_received = true;
        updateFlags.cv_received_at = now;
      } else if (category === 'passport') {
        updateFlags.passport_received = true;
        updateFlags.passport_received_at = now;
      } else if (category === 'certificates' || category === 'certificate') {
        updateFlags.certificate_received = true;
        updateFlags.certificate_received_at = now;
      } else if (category === 'photos' || category === 'photo') {
        updateFlags.photo_received = true;
        updateFlags.photo_received_at = now;
      } else if (category === 'medical_reports' || category === 'medical') {
        updateFlags.medical_received = true;
        updateFlags.medical_received_at = now;
      }

      if (Object.keys(updateFlags).length > 0) {
        await db
          .from('candidates')
          .update(updateFlags)
          .eq('id', candidateId);
        
        console.log(`[DocumentVerification] Updated candidate flags for ${candidateId}:`, Object.keys(updateFlags));
      }
    } catch (flagError: any) {
      console.error('[DocumentVerification] Failed to update candidate flags:', flagError);
      // Don't fail the verification if flag update fails
    }

    // =============================================================================
    // STEP 8: Progressive Data Completion - Enrich candidate with extracted information
    // Only fill missing fields, never overwrite existing values
    // Priority: Manual > Any Document
    // =============================================================================
    console.log(`[DocumentVerification] Progressive data completion - extracted_identity:`, aiResult.extracted_identity ? Object.keys(aiResult.extracted_identity).length : 0, `finalStatus:`, finalStatus);
    
    // Check if we have any non-null identity fields
    const hasIdentityFields = aiResult.extracted_identity && 
      Object.values(aiResult.extracted_identity).some((val: any) => val !== null && val !== undefined && val !== '');
    
    if (hasIdentityFields && finalStatus === VERIFICATION_STATUS.VERIFIED && aiResult.extracted_identity) {
      console.log(`[DocumentVerification] Progressive enrichment condition met - proceeding with enrichment`);
      try {
        // Import progressive completion service
        const { enrichCandidateData, updateMissingFields } = await import('../services/progressiveDataCompletionService');
        
        // Determine document source type from category
        let documentSource: 'cv' | 'passport' | 'driving_license' | 'medical' | 'certificate' | 'other' = 'other';
        if (aiResult.category === 'cv_resume' || aiResult.category === 'cv') {
          documentSource = 'cv';
        } else if (aiResult.category === 'passport') {
          documentSource = 'passport';
        } else if (aiResult.category === 'cnic') {
          documentSource = 'passport'; // Use 'passport' source type for CNIC to ensure nationality precedence
        } else if (aiResult.category === 'driving_license') {
          documentSource = 'driving_license';
        } else if (aiResult.category === 'medical_report' || aiResult.category === 'medical') {
          documentSource = 'medical';
        } else if (aiResult.category === 'certificate' || aiResult.category === 'certificates') {
          documentSource = 'certificate';
        }
        
        // Map extracted_identity to enrichment data format
        const enrichmentData: Record<string, any> = {};
        const identity = aiResult.extracted_identity;
        
        if (identity.name) enrichmentData.name = identity.name;
        if (identity.father_name) enrichmentData.father_name = identity.father_name;
        if (identity.cnic) enrichmentData.cnic = identity.cnic;
        if (identity.passport_no) enrichmentData.passport_no = identity.passport_no; // Will be mapped to passport_normalized
        if (identity.email) enrichmentData.email = identity.email;
        if (identity.phone) enrichmentData.phone = identity.phone;
        if (identity.date_of_birth) enrichmentData.date_of_birth = identity.date_of_birth;
        if (identity.nationality) enrichmentData.nationality = identity.nationality;
        if (identity.passport_expiry || identity.expiry_date) enrichmentData.passport_expiry = identity.passport_expiry || identity.expiry_date;
        if (identity.issue_date) enrichmentData.issue_date = identity.issue_date;
        if (identity.place_of_issue) enrichmentData.place_of_issue = identity.place_of_issue;
        
        // Enrich candidate data (progressive completion)
        const enrichmentResult = await enrichCandidateData(
          candidateId,
          enrichmentData,
          documentSource,
          documentId,
          aiResult.category
        );
        
        console.log(`[DocumentVerification] ✅ Progressive enrichment completed:`, {
          updated: enrichmentResult.updated,
          skipped: enrichmentResult.skipped,
          source: documentSource,
        });
        
        // Recalculate missing fields
        await updateMissingFields(candidateId);
        
      } catch (enrichmentError: any) {
        console.error('[DocumentVerification] ❌ Exception in progressive enrichment:', enrichmentError);
        console.error('[DocumentVerification] Error stack:', enrichmentError?.stack);
        // Don't fail the verification if candidate update fails
      }
    }

    // Log final status change
    await documentVerificationLogService.log({
      request_id: requestId,
      candidate_id: candidateId,
      document_id: documentId,
      event_type: 'verification_status_changed',
      event_status: 'success',
      verification_status: finalStatus as VerificationStatus,
      reason_code: reasonCode,
      mismatch_fields: mismatchFields.length > 0 ? mismatchFields : undefined,
      metadata: {
        final_category: finalCategory,
        ai_category: aiResult.category,
        ai_confidence: aiResult.confidence,
        identity_match: matchResult ? {
          matched: matchResult.matched,
          matched_on: matchResult.matched_on,
        } : null,
      },
    });

    console.log(`[DocumentVerification] Completed: ${documentId} -> ${finalStatus} (${reasonCode})`);
    
    return {
      success: true,
      documentId,
      verification_status: finalStatus,
      category: finalCategory,
      reason_code: reasonCode,
    };
  } catch (error: any) {
    console.error(`[DocumentVerification] Error processing document ${documentId}:`, error);

    // Log error (parameters: requestId, errorMessage, errorStack?, documentId?, candidateId?, metadata?)
    await documentVerificationLogService.logError(
      requestId,
      error.message || 'Unknown error',
      error.stack,
      documentId,
      candidateId,
      { error_type: 'document_verification_failed' }
    );

    // Update document with failed status
    await db
      .from('candidate_documents')
      .update({
        verification_status: VERIFICATION_STATUS.FAILED,
        verification_completed_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    throw error;
  }
}

/**
 * Create and start the document verification worker
 */
export function startDocumentVerificationWorker() {
  const worker = new Worker('document-verification', processDocumentVerification, {
    connection: redis,
    concurrency: 3, // Process up to 3 documents concurrently
    limiter: {
      max: 10, // Max 10 jobs
      duration: 60000, // Per 60 seconds (rate limiting to avoid overloading AI service)
    },
  });

  worker.on('active', (job) => {
    console.log(`[DocumentVerificationWorker] Job ${job.id} is now active - processing document ${job.data.documentId}`);
  });

  worker.on('completed', (job) => {
    console.log(`[DocumentVerificationWorker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[DocumentVerificationWorker] Job ${job?.id} failed:`, err.message);
    if (job) {
      console.error(`[DocumentVerificationWorker] Failed job data:`, JSON.stringify(job.data, null, 2));
    }
  });

  worker.on('error', (err) => {
    console.error('[DocumentVerificationWorker] Worker error:', err);
  });

  worker.on('stalled', (jobId) => {
    console.warn(`[DocumentVerificationWorker] Job ${jobId} stalled`);
  });

  console.log('[DocumentVerificationWorker] Worker started, listening for jobs...');

  return worker;
}
