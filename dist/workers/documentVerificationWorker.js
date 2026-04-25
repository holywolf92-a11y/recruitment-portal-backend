"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDocumentVerificationWorker = startDocumentVerificationWorker;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const documentVerificationLogService_1 = require("../services/documentVerificationLogService");
const identityMatchingService_1 = require("../services/identityMatchingService");
const candidateMatcher_1 = require("../services/candidateMatcher");
const documentCategories_1 = require("../config/documentCategories");
const documentRejectionService_1 = require("../services/documentRejectionService");
const professionInferenceService_1 = require("../services/professionInferenceService");
const PY_URL = (process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-python-parser-production.up.railway.app');
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET || 'dev-hmac-secret';
if (!HMAC_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('PYTHON_HMAC_SECRET environment variable is required for document verification worker in production');
}
/**
 * Parse date string in various formats (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD) to ISO format (YYYY-MM-DD)
 * Returns null if date cannot be parsed
 */
function parseDateToISO(dateStr) {
    if (!dateStr || typeof dateStr !== 'string')
        return null;
    const trimmed = dateStr.trim();
    if (!trimmed)
        return null;
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
function addDaysToISODate(isoDate, days) {
    if (!isoDate)
        return null;
    const d = new Date(`${isoDate}T00:00:00.000Z`);
    if (isNaN(d.getTime()))
        return null;
    d.setUTCDate(d.getUTCDate() + days);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function deriveExpiryDateForCategory(category, extractedIdentity) {
    const c = String(category || '').toLowerCase();
    const passportExpiry = extractedIdentity?.passport_expiry || extractedIdentity?.expiry_date;
    const expiryISO = parseDateToISO(passportExpiry);
    if (c === documentCategories_1.DOCUMENT_CATEGORIES.PASSPORT) {
        return expiryISO || undefined;
    }
    if (c === documentCategories_1.DOCUMENT_CATEGORIES.MEDICAL_REPORTS || c === documentCategories_1.DOCUMENT_CATEGORIES.DRIVING_LICENSE || c === documentCategories_1.DOCUMENT_CATEGORIES.CERTIFICATES) {
        return expiryISO || undefined;
    }
    if (c === documentCategories_1.DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE) {
        const issueISO = parseDateToISO(extractedIdentity?.issue_date);
        if (!issueISO)
            return undefined;
        // BUSINESS RULE: Police character certificate expires 3 months after issue date
        return addDaysToISODate(issueISO, 90) || undefined;
    }
    return undefined;
}
const CERTIFICATE_CORE_KEYWORDS = [
    'certificate',
    'cert',
    'qualification',
    'training',
    'credential',
    'achievement',
    'diploma',
    'course',
];
const CERTIFICATE_PROFESSION_KEYWORDS = [
    'police',
    'construction',
    'electrician',
    'plumber',
    'mechanic',
    'welder',
    'carpenter',
    'mason',
    'painter',
    'foreman',
    'supervisor',
    'engineer',
    'technician',
    'driver',
    'chef',
    'cook',
    'nurse',
    'teacher',
    'trainer',
];
const CERTIFICATE_KEYWORDS = [
    ...CERTIFICATE_CORE_KEYWORDS,
    ...CERTIFICATE_PROFESSION_KEYWORDS,
];
const TRUSTED_SPLIT_AI_CONFIDENCE_THRESHOLD = 0.85;
function normalizeStoredCategory(category) {
    return (category || '').toString().toLowerCase().replace(/^photo$/, 'photos').replace(/^cv$/, 'cv_resume');
}
function buildTrustedStoredAiResult(document) {
    if (!document || document.verification_status !== documentCategories_1.VERIFICATION_STATUS.PENDING_AI) {
        return null;
    }
    if (!document.ai_processing_completed_at) {
        return null;
    }
    const category = normalizeStoredCategory(document.detected_category || document.category);
    const confidence = typeof document.ai_confidence === 'number'
        ? document.ai_confidence
        : (typeof document.confidence === 'number' ? document.confidence : undefined);
    if (!category || confidence === undefined || confidence < TRUSTED_SPLIT_AI_CONFIDENCE_THRESHOLD) {
        return null;
    }
    if (category === documentCategories_1.DOCUMENT_CATEGORIES.OTHER_DOCUMENTS) {
        return null;
    }
    const extractedIdentity = document.extracted_identity_json && typeof document.extracted_identity_json === 'object'
        ? document.extracted_identity_json
        : {};
    return {
        success: true,
        category,
        confidence,
        ocr_confidence: typeof document.ocr_confidence === 'number' ? document.ocr_confidence : undefined,
        extracted_identity: extractedIdentity,
    };
}
/**
 * Sign request body with HMAC-SHA256
 */
function signHmac(body) {
    return crypto_1.default.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}
/**
 * Call Python AI service to categorize document and extract identity fields
 */
async function callAICategorizationService(fileContent, fileName, mimeType) {
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
            // Filter out government/police emails that shouldn't be used for candidate matching
            const emailToUse = identity.email && !candidateMatcher_1.CandidateMatcher.isGovernmentEmail(identity.email)
                ? identity.email
                : null;
            if (identity.email && !emailToUse) {
                console.log(`[DocumentVerification] Filtered out government email: ${identity.email}`);
            }
            result.extracted_identity = {
                name: identity.name || null,
                father_name: identity.father_name || null,
                cnic: identity.cnic || null,
                passport_no: identity.passport_no || null,
                email: emailToUse,
                phone: identity.phone || null,
                date_of_birth: identity.date_of_birth || identity.dob || null,
                document_number: identity.document_number || null,
                nationality: identity.nationality || null,
                passport_expiry: identity.passport_expiry || identity.expiry_date || null,
                expiry_date: identity.expiry_date || identity.passport_expiry || null,
                issue_date: identity.issue_date || null,
                place_of_issue: identity.place_of_issue || null,
            };
        }
        else if (result.identity_fields) {
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
    }
    catch (error) {
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
async function processDocumentVerification(job) {
    const { requestId, documentId, candidateId: initialCandidateId, storageBucket, storagePath, fileName, mimeType } = job.data;
    let candidateId = initialCandidateId; // Allow reassignment for auto-matching
    console.log(`[DocumentVerification] Processing job for document ${documentId}, request ${requestId}`);
    const db = (0, database_1.supabaseAdminClient)();
    const { data: currentDocument } = await db
        .from('candidate_documents')
        .select('candidate_id, source, category, detected_category, confidence, ai_confidence, ocr_confidence, extracted_identity_json, ai_processing_completed_at, verification_status')
        .eq('id', documentId)
        .maybeSingle();
    if (currentDocument?.candidate_id) {
        candidateId = currentDocument.candidate_id;
    }
    // IMPORTANT: Avoid expensive re-processing on BullMQ retries.
    // If the document has already moved out of pending_ai (e.g. needs_review/failed/verified),
    // do not call the AI service again.
    if (currentDocument?.verification_status && currentDocument.verification_status !== documentCategories_1.VERIFICATION_STATUS.PENDING_AI) {
        console.log(`[DocumentVerification] Skipping document ${documentId} (verification_status=${currentDocument.verification_status}) — not pending_ai`);
        return {
            success: true,
            skipped: true,
            documentId,
            verification_status: currentDocument.verification_status,
        };
    }
    const allowCandidateReassignment = currentDocument?.source !== 'email';
    const trustedStoredAiResult = buildTrustedStoredAiResult(currentDocument);
    try {
        let aiResult;
        if (trustedStoredAiResult) {
            console.log(`[DocumentVerification] Reusing trusted split AI result for document ${documentId} (category=${trustedStoredAiResult.category}, confidence=${trustedStoredAiResult.confidence})`);
            aiResult = trustedStoredAiResult;
        }
        else {
            // =============================================================================
            // STEP 1: Log AI scan started
            // =============================================================================
            await documentVerificationLogService_1.documentVerificationLogService.logAIScanStarted(requestId, documentId, candidateId);
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
            const arrayBuffer = await fileData.arrayBuffer();
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
            aiResult = await callAICategorizationService(base64Content, fileName, mimeType);
        }
        // Declare errorStage early to avoid "used before declaration" error
        let errorStage = null;
        if (!aiResult.success || aiResult.error) {
            // AI scan failed - use DocumentRejectionService to determine rejection code
            errorStage = 'Categorization';
            const rejectionContext = {
                documentCategory: documentCategories_1.DOCUMENT_CATEGORIES.OTHER_DOCUMENTS, // Unknown category
                extractedIdentity: undefined,
                candidateData: undefined,
                aiConfidence: undefined,
                ocrConfidence: undefined,
                expiryDate: undefined,
                errorStage: 'Categorization',
            };
            const rejectionResult = documentRejectionService_1.DocumentRejectionService.determineRejectionCode(rejectionContext);
            await documentVerificationLogService_1.documentVerificationLogService.logAIScanFailed(requestId, documentId, candidateId, aiResult.error || 'Unknown AI service error', undefined, // errorStack
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
            });
            // Update document with failure status and rejection details
            // FIX 5: Mandatory rejection_code
            await db
                .from('candidate_documents')
                .update({
                verification_status: documentCategories_1.VERIFICATION_STATUS.FAILED,
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
            documentCategories_1.DOCUMENT_CATEGORIES.PASSPORT,
            documentCategories_1.DOCUMENT_CATEGORIES.CNIC,
            documentCategories_1.DOCUMENT_CATEGORIES.DRIVING_LICENSE,
            documentCategories_1.DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE,
            documentCategories_1.DOCUMENT_CATEGORIES.CERTIFICATES,
            documentCategories_1.DOCUMENT_CATEGORIES.MEDICAL_REPORTS,
            documentCategories_1.DOCUMENT_CATEGORIES.PHOTOS,
            documentCategories_1.DOCUMENT_CATEGORIES.CV_RESUME,
        ];
        const expectedNorm = expectedCategory.replace(/^photo$/, 'photos').replace(/^cv$/, 'cv_resume');
        const isStrictExpected = strictTypes.some((t) => t.toLowerCase() === expectedNorm);
        const categoriesMatch = expectedNorm === aiCategory ||
            (expectedNorm === 'photos' && aiCategory === 'photo') ||
            (expectedNorm === 'cv_resume' && (aiCategory === 'cv' || aiCategory === 'cv_resume'));
        if (isStrictExpected && !categoriesMatch) {
            const rejectCategory = strictTypes.find((t) => t.toLowerCase() === expectedNorm) || expectedNorm;
            const rejectionReason = (0, documentCategories_1.getRejectionReasonMessage)(documentCategories_1.REJECTION_REASON_CODES.WRONG_DOCUMENT_TYPE, rejectCategory);
            console.log(`[DocumentVerification] Wrong document type: expected ${expectedNorm}, AI detected ${aiCategory}. Rejecting with: ${rejectionReason}`);
            await documentVerificationLogService_1.documentVerificationLogService.logIdentityVerificationCompleted(requestId, documentId, candidateId, documentCategories_1.VERIFICATION_STATUS.REJECTED_MISMATCH, documentCategories_1.REJECTION_REASON_CODES.WRONG_DOCUMENT_TYPE, ['document_type_mismatch'], { notes: `Expected ${expectedNorm}, AI detected ${aiCategory}` }, {
                rejection_code: documentCategories_1.REJECTION_REASON_CODES.WRONG_DOCUMENT_TYPE,
                rejection_reason: rejectionReason,
                error_stage: 'Categorization',
                retry_possible: false,
                retry_count: 0,
                max_retries: 2,
                rejection_context: { expected_category: expectedNorm, detected_category: aiCategory },
            });
            await db
                .from('candidate_documents')
                .update({
                verification_status: documentCategories_1.VERIFICATION_STATUS.REJECTED_MISMATCH,
                verification_reason_code: documentCategories_1.REJECTION_REASON_CODES.WRONG_DOCUMENT_TYPE,
                rejection_code: documentCategories_1.REJECTION_REASON_CODES.WRONG_DOCUMENT_TYPE,
                rejection_reason: rejectionReason,
                category: expectedNorm,
                detected_category: aiResult.category,
                confidence: aiResult.confidence ?? null,
                ai_confidence: aiResult.confidence ?? null,
                ocr_confidence: aiResult.ocr_confidence ?? null,
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
        await documentVerificationLogService_1.documentVerificationLogService.logAIScanCompleted(requestId, documentId, candidateId, aiResult.category || documentCategories_1.DOCUMENT_CATEGORIES.OTHER_DOCUMENTS, aiResult.confidence || 0, aiResult.ocr_confidence || 0, aiResult.extracted_identity || {}, aiResult // raw AI response
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
        // Secondary classification validation: Detect certificate misclassified as CV
        if ((finalCategory === 'cv' || finalCategory === 'cv_resume') && fileName) {
            const filenameLower = fileName.toLowerCase();
            if (CERTIFICATE_KEYWORDS.some(keyword => filenameLower.includes(keyword))) {
                console.log(`⚠️ [DocumentVerification] AI classified as CV but filename suggests certificate: "${fileName}"`);
                console.log(`   Correcting classification: cv → certificate`);
                finalCategory = 'certificate';
            }
        }
        let finalStatus = documentCategories_1.VERIFICATION_STATUS.VERIFIED;
        let reasonCode = ''; // Empty string for verified (no rejection code needed)
        let mismatchFields = [];
        // New rejection details (from DocumentRejectionService)
        let rejectionCode = null;
        let rejectionReason = undefined;
        let retryPossible = false;
        let isOverridable = true;
        let requiredRole = 'admin';
        if (aiResult.extracted_identity && Object.keys(aiResult.extracted_identity).length > 0) {
            const derivedExpiryDate = deriveExpiryDateForCategory(finalCategory, aiResult.extracted_identity);
            if (!allowCandidateReassignment) {
                console.log(`[DocumentVerification] Preserving matched candidate for email-sourced document ${documentId}; skipping auto-reassignment`);
                try {
                    matchResult = await identityMatchingService_1.identityMatchingService.matchIdentity(candidateId, aiResult.extracted_identity, finalCategory, aiResult.confidence, aiResult.ocr_confidence, derivedExpiryDate, undefined);
                }
                catch (matchError) {
                    if (matchError.message?.includes('Candidate not found')) {
                        console.log(`[DocumentVerification] Email-sourced document candidate_id ${candidateId} not found, marking for review`);
                        finalStatus = documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW;
                        reasonCode = documentCategories_1.REJECTION_REASON_CODES.CANDIDATE_NOT_FOUND;
                        mismatchFields = ['candidate_not_found'];
                        await documentVerificationLogService_1.documentVerificationLogService.logIdentityVerificationCompleted(requestId, documentId, candidateId, documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW, reasonCode, mismatchFields, {
                            notes: 'Email-sourced document candidate could not be found during identity verification.',
                            auto_match_attempted: false,
                        }, {
                            rejection_code: rejectionCode || documentCategories_1.REJECTION_REASON_CODES.CANDIDATE_NOT_FOUND,
                            rejection_reason: rejectionReason || 'Matched email candidate not found',
                            error_stage: 'Matching',
                            retry_possible: false,
                            retry_count: 0,
                            max_retries: 2,
                            rejection_context: {
                                mismatch_fields: mismatchFields,
                                error_message: matchError.message,
                            },
                        });
                    }
                    else {
                        console.error(`[DocumentVerification] Identity matching failed for email-sourced document:`, matchError);
                        finalStatus = documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW;
                        reasonCode = documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND;
                        mismatchFields = ['identity_matching_error'];
                        await documentVerificationLogService_1.documentVerificationLogService.logIdentityVerificationCompleted(requestId, documentId, candidateId, documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW, reasonCode, mismatchFields, { notes: `Identity matching error: ${matchError.message}` }, {
                            rejection_code: rejectionCode || documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND,
                            rejection_reason: rejectionReason || 'Identity matching failed',
                            error_stage: 'Matching',
                            retry_possible: false,
                            retry_count: 0,
                            max_retries: 2,
                            rejection_context: {
                                mismatch_fields: mismatchFields,
                                error_message: matchError.message,
                            },
                        });
                    }
                }
            }
            else {
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
                    const candidateMatch = await candidateMatcher_1.CandidateMatcher.findCandidate(matchCriteria);
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
                        matchResult = await identityMatchingService_1.identityMatchingService.matchIdentity(candidateId, aiResult.extracted_identity, finalCategory, aiResult.confidence, aiResult.ocr_confidence, derivedExpiryDate, undefined // errorStage - set later if needed
                        );
                        console.log(`[DocumentVerification] Identity matching successful: ${matchResult.matched ? 'VERIFIED' : 'NEEDS_REVIEW'}`);
                    }
                    else {
                        // Could not find candidate by extracted identity - try using provided candidate_id as fallback
                        console.log(`[DocumentVerification] Could not find candidate by extracted identity, trying provided candidate_id ${candidateId}...`);
                        try {
                            matchResult = await identityMatchingService_1.identityMatchingService.matchIdentity(candidateId, aiResult.extracted_identity, finalCategory, aiResult.confidence, aiResult.ocr_confidence, derivedExpiryDate, undefined);
                        }
                        catch (matchError) {
                            // Provided candidate_id also doesn't exist - needs manual review
                            if (matchError.message?.includes('Candidate not found')) {
                                console.log(`[DocumentVerification] Provided candidate_id ${candidateId} also not found, marking for review`);
                                finalStatus = documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW;
                                reasonCode = documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND;
                                mismatchFields = ['candidate_not_found'];
                                await documentVerificationLogService_1.documentVerificationLogService.logIdentityVerificationCompleted(requestId, documentId, candidateId, documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW, reasonCode, mismatchFields, {
                                    notes: `Candidate not found. Attempted matching by: ${JSON.stringify(matchCriteria)}. Provided candidate_id also not found.`,
                                    auto_match_attempted: true,
                                    match_result: candidateMatch
                                }, {
                                    rejection_code: rejectionCode || documentCategories_1.REJECTION_REASON_CODES.CANDIDATE_NOT_FOUND,
                                    rejection_reason: rejectionReason || 'No matching candidate found',
                                    error_stage: 'Matching',
                                    retry_possible: false,
                                    retry_count: 0,
                                    max_retries: 2,
                                    rejection_context: {
                                        mismatch_fields: mismatchFields,
                                        match_criteria: matchCriteria,
                                    },
                                });
                            }
                            else {
                                // Other identity matching errors
                                console.error(`[DocumentVerification] Identity matching failed:`, matchError);
                                finalStatus = documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW;
                                reasonCode = documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND;
                                mismatchFields = ['identity_matching_error'];
                                await documentVerificationLogService_1.documentVerificationLogService.logIdentityVerificationCompleted(requestId, documentId, candidateId, documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW, reasonCode, mismatchFields, { notes: `Identity matching error: ${matchError.message}` }, {
                                    rejection_code: rejectionCode || documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND,
                                    rejection_reason: rejectionReason || 'Identity matching failed',
                                    error_stage: 'Matching',
                                    retry_possible: false,
                                    retry_count: 0,
                                    max_retries: 2,
                                    rejection_context: {
                                        mismatch_fields: mismatchFields,
                                        error_message: matchError.message,
                                    },
                                });
                            }
                        }
                    }
                }
                catch (autoMatchError) {
                    // Auto-matching failed - try provided candidate_id as fallback
                    console.error(`[DocumentVerification] Auto-matching failed, trying provided candidate_id:`, autoMatchError);
                    try {
                        matchResult = await identityMatchingService_1.identityMatchingService.matchIdentity(candidateId, aiResult.extracted_identity, finalCategory, aiResult.confidence, aiResult.ocr_confidence, derivedExpiryDate, undefined);
                    }
                    catch (matchError) {
                        // Both failed - needs manual review
                        console.error(`[DocumentVerification] Both auto-match and provided candidate_id failed`);
                        finalStatus = documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW;
                        reasonCode = documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND;
                        mismatchFields = ['identity_matching_error'];
                        await documentVerificationLogService_1.documentVerificationLogService.logIdentityVerificationCompleted(requestId, documentId, candidateId, documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW, reasonCode, mismatchFields, { notes: `Auto-match failed: ${autoMatchError.message}. Identity matching also failed: ${matchError.message}` }, {
                            rejection_code: rejectionCode || documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND,
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
                        });
                    }
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
                    document_expiry_date: derivedExpiryDate,
                    rejection_context: {
                        mismatch_fields: matchResult.mismatch_fields || [],
                        matched: matchResult.matched,
                        matched_on: matchResult.matched_on || [],
                        confidence: matchResult.confidence,
                    },
                } : undefined;
                await documentVerificationLogService_1.documentVerificationLogService.logIdentityVerificationCompleted(requestId, documentId, candidateId, matchResult.matched ? documentCategories_1.VERIFICATION_STATUS.VERIFIED : documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW, matchResult.reason_code, matchResult.mismatch_fields, matchResult, rejectionDetails);
                // Determine verification status based on identity match
                if (matchResult.matched) {
                    finalStatus = documentCategories_1.VERIFICATION_STATUS.VERIFIED;
                    reasonCode = ''; // Empty string for verified (no rejection code needed)
                }
                else if (matchResult.reason_code === documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND) {
                    // No IDs found - needs manual review
                    finalStatus = documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW;
                    reasonCode = documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND;
                    // Extract rejection details if available
                    if (matchResult.rejection_code) {
                        rejectionCode = matchResult.rejection_code;
                        rejectionReason = matchResult.rejection_reason || undefined;
                        retryPossible = matchResult.retry_possible || false;
                        isOverridable = matchResult.is_overridable !== undefined ? matchResult.is_overridable : true;
                        requiredRole = matchResult.required_role || 'admin';
                    }
                }
                else {
                    // Identity mismatch - rejected
                    finalStatus = documentCategories_1.VERIFICATION_STATUS.REJECTED_MISMATCH;
                    reasonCode = matchResult.reason_code;
                    mismatchFields = matchResult.mismatch_fields || [];
                    // Extract rejection details (FIX 5: Mandatory rejection_code)
                    if (matchResult.rejection_code) {
                        rejectionCode = matchResult.rejection_code;
                        rejectionReason = matchResult.rejection_reason || undefined;
                        retryPossible = matchResult.retry_possible || false;
                        isOverridable = matchResult.is_overridable !== undefined ? matchResult.is_overridable : true;
                        requiredRole = matchResult.required_role || 'admin';
                    }
                    else {
                        // FIX 5: Enforce mandatory rejection_code
                        console.error(`[DocumentVerification] ERROR: Document ${documentId} reached rejected_mismatch without rejection_code!`);
                        // Use DocumentRejectionService to determine rejection code
                        // NOTE: Skip expiry validation for passport page 2 (non-main pages)
                        const isPassportPage2 = finalCategory === documentCategories_1.DOCUMENT_CATEGORIES.PASSPORT &&
                            (fileName?.toLowerCase().includes('page 2') ||
                                fileName?.toLowerCase().includes('page2'));
                        const rejectionContext = {
                            documentCategory: finalCategory,
                            extractedIdentity: aiResult.extracted_identity,
                            candidateData: undefined, // Not available in this context
                            aiConfidence: aiResult.confidence,
                            ocrConfidence: aiResult.ocr_confidence,
                            expiryDate: isPassportPage2 ? undefined : (aiResult.extracted_identity?.passport_expiry || aiResult.extracted_identity?.expiry_date),
                            errorStage: undefined,
                            mismatchFields,
                        };
                        const rejectionResult = documentRejectionService_1.DocumentRejectionService.determineRejectionCode(rejectionContext);
                        rejectionCode = rejectionResult.code;
                        rejectionReason = rejectionResult.reason;
                        retryPossible = rejectionResult.retryPossible;
                        isOverridable = rejectionResult.isOverridable;
                        requiredRole = rejectionResult.requiredRole || 'admin';
                    }
                }
            }
        }
        else {
            // No identity fields extracted from document
            // If document was manually uploaded for a specific candidate AND category is correctly identified,
            // we can still verify it since the user explicitly linked it to that candidate
            // Special handling for photos: Photos don't have identity fields, so auto-verify if manually uploaded
            if (aiResult.category === 'photos' || aiResult.category === 'photo') {
                if (candidateId && aiResult.confidence && aiResult.confidence >= documentCategories_1.AI_CONFIDENCE_THRESHOLD) {
                    console.log(`[DocumentVerification] Photo document detected. No identity fields needed. Verifying based on manual upload and high confidence (${aiResult.confidence}).`);
                    finalStatus = documentCategories_1.VERIFICATION_STATUS.VERIFIED;
                    reasonCode = ''; // Empty string for verified (no rejection code needed)
                    await documentVerificationLogService_1.documentVerificationLogService.logIdentityVerificationCompleted(requestId, documentId, candidateId, documentCategories_1.VERIFICATION_STATUS.VERIFIED, reasonCode, undefined, { notes: 'Photo document verified - no identity fields required for photos' }, undefined // No rejection details for verified documents
                    );
                }
                else {
                    // Low confidence or no candidate_id - needs manual review
                    finalStatus = documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW;
                    reasonCode = documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND;
                    await documentVerificationLogService_1.documentVerificationLogService.logIdentityVerificationCompleted(requestId, documentId, candidateId, documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW, reasonCode, undefined, { notes: `Photo document - low confidence (${aiResult.confidence || 'N/A'}) or no candidate_id provided` }, {
                        rejection_code: documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND,
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
                    });
                }
            }
            else if (candidateId && aiResult.confidence && aiResult.confidence >= documentCategories_1.AI_CONFIDENCE_THRESHOLD) {
                // Document category was correctly identified (high confidence) and candidate_id is provided
                // This is a manual upload - trust the user's selection
                console.log(`[DocumentVerification] No identity fields extracted, but document category correctly identified (confidence: ${aiResult.confidence}) and candidate_id provided. Verifying based on manual upload.`);
                finalStatus = documentCategories_1.VERIFICATION_STATUS.VERIFIED;
                reasonCode = ''; // Empty string for verified (no rejection code needed)
                await documentVerificationLogService_1.documentVerificationLogService.logIdentityVerificationCompleted(requestId, documentId, candidateId, documentCategories_1.VERIFICATION_STATUS.VERIFIED, reasonCode, undefined, { notes: 'No identity fields extracted, but verified based on manual upload and correct category identification' }, undefined // No rejection details for verified documents
                );
            }
            else {
                // Low confidence or no candidate_id - needs manual review
                finalStatus = documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW;
                reasonCode = documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND;
                await documentVerificationLogService_1.documentVerificationLogService.logIdentityVerificationCompleted(requestId, documentId, candidateId, documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW, reasonCode, undefined, { notes: `No identity fields extracted. Confidence: ${aiResult.confidence || 'N/A'}, Candidate ID provided: ${!!candidateId}` }, {
                    rejection_code: documentCategories_1.REJECTION_REASON_CODES.NO_ID_FOUND,
                    rejection_reason: 'No identity fields extracted from document',
                    error_stage: 'Extraction',
                    retry_possible: true, // Can retry with better image/processing
                    retry_count: 0,
                    max_retries: 2,
                    rejection_context: {
                        ai_confidence: aiResult.confidence,
                        candidate_id_provided: !!candidateId,
                    },
                });
            }
        }
        // Fallback: If no identity fields were extracted, still infer profession from experience certificate filename
        if (!aiResult.extracted_identity || Object.keys(aiResult.extracted_identity).length === 0) {
            if (candidateId && fileName) {
                const fileNameLower = fileName.toLowerCase();
                const looksLikeCertificate = CERTIFICATE_KEYWORDS.some(keyword => fileNameLower.includes(keyword));
                if (looksLikeCertificate && finalCategory === documentCategories_1.DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES) {
                    try {
                        const { data: currentCandidate, error: candidateError } = await db
                            .from('candidates')
                            .select('position')
                            .eq('id', candidateId)
                            .single();
                        if (!candidateError && currentCandidate && !currentCandidate.position) {
                            const professionInferred = (0, professionInferenceService_1.inferProfessionFromExperienceCertificate)(fileName, finalCategory);
                            if (professionInferred) {
                                console.log(`[DocumentVerification] ✅ Inferred profession from experience certificate filename (no identity): ${professionInferred}`);
                                const { enrichCandidateData } = await Promise.resolve().then(() => __importStar(require('../services/progressiveDataCompletionService')));
                                await enrichCandidateData(candidateId, { position: professionInferred }, 'certificate', documentId, finalCategory);
                            }
                        }
                    }
                    catch (profError) {
                        console.error('[DocumentVerification] Failed fallback profession inference (no identity):', profError);
                    }
                }
            }
        }
        // =============================================================================
        // STEP 6: Category assignment decision
        // =============================================================================
        // Auto-assign category if confidence >= threshold, otherwise set to 'other_documents'
        if (aiResult.confidence && aiResult.confidence >= documentCategories_1.AI_CONFIDENCE_THRESHOLD) {
            // Keep corrected finalCategory (do not overwrite with raw AI category)
        }
        else {
            finalCategory = documentCategories_1.DOCUMENT_CATEGORIES.OTHER_DOCUMENTS;
            if (finalStatus === documentCategories_1.VERIFICATION_STATUS.VERIFIED) {
                // Low confidence but identity verified - needs review for category
                finalStatus = documentCategories_1.VERIFICATION_STATUS.NEEDS_REVIEW;
                reasonCode = documentCategories_1.REJECTION_REASON_CODES.LOW_CONFIDENCE;
                // Use DocumentRejectionService for low confidence rejection
                // NOTE: Skip expiry validation for passport page 2 (non-main pages)
                const isPassportPage2 = finalCategory === documentCategories_1.DOCUMENT_CATEGORIES.PASSPORT &&
                    (fileName?.toLowerCase().includes('page 2') ||
                        fileName?.toLowerCase().includes('page2'));
                const rejectionContext = {
                    documentCategory: finalCategory,
                    extractedIdentity: aiResult.extracted_identity,
                    candidateData: undefined,
                    aiConfidence: aiResult.confidence,
                    ocrConfidence: aiResult.ocr_confidence,
                    expiryDate: isPassportPage2 ? undefined : (aiResult.extracted_identity?.passport_expiry || aiResult.extracted_identity?.expiry_date),
                    errorStage: undefined,
                };
                const rejectionResult = documentRejectionService_1.DocumentRejectionService.determineRejectionCode(rejectionContext);
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
        if ((finalStatus === documentCategories_1.VERIFICATION_STATUS.REJECTED_MISMATCH || finalStatus === documentCategories_1.VERIFICATION_STATUS.FAILED) && !rejectionCode) {
            console.error(`[DocumentVerification] ERROR: Document ${documentId} reached ${finalStatus} without rejection_code! Using DocumentRejectionService...`);
            // Determine rejection code using DocumentRejectionService
            const rejectionContext = {
                documentCategory: finalCategory,
                extractedIdentity: aiResult.extracted_identity,
                candidateData: undefined,
                aiConfidence: aiResult.confidence,
                ocrConfidence: aiResult.ocr_confidence,
                expiryDate: aiResult.extracted_identity?.passport_expiry || aiResult.extracted_identity?.expiry_date,
                errorStage: errorStage || undefined,
                mismatchFields,
            };
            const rejectionResult = documentRejectionService_1.DocumentRejectionService.determineRejectionCode(rejectionContext);
            rejectionCode = rejectionResult.code;
            rejectionReason = rejectionResult.reason;
            retryPossible = rejectionResult.retryPossible;
            isOverridable = rejectionResult.isOverridable;
            requiredRole = rejectionResult.requiredRole || 'admin';
        }
        // Prepare update object with all rejection details
        const updateData = {
            category: finalCategory,
            confidence: aiResult.confidence, // Ensure confidence is saved
            verification_status: finalStatus,
            verification_reason_code: reasonCode,
            mismatch_fields: mismatchFields.length > 0 ? mismatchFields : null,
            verification_completed_at: new Date().toISOString(),
        };
        // Add rejection details if document is rejected or failed
        if (finalStatus === documentCategories_1.VERIFICATION_STATUS.REJECTED_MISMATCH || finalStatus === documentCategories_1.VERIFICATION_STATUS.FAILED) {
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
            // Set document expiry date if available (category-aware)
            const derivedExpiryDate = deriveExpiryDateForCategory(finalCategory, aiResult.extracted_identity);
            if (derivedExpiryDate) {
                updateData.document_expiry_date = derivedExpiryDate;
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
        // IMPORTANT: Receipt flags must be evidence-driven (verified docs only).
        // Do NOT use filename keywords or CV text mentions to satisfy certificate receipt.
        try {
            if (finalStatus !== documentCategories_1.VERIFICATION_STATUS.VERIFIED) {
                // Avoid marking documents received for rejected/failed/needs_review.
                // Candidate receipt flags should reflect verified evidence.
                return;
            }
            const updateFlags = {};
            const category = finalCategory?.toLowerCase() || '';
            const now = new Date().toISOString();
            if (category === 'cv_resume' || category === 'cv') {
                updateFlags.cv_received = true;
                updateFlags.cv_received_at = now;
            }
            else if (category === 'passport') {
                updateFlags.passport_received = true;
                updateFlags.passport_received_at = now;
            }
            else if (category === 'cnic') {
                updateFlags.cnic_received = true;
                updateFlags.cnic_received_at = now;
            }
            else if (category === 'driving_license') {
                updateFlags.driving_license_received = true;
                updateFlags.driving_license_received_at = now;
            }
            else if (category === 'police_character_certificate') {
                updateFlags.police_character_certificate_received = true;
                updateFlags.police_character_certificate_received_at = now;
            }
            else if (category === 'educational_documents') {
                updateFlags.educational_documents_received = true;
                updateFlags.educational_documents_received_at = now;
            }
            else if (category === 'experience_certificates') {
                updateFlags.experience_certificates_received = true;
                updateFlags.experience_certificates_received_at = now;
            }
            else if (category === 'navttc_reports') {
                updateFlags.navttc_received = true;
                updateFlags.navttc_received_at = now;
            }
            else if (category === 'certificates' || category === 'certificate') {
                updateFlags.certificate_received = true;
                updateFlags.certificate_received_at = now;
            }
            else if (category === 'contracts') {
                updateFlags.contract_received = true;
                updateFlags.contract_received_at = now;
            }
            else if (category === 'photos' || category === 'photo') {
                updateFlags.photo_received = true;
                updateFlags.photo_received_at = now;
            }
            else if (category === 'medical_reports' || category === 'medical') {
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
        }
        catch (flagError) {
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
            Object.values(aiResult.extracted_identity).some((val) => val !== null && val !== undefined && val !== '');
        if (hasIdentityFields && finalStatus === documentCategories_1.VERIFICATION_STATUS.VERIFIED && aiResult.extracted_identity) {
            console.log(`[DocumentVerification] Progressive enrichment condition met - proceeding with enrichment`);
            try {
                // Import progressive completion service
                const { enrichCandidateData, updateMissingFields } = await Promise.resolve().then(() => __importStar(require('../services/progressiveDataCompletionService')));
                // Fetch current candidate to check for missing fields
                const { data: currentCandidate, error: candidateError } = await db
                    .from('candidates')
                    .select('position')
                    .eq('id', candidateId)
                    .single();
                if (candidateError) {
                    console.warn(`[DocumentVerification] Could not fetch current candidate for profession inference:`, candidateError);
                }
                // Determine document source type from category
                let documentSource = 'other';
                if (finalCategory === 'cv_resume' || finalCategory === 'cv') {
                    documentSource = 'cv';
                }
                else if (finalCategory === 'passport') {
                    documentSource = 'passport';
                }
                else if (finalCategory === 'cnic') {
                    documentSource = 'passport'; // Use 'passport' source type for CNIC to ensure nationality precedence
                }
                else if (finalCategory === 'driving_license') {
                    documentSource = 'driving_license';
                }
                else if (finalCategory === 'medical_report' || finalCategory === 'medical') {
                    documentSource = 'medical';
                }
                else if (finalCategory === 'certificate' || finalCategory === 'certificates') {
                    documentSource = 'certificate';
                }
                // Map extracted_identity to enrichment data format
                const enrichmentData = {};
                const identity = aiResult.extracted_identity;
                if (identity.name)
                    enrichmentData.name = identity.name;
                if (identity.father_name)
                    enrichmentData.father_name = identity.father_name;
                if (identity.cnic)
                    enrichmentData.cnic = identity.cnic;
                if (identity.passport_no)
                    enrichmentData.passport_no = identity.passport_no; // Will be mapped to passport_normalized
                // ABSOLUTE EMAIL FILTERING: NEVER include government/police emails from ANY document
                // This protects against police certificates, government IDs, etc. that extract government emails
                if (identity.email && !candidateMatcher_1.CandidateMatcher.isGovernmentEmail(identity.email)) {
                    // Only use email from CV documents for primary email (most trusted source)
                    // For other documents, store email but it won't be used for matching
                    enrichmentData.email = identity.email;
                }
                else if (identity.email && candidateMatcher_1.CandidateMatcher.isGovernmentEmail(identity.email)) {
                    console.log(`[DocumentVerification] ⚠️ FILTERING OUT government/police email from ${documentSource}: ${identity.email}`);
                    // Do NOT add to enrichmentData - email is completely rejected
                }
                if (identity.phone)
                    enrichmentData.phone = identity.phone;
                if (identity.date_of_birth)
                    enrichmentData.date_of_birth = identity.date_of_birth;
                if (identity.nationality) {
                    enrichmentData.nationality = identity.nationality;
                    console.log(`[DocumentVerification] 🌍 Extracted nationality: "${identity.nationality}" from ${documentSource} document (category: ${aiResult.category})`);
                }
                else {
                    console.log(`[DocumentVerification] ⚠️ No nationality extracted from ${documentSource} document (category: ${aiResult.category})`);
                }
                if (identity.passport_expiry || identity.expiry_date)
                    enrichmentData.passport_expiry = identity.passport_expiry || identity.expiry_date;
                if (identity.place_of_issue)
                    enrichmentData.place_of_issue = identity.place_of_issue;
                // Log enrichment data being sent
                console.log(`[DocumentVerification] Enrichment data for ${documentSource}:`, Object.keys(enrichmentData));
                // Enrich candidate data (progressive completion)
                const enrichmentResult = await enrichCandidateData(candidateId, enrichmentData, documentSource, documentId, aiResult.category);
                console.log(`[DocumentVerification] ✅ Progressive enrichment completed:`, {
                    updated: enrichmentResult.updated,
                    skipped: enrichmentResult.skipped,
                    source: documentSource,
                });
                // Special handling for experience certificates only: infer profession from the certificate filename
                if (finalCategory === documentCategories_1.DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES && currentCandidate && !currentCandidate.position) {
                    const professionInferred = (0, professionInferenceService_1.inferProfessionFromExperienceCertificate)(fileName, aiResult.category);
                    if (professionInferred) {
                        console.log(`[DocumentVerification] ✅ Inferred profession from experience certificate: ${professionInferred}`);
                        try {
                            const professionResult = await enrichCandidateData(candidateId, { position: professionInferred }, 'certificate', documentId, aiResult.category);
                            console.log('[DocumentVerification] Profession enrichment result:', professionResult.updated);
                        }
                        catch (profError) {
                            console.error('[DocumentVerification] Failed to update inferred profession:', profError);
                            // Don't fail - profession inference is optional
                        }
                    }
                }
                // Recalculate missing fields
                await updateMissingFields(candidateId);
                // Send missing-data email via Hostinger SMTP
                try {
                    const { maybeSendMissingDataEmail } = await Promise.resolve().then(() => __importStar(require('../services/missingDataEmailService')));
                    await maybeSendMissingDataEmail({ candidateId, trigger: 'document_verified' });
                }
                catch (emailErr) {
                    console.warn('[DocumentVerification] Missing-data email send failed (non-fatal):', emailErr);
                }
            }
            catch (enrichmentError) {
                console.error('[DocumentVerification] ❌ Exception in progressive enrichment:', enrichmentError);
                console.error('[DocumentVerification] Error stack:', enrichmentError?.stack);
                // Don't fail the verification if candidate update fails
            }
        }
        // Log final status change
        await documentVerificationLogService_1.documentVerificationLogService.log({
            request_id: requestId,
            candidate_id: candidateId,
            document_id: documentId,
            event_type: 'verification_status_changed',
            event_status: 'success',
            verification_status: finalStatus,
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
    }
    catch (error) {
        console.error(`[DocumentVerification] Error processing document ${documentId}:`, error);
        // Log error (parameters: requestId, errorMessage, errorStack?, documentId?, candidateId?, metadata?)
        await documentVerificationLogService_1.documentVerificationLogService.logError(requestId, error.message || 'Unknown error', error.stack, documentId, candidateId, { error_type: 'document_verification_failed' });
        // Update document with failed status
        await db
            .from('candidate_documents')
            .update({
            verification_status: documentCategories_1.VERIFICATION_STATUS.FAILED,
            verification_completed_at: new Date().toISOString(),
        })
            .eq('id', documentId);
        throw error;
    }
}
/**
 * Create and start the document verification worker
 */
function startDocumentVerificationWorker() {
    const worker = new bullmq_1.Worker('document-verification', processDocumentVerification, {
        connection: redis_1.redis,
        concurrency: 1,
        drainDelay: 60, // seconds — idle poll every 60s instead of 5s
        stalledInterval: 300000, // check stalled jobs every 5 min instead of 30s
        lockDuration: 60000,
        limiter: {
            max: 10,
            duration: 60000,
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
