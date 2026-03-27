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
exports.formatDocumentResponse = formatDocumentResponse;
exports.uploadCandidateDocument = uploadCandidateDocument;
exports.getCandidateDocumentById = getCandidateDocumentById;
exports.listCandidateDocumentsByCandidate = listCandidateDocumentsByCandidate;
exports.getCandidateDocumentSignedUrl = getCandidateDocumentSignedUrl;
exports.deleteCandidateDocument = deleteCandidateDocument;
exports.updateDocumentVerification = updateDocumentVerification;
exports.reprocessDocumentVerification = reprocessDocumentVerification;
exports.overrideDocumentVerification = overrideDocumentVerification;
const database_1 = require("../config/database");
const crypto_1 = __importDefault(require("crypto"));
const documentCategories_1 = require("../config/documentCategories");
const documentVerificationLogService_1 = require("./documentVerificationLogService");
const queue_1 = require("../config/queue");
const errorHandling_1 = require("../utils/errorHandling");
const splitUploadService_1 = require("./splitUploadService");
const crypto_2 = require("crypto");
const documentNaming_1 = require("../utils/documentNaming");
const splitDocumentProcessor_1 = require("../utils/splitDocumentProcessor");
const hybridPhotoExtractionService_1 = require("./hybridPhotoExtractionService");
const aiProfilePhotoExtractionService_1 = require("./aiProfilePhotoExtractionService");
const STORAGE_BUCKET = 'documents';
function hasProfilePhoto(candidate) {
    return !!(candidate?.profile_photo_path ||
        candidate?.profile_photo_url ||
        (candidate?.profile_photo_bucket && candidate?.profile_photo_path));
}
/**
 * Format document response with rejection details for API
 * Includes rejection object for ALL document types when status is rejected_mismatch or failed
 */
async function formatDocumentResponse(document) {
    const db = (0, database_1.supabaseAdminClient)();
    const baseResponse = {
        id: document.id,
        candidate_id: document.candidate_id,
        file_name: document.file_name,
        mime_type: document.mime_type,
        category: document.category,
        detected_category: document.detected_category,
        verification_status: document.verification_status,
        verification_reason_code: document.verification_reason_code,
        confidence: document.confidence,
        source: document.source,
        received_at: document.received_at,
        created_at: document.created_at,
        updated_at: document.updated_at,
        // Always include verification source and override info if present
        verification_source: document.verification_source || null,
        overridden_by: document.overridden_by || null,
        overridden_at: document.overridden_at || null,
        override_reason: document.override_reason || null,
    };
    // Fetch admin name from override logs if document was overridden
    if (document.verification_source === 'admin_override' && document.overridden_by) {
        try {
            const { data: overrideLog } = await db
                .from('admin_override_logs')
                .select('overridden_by_name')
                .eq('document_id', document.id)
                .order('overridden_at', { ascending: false })
                .limit(1)
                .single();
            if (overrideLog?.overridden_by_name) {
                baseResponse.overridden_by_name = overrideLog.overridden_by_name;
            }
        }
        catch (error) {
            // If override log doesn't exist or query fails, continue without name
            console.log('[FormatDocumentResponse] Could not fetch override admin name:', error.message);
        }
    }
    // Include rejection details for ALL document types when rejected or failed
    if (document.verification_status === documentCategories_1.VERIFICATION_STATUS.REJECTED_MISMATCH ||
        document.verification_status === documentCategories_1.VERIFICATION_STATUS.FAILED) {
        baseResponse.rejection = {
            rejection_code: document.rejection_code || null,
            rejection_reason: document.rejection_reason || null,
            mismatch_fields: document.mismatch_fields || [],
            ai_confidence: document.ai_confidence !== null && document.ai_confidence !== undefined
                ? document.ai_confidence
                : null, // 0-1 scale
            ocr_confidence: document.ocr_confidence !== null && document.ocr_confidence !== undefined
                ? document.ocr_confidence
                : null, // 0-1 scale
            error_stage: document.error_stage || null,
            retry_possible: document.retry_possible || false,
            retry_count: document.retry_count || 0,
            max_retries: document.max_retries || 2,
            document_expiry_date: document.document_expiry_date || null,
            rejection_context: document.rejection_context || null, // JSONB with mismatch details
        };
        // Include override information if document was overridden (even if now rejected)
        if (document.verification_source === 'admin_override') {
            baseResponse.rejection.overridden = {
                by: document.overridden_by || null,
                at: document.overridden_at || null,
                reason: document.override_reason || null,
            };
            if (baseResponse.overridden_by_name) {
                baseResponse.rejection.overridden.by_name = baseResponse.overridden_by_name;
            }
        }
    }
    return baseResponse;
}
/**
 * Calculate SHA256 hash of file buffer
 */
function calculateSHA256(buffer) {
    return crypto_1.default.createHash('sha256').update(buffer).digest('hex');
}
/**
 * Generate storage path for candidate document
 */
function generateStoragePath(candidateId, fileName) {
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `candidates/${candidateId}/documents/${timestamp}_${sanitizedFileName}`;
}
/**
 * Upload document with AI verification workflow
 * - Stores file in private bucket
 * - Creates candidate_documents record with status = PENDING_AI
 * - Enqueues AI processing job
 * - Logs upload event to verification logs
 */
async function uploadCandidateDocument(data) {
    const db = (0, database_1.supabaseAdminClient)();
    const logService = new documentVerificationLogService_1.DocumentVerificationLogService();
    const requestId = (0, documentVerificationLogService_1.generateRequestId)();
    try {
        // File validation
        const allowedTypes = [
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/jpg',
            'text/plain',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (!data.file_name || !data.mime_type || !data.buffer) {
            const errMsg = 'Missing file_name, mime_type, or buffer';
            await logService.logError(requestId, errMsg, undefined, undefined, data.candidate_id);
            throw new errorHandling_1.AppError(errMsg, errorHandling_1.ErrorType.VALIDATION, 400);
        }
        if (data.buffer.length === 0) {
            const errMsg = 'File is empty';
            await logService.logError(requestId, errMsg, undefined, undefined, data.candidate_id);
            throw new errorHandling_1.AppError(errMsg, errorHandling_1.ErrorType.VALIDATION, 400);
        }
        if (data.buffer.length > maxSize) {
            const errMsg = 'File exceeds 10MB size limit';
            await logService.logError(requestId, errMsg, undefined, undefined, data.candidate_id);
            throw new errorHandling_1.AppError(errMsg, errorHandling_1.ErrorType.VALIDATION, 400);
        }
        if (!allowedTypes.includes(data.mime_type)) {
            const errMsg = `Unsupported file type: ${data.mime_type}`;
            await logService.logError(requestId, errMsg, undefined, undefined, data.candidate_id);
            throw new errorHandling_1.AppError(errMsg, errorHandling_1.ErrorType.VALIDATION, 400);
        }
        // Validate candidate_id format first (before any logging)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(data.candidate_id) || data.candidate_id === '00000000-0000-0000-0000-000000000000') {
            const errMsg = 'Invalid candidate_id format';
            throw new errorHandling_1.AppError(errMsg, errorHandling_1.ErrorType.VALIDATION, 400);
        }
        // Verify candidate exists BEFORE logging (to avoid foreign key violations)
        const { data: candidate, error: candidateError } = await db
            .from('candidates')
            .select('id')
            .eq('id', data.candidate_id)
            .single();
        if (candidateError || !candidate) {
            const errMsg = `Candidate not found: ${data.candidate_id}`;
            throw new errorHandling_1.AppError(errMsg, errorHandling_1.ErrorType.VALIDATION, 404);
        }
        // Generate unique request ID for tracing
        console.log(`[UploadDocument] Starting upload for candidate ${data.candidate_id}, request_id: ${requestId}`);
        // Log upload started (now safe because candidate exists)
        await logService.logUploadStarted(requestId, data.candidate_id, data.file_name, data.mime_type, data.buffer.length, data.uploaded_by_user_id);
        // ============================================================================
        // SPLIT-AND-CATEGORIZE: For PDFs, try splitting into multiple documents
        // ============================================================================
        if (data.mime_type === 'application/pdf') {
            try {
                console.log(`[UploadDocument] PDF detected, attempting split-and-categorize`);
                // Preserve original PDF
                const uploadId = (0, crypto_2.randomUUID)();
                const originalPath = await (0, splitUploadService_1.preserveOriginalPdf)(data.buffer, uploadId, data.mime_type);
                console.log(`[UploadDocument] Original PDF preserved at: ${originalPath}`);
                // Call split-and-categorize
                const base64 = data.buffer.toString('base64');
                const splitResult = await (0, splitUploadService_1.callSplitAndCategorize)(base64, data.file_name, data.mime_type, undefined, // candidateData - could fetch candidate data if needed
                true // useTextract
                );
                // If split returned multiple documents, create candidate_documents for each
                if (splitResult.documents && splitResult.documents.length > 1) {
                    console.log(`[UploadDocument] Split returned ${splitResult.documents.length} documents, creating candidate_documents records`);
                    const createdDocuments = [];
                    for (const splitDoc of splitResult.documents) {
                        const pdfBuffer = Buffer.from(splitDoc.pdf_base64, 'base64');
                        const docTypeLower = (splitDoc.doc_type || '').toLowerCase();
                        // Special handling: if split produced a PHOTOS PDF section, try hybrid extraction
                        // from that section and skip creating split_photos document if successful.
                        if ((docTypeLower === 'photo' || docTypeLower === 'photos') && splitDoc.is_image !== true) {
                            try {
                                console.log(`[UploadDocument] Photos PDF detected for candidate ${data.candidate_id}. Attempting hybrid extraction from photos section...`);
                                const extractionResult = await (0, hybridPhotoExtractionService_1.extractProfilePhotoHybrid)(data.candidate_id, uploadId, pdfBuffer);
                                if (extractionResult.success && extractionResult.photoBuffer) {
                                    const uploaded = await (0, hybridPhotoExtractionService_1.uploadExtractedPhotoToCandidatePhotos)(data.candidate_id, uploadId, extractionResult.photoBuffer);
                                    console.log(`[UploadDocument] ✅ Hybrid photos-section extraction succeeded (method=${extractionResult.method}). Skipping split_photos document creation.`, {
                                        candidateId: data.candidate_id,
                                        uploadId,
                                        storagePath: uploaded.storagePath,
                                    });
                                    continue;
                                }
                                console.log(`[UploadDocument] Hybrid photos-section extraction did not produce a photo. Continuing with normal split document creation.`, {
                                    candidateId: data.candidate_id,
                                    uploadId,
                                });
                            }
                            catch (hyErr) {
                                console.warn(`[UploadDocument] Hybrid photos-section extraction error; continuing with normal split document creation:`, hyErr?.message || hyErr);
                            }
                        }
                        const folder = (0, splitUploadService_1.docTypeToFolder)(splitDoc.doc_type);
                        // Use shared utility to handle image detection, profile photo saving, and storage upload
                        let processed;
                        try {
                            processed = await (0, splitDocumentProcessor_1.processSplitDocument)(splitDoc, data.candidate_id, uploadId, folder);
                        }
                        catch (processErr) {
                            console.error(`[UploadDocument] Failed to process split doc ${splitDoc.doc_type}:`, processErr.message);
                            continue;
                        }
                        // Map parser doc_type to candidate_documents category
                        const categoryMap = {
                            cv_resume: documentCategories_1.DOCUMENT_CATEGORIES.CV_RESUME,
                            passport: documentCategories_1.DOCUMENT_CATEGORIES.PASSPORT,
                            national_id: documentCategories_1.DOCUMENT_CATEGORIES.CNIC,
                            cnic: documentCategories_1.DOCUMENT_CATEGORIES.CNIC,
                            driving_license: documentCategories_1.DOCUMENT_CATEGORIES.DRIVING_LICENSE,
                            police_character_certificate: documentCategories_1.DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE,
                            police_certificate: documentCategories_1.DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE,
                            police_clearance: documentCategories_1.DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE,
                            educational_documents: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                            educational_document: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                            degree: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                            diploma: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                            transcript: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                            marksheet: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                            experience_certificate: documentCategories_1.DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES,
                            experience_certificates: documentCategories_1.DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES,
                            employment_certificate: documentCategories_1.DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES,
                            experience_letter: documentCategories_1.DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES,
                            navttc_report: documentCategories_1.DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
                            navttc_reports: documentCategories_1.DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
                            navttc: documentCategories_1.DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
                            navttc_certificate: documentCategories_1.DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
                            vocational_certificate: documentCategories_1.DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
                            medical_reports: documentCategories_1.DOCUMENT_CATEGORIES.MEDICAL_REPORTS,
                            medical_certificate: documentCategories_1.DOCUMENT_CATEGORIES.MEDICAL_REPORTS,
                            certificates: documentCategories_1.DOCUMENT_CATEGORIES.CERTIFICATES,
                            certificate: documentCategories_1.DOCUMENT_CATEGORIES.CERTIFICATES,
                            professional_certificate: documentCategories_1.DOCUMENT_CATEGORIES.CERTIFICATES,
                            contracts: documentCategories_1.DOCUMENT_CATEGORIES.CONTRACTS,
                            contract: documentCategories_1.DOCUMENT_CATEGORIES.CONTRACTS,
                            photos: documentCategories_1.DOCUMENT_CATEGORIES.PHOTOS,
                            other_documents: documentCategories_1.DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
                        };
                        const category = categoryMap[splitDoc.doc_type] || documentCategories_1.DOCUMENT_CATEGORIES.OTHER_DOCUMENTS;
                        // Map parser doc_type to database document_type (must match CHECK constraint)
                        // Allowed values: 'passport', 'cnic', 'driving_license', 'police_character_certificate', 'degree', 'medical', 'visa', 'certificate', 'other'
                        const docTypeMap = {
                            passport: 'passport',
                            cnic: 'cnic',
                            national_id: 'cnic',
                            driving_license: 'driving_license',
                            police_character_certificate: 'police_character_certificate',
                            police_certificate: 'police_character_certificate',
                            police_clearance: 'police_character_certificate',
                            educational_documents: 'degree',
                            educational_document: 'degree',
                            degree: 'degree',
                            diploma: 'degree',
                            transcript: 'degree',
                            marksheet: 'degree',
                            experience_certificate: 'certificate',
                            experience_certificates: 'certificate',
                            employment_certificate: 'certificate',
                            experience_letter: 'certificate',
                            navttc_report: 'certificate',
                            navttc_reports: 'certificate',
                            navttc: 'certificate',
                            navttc_certificate: 'certificate',
                            vocational_certificate: 'certificate',
                            cv_resume: 'other', // CV/resume maps to 'other' in database
                            medical_reports: 'medical',
                            medical_certificate: 'medical',
                            certificate: 'certificate',
                            certificates: 'certificate',
                            professional_certificate: 'certificate',
                            contracts: 'other',
                            contract: 'other',
                            photos: 'other',
                            other_documents: 'other',
                        };
                        const dbDocumentType = docTypeMap[splitDoc.doc_type] || 'other';
                        // Fetch candidate name for better filename
                        let candidateName;
                        try {
                            const { data: candidate } = await db
                                .from('candidates')
                                .select('name')
                                .eq('id', data.candidate_id)
                                .single();
                            candidateName = candidate?.name;
                        }
                        catch (e) {
                            console.log('[UploadDocument] Could not fetch candidate name');
                        }
                        // Generate descriptive filename (use timestamp from processed path)
                        const ts = Date.now();
                        const descriptiveFilename = (0, documentNaming_1.generateDescriptiveFilename)({
                            doc_type: splitDoc.doc_type,
                            pages: splitDoc.pages,
                            split_strategy: splitDoc.split_strategy,
                            page_number: splitDoc.pages && splitDoc.pages.length === 1 ? splitDoc.pages[0] : undefined,
                        }, candidateName, ts);
                        // Create candidate_documents record
                        // For extracted profile photos, set verification_status to 'verified' to skip approval workflow
                        const verificationStatus = processed.shouldAutoVerify
                            ? documentCategories_1.VERIFICATION_STATUS.VERIFIED
                            : documentCategories_1.VERIFICATION_STATUS.PENDING_AI;
                        const splitDocData = {
                            candidate_id: data.candidate_id,
                            document_type: dbDocumentType,
                            category,
                            detected_category: category,
                            confidence: splitDoc.confidence || null,
                            storage_bucket: STORAGE_BUCKET,
                            storage_path: processed.storagePath,
                            file_name: descriptiveFilename,
                            mime_type: processed.mimeType, // Use detected MIME type (image/jpeg for photos)
                            source: data.source || 'manual',
                            status: 'received',
                            verification_status: verificationStatus, // Auto-verify extracted photos
                            received_at: new Date().toISOString(),
                        };
                        const { data: createdDoc, error: splitDbErr } = await db
                            .from('candidate_documents')
                            .insert(splitDocData)
                            .select()
                            .single();
                        if (splitDbErr) {
                            console.error(`[UploadDocument] Failed to create candidate_document for ${splitDoc.doc_type}:`, splitDbErr);
                            await db.storage.from(STORAGE_BUCKET).remove([processed.storagePath]);
                            continue;
                        }
                        // Permanent safety net: if photos split remains a PDF, auto-run AI extraction now.
                        if (category === documentCategories_1.DOCUMENT_CATEGORIES.PHOTOS && processed.mimeType === 'application/pdf') {
                            try {
                                const { data: candidatePhotoState } = await db
                                    .from('candidates')
                                    .select('profile_photo_bucket, profile_photo_path, profile_photo_url')
                                    .eq('id', data.candidate_id)
                                    .maybeSingle();
                                if (!hasProfilePhoto(candidatePhotoState)) {
                                    const aiResult = await (0, aiProfilePhotoExtractionService_1.extractProfilePhotoFromPdfUsingAI)({
                                        candidateId: data.candidate_id,
                                        documentId: createdDoc.id,
                                        maxPages: 10,
                                    });
                                    console.log(`[UploadDocument] ✅ AI extracted profile photo from split photos PDF`, {
                                        candidateId: data.candidate_id,
                                        documentId: createdDoc.id,
                                        pageUsed: aiResult.pageUsed,
                                        confidence: aiResult.confidence,
                                    });
                                }
                            }
                            catch (aiExtractErr) {
                                console.warn(`[UploadDocument] AI extraction from split photos PDF failed (non-fatal):`, aiExtractErr?.message || aiExtractErr);
                            }
                        }
                        createdDocuments.push(createdDoc);
                        // Enqueue AI verification job for this split document (skip for auto-verified photos)
                        if (verificationStatus !== documentCategories_1.VERIFICATION_STATUS.VERIFIED) {
                            const splitRequestId = (0, documentVerificationLogService_1.generateRequestId)();
                            try {
                                console.log(`[UploadDocument] Attempting to enqueue verification job for split doc ${createdDoc.id}...`);
                                const jobResult = await queue_1.documentVerificationQueue.add('verify-document', {
                                    requestId: splitRequestId,
                                    documentId: createdDoc.id,
                                    candidateId: data.candidate_id,
                                    storageBucket: STORAGE_BUCKET,
                                    storagePath: processed.storagePath,
                                    fileName: createdDoc.file_name,
                                    mimeType: processed.mimeType,
                                }, {
                                    attempts: 3,
                                    backoff: { type: 'exponential', delay: 2000 },
                                });
                                console.log(`[UploadDocument] ✅ Enqueued AI verification for split doc ${createdDoc.id} (${splitDoc.doc_type}) - Job ID: ${jobResult.id}`);
                            }
                            catch (queueErr) {
                                console.error(`[UploadDocument] ❌ Failed to enqueue job for split doc ${createdDoc.id}:`, queueErr.message || queueErr);
                                console.error(`[UploadDocument] Queue error details:`, queueErr);
                            }
                        }
                        else {
                            console.log(`[UploadDocument] ⏭️  Skipped AI verification for auto-verified photo ${createdDoc.id}`);
                        }
                    }
                    if (createdDocuments.length > 0) {
                        console.log(`[UploadDocument] Successfully created ${createdDocuments.length} candidate_documents from split`);
                        // Return the first document (for API compatibility)
                        return {
                            document: createdDocuments[0],
                            request_id: requestId,
                        };
                    }
                }
                else if (splitResult.documents && splitResult.documents.length === 1) {
                    console.log(`[UploadDocument] Split returned 1 document, continuing with single-document flow`);
                    // Fall through to single-document flow below
                }
                else {
                    console.log(`[UploadDocument] Split returned 0 documents, falling back to single-document flow`);
                    // Fall through to single-document flow below
                }
            }
            catch (splitError) {
                console.error(`[UploadDocument] Split-and-categorize failed, falling back to single-document flow:`, splitError.message);
                // Fall through to single-document flow below
            }
        }
        // ============================================================================
        // SINGLE-DOCUMENT FLOW: Upload as one document (fallback or non-PDF)
        // ============================================================================
        // Generate storage path
        const storagePath = generateStoragePath(data.candidate_id, data.file_name);
        // Upload to Supabase Storage (private bucket)
        const { error: uploadError } = await db.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, data.buffer, {
            contentType: data.mime_type,
            upsert: false,
        });
        if (uploadError) {
            await logService.logError(requestId, `Failed to upload file: ${uploadError.message}`, undefined, undefined, data.candidate_id);
            throw new Error(`Failed to upload file: ${uploadError.message}`);
        }
        console.log(`[UploadDocument] File uploaded to storage: ${storagePath}`);
        // Map frontend document_type (passport, cnic, cv, etc.) to DB category and document_type for "expected type" validation
        const uploadDocType = (data.document_type || '').toLowerCase().replace(/\s+/g, '_');
        const uploadCategoryMap = {
            passport: documentCategories_1.DOCUMENT_CATEGORIES.PASSPORT,
            cnic: documentCategories_1.DOCUMENT_CATEGORIES.CNIC,
            driving_license: documentCategories_1.DOCUMENT_CATEGORIES.DRIVING_LICENSE,
            police_character_certificate: documentCategories_1.DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE,
            educational_documents: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
            degree: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
            diploma: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
            experience_certificate: documentCategories_1.DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES,
            experience: documentCategories_1.DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES,
            navttc: documentCategories_1.DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
            navttc_report: documentCategories_1.DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
            certificate: documentCategories_1.DOCUMENT_CATEGORIES.CERTIFICATES,
            photo: documentCategories_1.DOCUMENT_CATEGORIES.PHOTOS,
            medical: documentCategories_1.DOCUMENT_CATEGORIES.MEDICAL_REPORTS,
            cv: documentCategories_1.DOCUMENT_CATEGORIES.CV_RESUME,
            resume: documentCategories_1.DOCUMENT_CATEGORIES.CV_RESUME,
        };
        const uploadDocTypeMap = {
            passport: 'passport',
            cnic: 'cnic',
            driving_license: 'driving_license',
            police_character_certificate: 'police_character_certificate',
            certificate: 'certificate',
            photo: 'photo',
            medical: 'medical',
            cv: 'other', // DB may use 'other' for cv when single upload; category holds cv_resume
            resume: 'other',
        };
        const expectedCategory = uploadCategoryMap[uploadDocType];
        const expectedDocType = uploadDocTypeMap[uploadDocType] || 'other';
        const isImagePhotoUpload = expectedCategory === documentCategories_1.DOCUMENT_CATEGORIES.PHOTOS && (data.mime_type || '').toLowerCase().startsWith('image/');
        // Create candidate_documents record with status = PENDING_AI; store expected type when provided
        const documentData = {
            candidate_id: data.candidate_id,
            document_type: expectedCategory ? expectedDocType : 'other',
            storage_bucket: STORAGE_BUCKET,
            storage_path: storagePath,
            file_name: data.file_name,
            mime_type: data.mime_type,
            source: data.source || 'manual',
            status: 'received',
            verification_status: isImagePhotoUpload ? documentCategories_1.VERIFICATION_STATUS.VERIFIED : documentCategories_1.VERIFICATION_STATUS.PENDING_AI,
            received_at: new Date().toISOString(),
        };
        if (expectedCategory) {
            documentData.category = expectedCategory;
            documentData.detected_category = expectedCategory;
        }
        const { data: document, error: dbError } = await db
            .from('candidate_documents')
            .insert(documentData)
            .select()
            .single();
        if (dbError) {
            // Rollback: delete uploaded file
            await db.storage.from(STORAGE_BUCKET).remove([storagePath]);
            await logService.logError(requestId, `Failed to create document record: ${dbError.message}`, undefined, undefined, data.candidate_id);
            throw new Error(`Failed to create document record: ${dbError.message}`);
        }
        console.log(`[UploadDocument] Document record created: ${document.id}`);
        // Log upload completed
        await logService.logUploadCompleted(requestId, document.id, data.candidate_id, STORAGE_BUCKET, storagePath);
        if (!isImagePhotoUpload) {
            // Enqueue AI processing job
            try {
                const jobData = {
                    requestId,
                    documentId: document.id,
                    candidateId: data.candidate_id,
                    storageBucket: STORAGE_BUCKET,
                    storagePath,
                    fileName: data.file_name,
                    mimeType: data.mime_type,
                };
                await queue_1.documentVerificationQueue.add('verify-document', jobData, {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 2000,
                    },
                });
                console.log(`[UploadDocument] Enqueued AI verification job for document ${document.id}`);
            }
            catch (queueError) {
                console.error('[UploadDocument] Failed to enqueue AI job:', queueError);
                // Don't fail the upload, but log the error
                await logService.logError(requestId, `Failed to enqueue AI job: ${queueError.message}`, queueError.stack, document.id, data.candidate_id);
            }
        }
        else {
            console.log(`[UploadDocument] ⏭️  Skipped AI verification for auto-verified photo ${document.id}`);
            // Immediately set candidate profile photo for image uploads
            try {
                await db
                    .from('candidates')
                    .update({
                    profile_photo_bucket: STORAGE_BUCKET,
                    profile_photo_path: storagePath,
                    profile_photo_url: null,
                    photo_received: true,
                    photo_received_at: new Date().toISOString(),
                })
                    .eq('id', data.candidate_id);
            }
            catch (photoUpdateError) {
                console.error('[UploadDocument] Failed to update candidate profile photo for image upload:', photoUpdateError);
            }
        }
        // Update candidate document flags based on filename and document_type
        // This ensures the candidate card shows correct document status IMMEDIATELY
        // We check filename first since category might not be set until AI processes it
        try {
            const updateFlags = {};
            const category = document.category?.toLowerCase() || '';
            const fileName = (data.file_name || '').toLowerCase();
            const documentType = (document.document_type || '').toLowerCase();
            const now = new Date().toISOString();
            // Check filename and document_type for immediate flag setting (before AI categorization)
            if (category === 'cv_resume' || category === 'cv' ||
                fileName.includes('cv') || fileName.includes('resume') ||
                documentType === 'cv') {
                updateFlags.cv_received = true;
                updateFlags.cv_received_at = now;
            }
            else if (category === 'passport' ||
                fileName.includes('passport') ||
                documentType === 'passport') {
                updateFlags.passport_received = true;
                updateFlags.passport_received_at = now;
            }
            else if (category === 'certificates' || category === 'certificate' ||
                fileName.includes('certificate') || fileName.includes('degree') || fileName.includes('diploma') ||
                documentType === 'certificate' || documentType === 'degree') {
                updateFlags.certificate_received = true;
                updateFlags.certificate_received_at = now;
                updateFlags.degree_received = true;
                updateFlags.degree_received_at = now;
            }
            else if (category === 'photos' || category === 'photo' ||
                fileName.includes('photo') || fileName.includes('profile') ||
                documentType === 'photo') {
                updateFlags.photo_received = true;
                updateFlags.photo_received_at = now;
            }
            else if (category === 'medical_reports' || category === 'medical' ||
                fileName.includes('medical') ||
                documentType === 'medical') {
                updateFlags.medical_received = true;
                updateFlags.medical_received_at = now;
            }
            else if (category === 'cnic' || documentType === 'cnic' || fileName.includes('cnic') || fileName.includes('id card')) {
                updateFlags.cnic_received = true;
                updateFlags.cnic_received_at = now;
            }
            else if (category === 'driving_license' || documentType === 'driving_license' || fileName.includes('driving') || fileName.includes('license') || fileName.includes('dl')) {
                updateFlags.driving_license_received = true;
                updateFlags.driving_license_received_at = now;
            }
            else if (category === 'police_character_certificate' || documentType === 'police_character_certificate' || fileName.includes('police') || fileName.includes('character') || fileName.includes('pcc')) {
                updateFlags.police_character_received = true;
                updateFlags.police_character_received_at = now;
            }
            else if (documentType === 'visa' || fileName.includes('visa')) {
                updateFlags.visa_received = true;
                updateFlags.visa_received_at = now;
            }
            if (Object.keys(updateFlags).length > 0) {
                await db
                    .from('candidates')
                    .update(updateFlags)
                    .eq('id', data.candidate_id);
                console.log(`[UploadDocument] Updated candidate flags for ${data.candidate_id} based on filename/document_type:`, Object.keys(updateFlags));
            }
            else {
                console.log(`[UploadDocument] No flags updated for ${data.file_name} - will be set after AI categorization`);
            }
        }
        catch (flagError) {
            console.error('[UploadDocument] Failed to update candidate flags:', flagError);
            // Don't fail the upload if flag update fails
        }
        return {
            document: document,
            request_id: requestId,
        };
    }
    catch (error) {
        console.error('[UploadDocument] Upload failed:', error);
        // Log error if not already logged
        try {
            await logService.logError(requestId, error.message || 'Upload failed', error.stack, undefined, data.candidate_id);
        }
        catch (logError) {
            console.error('[UploadDocument] Failed to log error:', logError);
        }
        throw error;
    }
}
/**
 * Get candidate document by ID
 */
async function getCandidateDocumentById(documentId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('candidate_documents')
        .select('*')
        .eq('id', documentId)
        .single();
    if (error) {
        if (error.code === 'PGRST116') {
            return null;
        }
        throw new Error(`Failed to fetch document: ${error.message}`);
    }
    return data;
}
/**
 * List all documents for a candidate
 */
async function listCandidateDocumentsByCandidate(candidateId, category) {
    const db = (0, database_1.supabaseAdminClient)();
    let query = db
        .from('candidate_documents')
        .select('*')
        .eq('candidate_id', candidateId)
        .order('created_at', { ascending: false });
    if (category) {
        query = query.eq('category', category);
    }
    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to list documents: ${error.message}`);
    }
    return (data || []);
}
/**
 * Get document signed URL for download
 */
async function getCandidateDocumentSignedUrl(documentId, expiresIn = 3600) {
    const db = (0, database_1.supabaseAdminClient)();
    const document = await getCandidateDocumentById(documentId);
    if (!document) {
        throw new Error('Document not found');
    }
    const { data, error } = await db.storage
        .from(document.storage_bucket)
        .createSignedUrl(document.storage_path, expiresIn);
    if (error || !data) {
        throw new Error(`Failed to generate signed URL: ${error?.message}`);
    }
    return data.signedUrl;
}
/**
 * Delete candidate document and update candidate flags
 */
async function deleteCandidateDocument(documentId) {
    const db = (0, database_1.supabaseAdminClient)();
    const document = await getCandidateDocumentById(documentId);
    if (!document) {
        throw new Error('Document not found');
    }
    const candidateId = document.candidate_id;
    const category = document.category?.toLowerCase() || '';
    // Delete from storage
    const { error: storageError } = await db.storage
        .from(document.storage_bucket)
        .remove([document.storage_path]);
    if (storageError) {
        console.error('Failed to delete file from storage:', storageError);
        // Continue with database deletion even if storage deletion fails
    }
    // Delete from database
    const { error: dbError } = await db
        .from('candidate_documents')
        .delete()
        .eq('id', documentId);
    if (dbError) {
        throw new Error(`Failed to delete document: ${dbError.message}`);
    }
    // After deletion, recalculate and update candidate flags
    // Check if there are any remaining documents of this category
    try {
        // Check candidate_documents table
        const { data: remainingDocs } = await db
            .from('candidate_documents')
            .select('category')
            .eq('candidate_id', candidateId);
        // Check inbox_attachments for CVs
        const { data: inboxAttachments } = await db
            .from('inbox_attachments')
            .select('attachment_type, file_name, document_type, attachment_kind')
            .or(`candidate_id.eq.${candidateId},linked_candidate_id.eq.${candidateId}`);
        // Check old documents table
        const { data: oldDocuments } = await db
            .from('documents')
            .select('doc_type, file_name')
            .eq('candidate_id', candidateId)
            .eq('deleted_at', null);
        // Combine all document sources
        const allDocs = [
            ...(remainingDocs || []).map(d => ({ category: d.category, type: null, file_name: null, source_table: 'candidate_documents' })),
            ...(inboxAttachments || []).map(d => ({
                category: d.attachment_kind === 'cv' ? 'cv_resume' : d.document_type,
                type: d.attachment_type,
                file_name: d.file_name,
                source_table: 'inbox_attachments'
            })),
            ...(oldDocuments || []).map(d => ({ category: null, type: d.doc_type, file_name: d.file_name, source_table: 'documents' }))
        ];
        // Determine which flags to set based on remaining documents
        const updateFlags = {};
        // Initialize all flags to false first
        updateFlags.cv_received = false;
        updateFlags.passport_received = false;
        updateFlags.certificate_received = false;
        updateFlags.photo_received = false;
        updateFlags.medical_received = false;
        // Set flags to true if documents exist
        for (const doc of allDocs) {
            const docCategory = (doc.category || '').toLowerCase();
            const docType = (doc.type || '').toLowerCase();
            const fileName = (doc.file_name || '').toLowerCase();
            // Check category first (new system)
            if (docCategory === 'cv_resume' || docCategory === 'cv') {
                updateFlags.cv_received = true;
            }
            // Check doc_type (old system or inbox attachment document_type)
            else if (docType === 'cv' || docType.includes('resume')) {
                updateFlags.cv_received = true;
            }
            // Check filename as fallback
            else if (fileName.includes('cv') || fileName.includes('resume')) {
                updateFlags.cv_received = true;
            }
            if (docCategory === 'passport' || docType === 'passport' || fileName.includes('passport')) {
                updateFlags.passport_received = true;
            }
            // Check for certificates - handle both singular and plural, and also check for 'cert' abbreviation
            if (docCategory === 'certificates' || docCategory === 'certificate' || docCategory === 'cert' ||
                docType === 'certificate' || docType === 'cert' ||
                fileName.includes('certificate') || fileName.includes('cert')) {
                updateFlags.certificate_received = true;
            }
            if (docCategory === 'photos' || docCategory === 'photo' || docType === 'photo' || fileName.includes('photo')) {
                updateFlags.photo_received = true;
            }
            if (docCategory === 'medical_reports' || docCategory === 'medical' || docType === 'medical' || fileName.includes('medical')) {
                updateFlags.medical_received = true;
            }
        }
        // Update candidate flags
        if (Object.keys(updateFlags).length > 0) {
            const { error: updateError } = await db
                .from('candidates')
                .update(updateFlags)
                .eq('id', candidateId);
            if (updateError) {
                console.error(`[DeleteDocument] Failed to update flags:`, updateError);
            }
            else {
                console.log(`[DeleteDocument] Updated candidate flags for ${candidateId} after deletion:`, {
                    cv: updateFlags.cv_received,
                    passport: updateFlags.passport_received,
                    certificate: updateFlags.certificate_received,
                    photo: updateFlags.photo_received,
                    medical: updateFlags.medical_received,
                });
                console.log(`[DeleteDocument] Found ${allDocs.length} remaining documents for candidate ${candidateId}`);
            }
        }
        else {
            console.log(`[DeleteDocument] No flags to update for candidate ${candidateId}`);
        }
    }
    catch (flagError) {
        console.error('[DeleteDocument] Failed to update candidate flags after deletion:', flagError);
        // Don't fail the deletion if flag update fails
    }
}
/**
 * Update document verification status and category
 */
async function updateDocumentVerification(documentId, updates) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db
        .from('candidate_documents')
        .update({
        ...updates,
        updated_at: new Date().toISOString(),
    })
        .eq('id', documentId)
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to update document: ${error.message}`);
    }
    return data;
}
/**
 * Reprocess document verification - re-enqueue AI verification job
 * This is useful when matching logic is updated and we want to re-process existing documents
 */
async function reprocessDocumentVerification(documentId) {
    const db = (0, database_1.supabaseAdminClient)();
    const logService = new documentVerificationLogService_1.DocumentVerificationLogService();
    const requestId = (0, documentVerificationLogService_1.generateRequestId)();
    try {
        // Get document details including retry information
        const { data: document, error: docError } = await db
            .from('candidate_documents')
            .select('id, candidate_id, storage_path, file_name, mime_type, storage_bucket, retry_count, max_retries, verification_status')
            .eq('id', documentId)
            .single();
        if (docError || !document) {
            throw new errorHandling_1.AppError('Document not found', errorHandling_1.ErrorType.NOT_FOUND, 404);
        }
        // FIX 4: Check retry limit before reprocessing
        const currentRetryCount = document.retry_count || 0;
        const maxRetries = document.max_retries || 2;
        if (currentRetryCount >= maxRetries) {
            throw new errorHandling_1.AppError(`Maximum retry limit reached (${currentRetryCount}/${maxRetries}). Document cannot be reprocessed automatically.`, errorHandling_1.ErrorType.VALIDATION, 400);
        }
        // FIX 4: Increment retry_count
        const newRetryCount = currentRetryCount + 1;
        // Reset document status to pending_ai and increment retry count
        await db
            .from('candidate_documents')
            .update({
            verification_status: documentCategories_1.VERIFICATION_STATUS.PENDING_AI,
            verification_reason_code: null,
            mismatch_fields: null,
            ai_processing_started_at: null,
            ai_processing_completed_at: null,
            verification_completed_at: null,
            retry_count: newRetryCount, // Increment retry count
            updated_at: new Date().toISOString(),
        })
            .eq('id', documentId);
        // Enqueue AI processing job
        const jobData = {
            requestId,
            documentId: document.id,
            candidateId: document.candidate_id,
            storageBucket: document.storage_bucket || STORAGE_BUCKET,
            storagePath: document.storage_path,
            fileName: document.file_name,
            mimeType: document.mime_type || 'application/pdf',
        };
        await queue_1.documentVerificationQueue.add('verify-document', jobData, {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000,
            },
        });
        console.log(`[ReprocessDocument] Re-enqueued AI verification job for document ${documentId}`);
        // Log reprocess event (using logUploadStarted to track the reprocess)
        await logService.logUploadStarted(requestId, document.candidate_id, document.file_name, document.mime_type || 'application/pdf', 0 // file size not needed for reprocess
        );
        return {
            success: true,
            request_id: requestId,
        };
    }
    catch (error) {
        console.error('[ReprocessDocument] Failed to reprocess document:', error);
        await logService.logError(requestId, `Failed to reprocess document: ${error.message}`, error.stack, documentId, undefined);
        throw error;
    }
}
/**
 * Ensure user exists in users table (for FK integrity)
 * Creates user record if it doesn't exist, updates if it does
 * Idempotent - safe to call multiple times
 *
 * This function ensures Supabase Auth users have corresponding entries in the users table
 * to satisfy foreign key constraints in admin_override_logs and other tables.
 */
async function ensureUserExists(userId, email, name, role) {
    const db = (0, database_1.supabaseAdminClient)();
    try {
        // Check if user exists by ID (primary key)
        const { data: existingUser, error: checkError } = await db
            .from('users')
            .select('id, email, name, role')
            .eq('id', userId)
            .single();
        if (checkError && checkError.code !== 'PGRST116') {
            // PGRST116 = not found, which is expected if user doesn't exist
            // Other errors are unexpected
            console.warn(`[EnsureUser] Error checking user ${userId}:`, checkError);
        }
        if (!existingUser) {
            // User doesn't exist - create it
            const { error: insertError } = await db
                .from('users')
                .insert({
                id: userId,
                email: email,
                name: name || email.split('@')[0] || 'Admin User',
                role: role || 'Admin',
                status: 'Active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            });
            if (insertError) {
                // Handle unique constraint violation (email already exists with different ID - shouldn't happen)
                if (insertError.code === '23505') { // Unique violation
                    console.warn(`[EnsureUser] User with email ${email} already exists, attempting update by email...`);
                    // Try to find user by email and update ID if needed
                    const { data: userByEmail } = await db
                        .from('users')
                        .select('id')
                        .eq('email', email)
                        .single();
                    if (userByEmail && userByEmail.id !== userId) {
                        console.warn(`[EnsureUser] Email ${email} exists with different ID ${userByEmail.id}, updating to ${userId}...`);
                        // Update existing user's ID to match auth user ID
                        const { error: updateError } = await db
                            .from('users')
                            .update({
                            id: userId,
                            name: name || email.split('@')[0] || 'Admin User',
                            role: role || 'Admin',
                            updated_at: new Date().toISOString(),
                        })
                            .eq('email', email);
                        if (updateError) {
                            console.error(`[EnsureUser] Failed to update user by email:`, updateError);
                        }
                    }
                    else {
                        // User exists but our check missed it - try update by ID
                        const { error: updateError } = await db
                            .from('users')
                            .update({
                            email: email,
                            name: name || email.split('@')[0] || 'Admin User',
                            role: role || 'Admin',
                            updated_at: new Date().toISOString(),
                        })
                            .eq('id', userId);
                        if (updateError) {
                            console.warn(`[EnsureUser] Failed to update user ${userId}:`, updateError);
                        }
                    }
                }
                else {
                    console.error(`[EnsureUser] Failed to create user ${userId}:`, insertError);
                }
            }
            else {
                console.log(`[EnsureUser] ✅ Created user record for ${userId} (${email})`);
            }
        }
        else {
            // User exists - update if info changed
            const needsUpdate = existingUser.email !== email ||
                (name && existingUser.name !== name) ||
                (role && existingUser.role !== role);
            if (needsUpdate) {
                const { error: updateError } = await db
                    .from('users')
                    .update({
                    email: email,
                    ...(name && { name }),
                    ...(role && { role }),
                    updated_at: new Date().toISOString(),
                })
                    .eq('id', userId);
                if (updateError) {
                    console.warn(`[EnsureUser] Failed to update user ${userId}:`, updateError);
                }
                else {
                    console.log(`[EnsureUser] ✅ Updated user record for ${userId}`);
                }
            }
        }
    }
    catch (error) {
        // Don't fail the operation if user sync fails
        // This is a best-effort sync for FK integrity
        console.warn(`[EnsureUser] Error ensuring user exists (non-fatal):`, error);
    }
}
/**
 * Admin override document verification
 * Allows admin/super_admin to override AI rejection and mark document as verified
 *
 * @param documentId - Document ID to override
 * @param adminUserId - Admin user ID (from auth context)
 * @param adminEmail - Admin email (for password verification)
 * @param adminPassword - Admin password (for verification)
 * @param justification - Required justification reason (minimum 10 characters)
 * @param adminRole - Admin role ('admin' or 'super_admin')
 * @returns Updated document
 */
async function overrideDocumentVerification(documentId, adminUserId, // Optional - will be verified from password
adminEmail, adminPassword, justification, adminRole // Optional - will be verified from password
) {
    const db = (0, database_1.supabaseAdminClient)();
    const logService = new documentVerificationLogService_1.DocumentVerificationLogService();
    // Validation
    if (!justification || justification.trim().length < 10) {
        throw new errorHandling_1.AppError('Justification must be at least 10 characters', errorHandling_1.ErrorType.VALIDATION, 400);
    }
    // Get document with rejection details
    const { data: document, error: docError } = await db
        .from('candidate_documents')
        .select('*')
        .eq('id', documentId)
        .single();
    if (docError || !document) {
        throw new errorHandling_1.AppError('Document not found', errorHandling_1.ErrorType.NOT_FOUND, 404);
    }
    // Check if document is in rejected/failed state
    if (document.verification_status !== documentCategories_1.VERIFICATION_STATUS.REJECTED_MISMATCH &&
        document.verification_status !== documentCategories_1.VERIFICATION_STATUS.FAILED) {
        throw new errorHandling_1.AppError(`Document is not in a rejected state. Current status: ${document.verification_status}`, errorHandling_1.ErrorType.VALIDATION, 400);
    }
    // Check if rejection is overridable
    const rejectionCode = document.rejection_code;
    // Type guard: check if rejectionCode is a valid RejectionReasonCode
    const isValidRejectionCode = (code) => {
        if (!code)
            return false;
        return Object.values(documentCategories_1.REJECTION_REASON_CODES).includes(code);
    };
    if (rejectionCode && isValidRejectionCode(rejectionCode) && !(0, documentCategories_1.isRejectionOverridable)(rejectionCode)) {
        throw new errorHandling_1.AppError(`This rejection code (${rejectionCode}) cannot be overridden. It requires super_admin privileges and indicates a serious security issue.`, errorHandling_1.ErrorType.FORBIDDEN, 403);
    }
    // Check required role
    const requiredRole = (rejectionCode && isValidRejectionCode(rejectionCode))
        ? (0, documentCategories_1.getRequiredOverrideRole)(rejectionCode)
        : 'admin';
    if (requiredRole === 'super_admin' && adminRole !== 'super_admin') {
        throw new errorHandling_1.AppError(`This rejection requires super_admin privileges. Your role: ${adminRole}`, errorHandling_1.ErrorType.FORBIDDEN, 403);
    }
    // Verify admin password using Supabase Auth
    let verifiedUserId;
    let verifiedUserRole;
    let verifiedUserName;
    try {
        const { data: authData, error: authError } = await db.auth.signInWithPassword({
            email: adminEmail,
            password: adminPassword,
        });
        if (authError || !authData.user) {
            throw new errorHandling_1.AppError('Invalid admin credentials', errorHandling_1.ErrorType.UNAUTHORIZED, 401);
        }
        // Verify user has admin role
        const userRole = authData.user.user_metadata?.role?.toLowerCase() || '';
        if (userRole !== 'admin' && userRole !== 'super_admin') {
            throw new errorHandling_1.AppError('User does not have admin privileges', errorHandling_1.ErrorType.FORBIDDEN, 403);
        }
        // Use verified user ID from auth response
        verifiedUserId = authData.user.id;
        verifiedUserRole = userRole;
        verifiedUserName = authData.user.user_metadata?.name || authData.user.user_metadata?.full_name || undefined;
        // Verify user ID matches if provided
        if (adminUserId && adminUserId !== verifiedUserId) {
            throw new errorHandling_1.AppError('User ID mismatch', errorHandling_1.ErrorType.FORBIDDEN, 403);
        }
    }
    catch (error) {
        if (error instanceof errorHandling_1.AppError) {
            throw error;
        }
        throw new errorHandling_1.AppError('Failed to verify admin credentials', errorHandling_1.ErrorType.UNAUTHORIZED, 401);
    }
    // Get admin user details for audit log (optional - may not exist in all setups)
    let adminName = verifiedUserName || adminEmail;
    try {
        const { data: adminUser } = await db
            .from('users')
            .select('id, name, email, role')
            .eq('id', verifiedUserId)
            .single();
        if (adminUser?.name) {
            adminName = adminUser.name;
        }
    }
    catch (userError) {
        // Users table may not exist or user may not be in it - use email as fallback
        console.log('[OverrideDocument] Could not fetch user details from users table, using email:', adminEmail);
    }
    // Ensure user exists in users table for FK integrity (auto-sync)
    await ensureUserExists(verifiedUserId, adminEmail, adminName !== adminEmail ? adminName : verifiedUserName, verifiedUserRole === 'super_admin' ? 'Super Admin' : 'Admin');
    const adminRoleUsed = requiredRole; // Role used for override (may differ from user's role)
    // Update document status to verified
    const now = new Date().toISOString();
    const { data: updatedDocument, error: updateError } = await db
        .from('candidate_documents')
        .update({
        verification_status: documentCategories_1.VERIFICATION_STATUS.VERIFIED,
        verification_source: 'admin_override',
        override_reason: justification.trim(),
        overridden_by: verifiedUserId,
        overridden_at: now,
        verification_completed_at: now,
        updated_at: now,
    })
        .eq('id', documentId)
        .select()
        .single();
    if (updateError || !updatedDocument) {
        throw new errorHandling_1.AppError(`Failed to update document: ${updateError?.message}`, errorHandling_1.ErrorType.DATABASE, 500);
    }
    // Create audit log entry
    try {
        // User is now guaranteed to exist in users table (via ensureUserExists)
        await db
            .from('admin_override_logs')
            .insert({
            document_id: documentId,
            candidate_id: document.candidate_id,
            document_category: document.category || null,
            action: 'ADMIN_OVERRIDE',
            previous_status: document.verification_status,
            previous_rejection_code: document.rejection_code || null,
            previous_rejection_reason: document.rejection_reason || null,
            override_reason: justification.trim(),
            required_role: requiredRole,
            overridden_by: verifiedUserId, // FK to users(id) - now guaranteed to exist
            overridden_by_name: adminName,
            overridden_by_role: adminRoleUsed,
            overridden_at: now,
            override_context: {
                document_category: document.category,
                rejection_code: document.rejection_code,
                ai_confidence: document.ai_confidence,
                ocr_confidence: document.ocr_confidence,
                error_stage: document.error_stage,
            },
        });
        console.log(`[OverrideDocument] ✅ Audit log created for override by ${verifiedUserId}`);
    }
    catch (logError) {
        // This should not happen now that we ensure user exists, but handle gracefully
        console.error('[OverrideDocument] Failed to create audit log:', logError);
        // Don't fail the override if audit log fails (shouldn't happen, but safety net)
    }
    // Log verification completion with override source
    try {
        await logService.logIdentityVerificationCompleted((0, documentVerificationLogService_1.generateRequestId)(), documentId, document.candidate_id, documentCategories_1.VERIFICATION_STATUS.VERIFIED, undefined, // reasonCode (legacy, not needed for override)
        undefined, // mismatchFields (not applicable for override)
        undefined, // matchingResult (not applicable for override)
        {
            rejection_code: document.rejection_code || null,
            rejection_reason: `Admin override: ${justification.trim()}`,
            error_stage: undefined,
            retry_possible: false,
            rejection_context: {
                verification_source: 'admin_override',
                override_reason: justification.trim(),
                overridden_by: verifiedUserId,
                previous_status: document.verification_status,
            },
        });
    }
    catch (logError) {
        console.error('[OverrideDocument] Failed to log verification completion:', logError);
        // Don't fail the override if logging fails
    }
    // Update candidate document flags
    try {
        const { updateDocumentFlagsController } = await Promise.resolve().then(() => __importStar(require('../controllers/candidateController')));
        const mockReq = { params: { id: document.candidate_id }, body: {} };
        const mockRes = {
            status: (code) => ({
                json: (data) => {
                    if (code >= 400) {
                        console.error(`[OverrideDocument] Flag update failed (${code}):`, data);
                    }
                }
            }),
            json: () => { }
        };
        await updateDocumentFlagsController(mockReq, mockRes);
    }
    catch (flagError) {
        console.error('[OverrideDocument] Failed to update document flags:', flagError);
        // Don't fail the override if flag update fails
    }
    console.log(`[OverrideDocument] ✅ Document ${documentId} overridden by admin ${verifiedUserId} (${adminRoleUsed})`);
    return updatedDocument;
}
