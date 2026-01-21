import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import crypto from 'crypto';
import { supabaseAdminClient } from '../config/database';
import { documentVerificationLogService } from '../services/documentVerificationLogService';
import { identityMatchingService } from '../services/identityMatchingService';
import { CandidateMatcher } from '../services/candidateMatcher';
import { 
  DOCUMENT_CATEGORIES, 
  VERIFICATION_STATUS, 
  VERIFICATION_REASON_CODES,
  AI_CONFIDENCE_THRESHOLD,
  VerificationStatus,
  DocumentCategory
} from '../config/documentCategories';

const PY_URL = (process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-portal-python-parser-production.up.railway.app') as string;
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET as string;

if (!HMAC_SECRET) {
  throw new Error('PYTHON_HMAC_SECRET environment variable is required for document verification worker');
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

    if (!aiResult.success || aiResult.error) {
      // AI scan failed
      await documentVerificationLogService.logAIScanFailed(
        requestId,
        documentId,
        candidateId,
        aiResult.error || 'Unknown AI service error'
      );

      // Update document with failure status
      await db
        .from('candidate_documents')
        .update({
          verification_status: VERIFICATION_STATUS.FAILED,
          ai_processing_completed_at: new Date().toISOString(),
        })
        .eq('id', documentId);

      throw new Error(`AI categorization failed: ${aiResult.error}`);
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
    let reasonCode: string = VERIFICATION_REASON_CODES.VERIFIED;
    let mismatchFields: string[] = [];

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
          matchResult = await identityMatchingService.matchIdentity(
            candidateId,
            aiResult.extracted_identity
          );
          
          console.log(`[DocumentVerification] Identity matching successful: ${matchResult.matched ? 'VERIFIED' : 'NEEDS_REVIEW'}`);
        } else {
          // Could not find candidate by extracted identity - try using provided candidate_id as fallback
          console.log(`[DocumentVerification] Could not find candidate by extracted identity, trying provided candidate_id ${candidateId}...`);
          
          try {
            matchResult = await identityMatchingService.matchIdentity(
              candidateId,
              aiResult.extracted_identity
            );
          } catch (matchError: any) {
            // Provided candidate_id also doesn't exist - needs manual review
            if (matchError.message?.includes('Candidate not found')) {
              console.log(`[DocumentVerification] Provided candidate_id ${candidateId} also not found, marking for review`);
              finalStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
              reasonCode = VERIFICATION_REASON_CODES.NO_ID_FOUND;
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
                }
              );
            } else {
              // Other identity matching errors
              console.error(`[DocumentVerification] Identity matching failed:`, matchError);
              finalStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
              reasonCode = VERIFICATION_REASON_CODES.NO_ID_FOUND;
              mismatchFields = ['identity_matching_error'];
              
              await documentVerificationLogService.logIdentityVerificationCompleted(
                requestId,
                documentId,
                candidateId,
                VERIFICATION_STATUS.NEEDS_REVIEW,
                reasonCode,
                mismatchFields,
                { notes: `Identity matching error: ${matchError.message}` }
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
            aiResult.extracted_identity
          );
        } catch (matchError: any) {
          // Both failed - needs manual review
          console.error(`[DocumentVerification] Both auto-match and provided candidate_id failed`);
          finalStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
          reasonCode = VERIFICATION_REASON_CODES.NO_ID_FOUND;
          mismatchFields = ['identity_matching_error'];
          
          await documentVerificationLogService.logIdentityVerificationCompleted(
            requestId,
            documentId,
            candidateId,
            VERIFICATION_STATUS.NEEDS_REVIEW,
            reasonCode,
            mismatchFields,
            { notes: `Auto-match failed: ${autoMatchError.message}. Identity matching also failed: ${matchError.message}` }
          );
        }
      }

      // Log identity verification result (only if matching succeeded)
      if (matchResult) {
        await documentVerificationLogService.logIdentityVerificationCompleted(
          requestId,
          documentId,
          candidateId,
          matchResult.matched ? VERIFICATION_STATUS.VERIFIED : VERIFICATION_STATUS.NEEDS_REVIEW,
          matchResult.reason_code,
          matchResult.mismatch_fields,
          matchResult
        );

        // Determine verification status based on identity match
        if (matchResult.matched) {
          finalStatus = VERIFICATION_STATUS.VERIFIED;
          reasonCode = VERIFICATION_REASON_CODES.VERIFIED;
        } else if (matchResult.reason_code === VERIFICATION_REASON_CODES.NO_ID_FOUND) {
          // No IDs found - needs manual review
          finalStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
          reasonCode = VERIFICATION_REASON_CODES.NO_ID_FOUND;
        } else {
          // Identity mismatch - rejected
          finalStatus = VERIFICATION_STATUS.REJECTED_MISMATCH;
          reasonCode = matchResult.reason_code;
          mismatchFields = matchResult.mismatch_fields || [];
        }
      }
    } else {
      // No identity fields extracted - needs manual review
      finalStatus = VERIFICATION_STATUS.NEEDS_REVIEW;
      reasonCode = VERIFICATION_REASON_CODES.NO_ID_FOUND;

      await documentVerificationLogService.logIdentityVerificationCompleted(
        requestId,
        documentId,
        candidateId,
        VERIFICATION_STATUS.NEEDS_REVIEW,
        reasonCode,
        undefined,
        { notes: 'No identity fields extracted from document' }
      );
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
        reasonCode = VERIFICATION_REASON_CODES.LOW_CONFIDENCE;
      }
    }

    // =============================================================================
    // STEP 7: Update document with final verification decision
    // =============================================================================
    await db
      .from('candidate_documents')
      .update({
        category: finalCategory,
        confidence: aiResult.confidence, // Ensure confidence is saved
        verification_status: finalStatus as VerificationStatus,
        verification_reason_code: reasonCode,
        mismatch_fields: mismatchFields.length > 0 ? mismatchFields : null,
        verification_completed_at: new Date().toISOString(),
      })
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

  worker.on('completed', (job) => {
    console.log(`[DocumentVerificationWorker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[DocumentVerificationWorker] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[DocumentVerificationWorker] Worker error:', err);
  });

  console.log('[DocumentVerificationWorker] Worker started, listening for jobs...');

  return worker;
}
