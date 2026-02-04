"use strict";
/**
 * Split-and-categorize upload flow:
 * 1. Preserve original PDF in original_uploads/upload_<uuid>.pdf
 * 2. Call POST /split-and-categorize (parser, HMAC)
 * 3. Create candidate if none
 * 4. For each documents[]: decode, upload to folder by doc_type, create document record
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOC_TYPE_TO_FOLDER = void 0;
exports.docTypeToFolder = docTypeToFolder;
exports.preserveOriginalPdf = preserveOriginalPdf;
exports.callSplitAndCategorize = callSplitAndCategorize;
exports.createCandidateFromIdentity = createCandidateFromIdentity;
exports.ensureCandidateId = ensureCandidateId;
exports.splitUpload = splitUpload;
const crypto_1 = __importDefault(require("crypto"));
const crypto_2 = require("crypto");
const database_1 = require("../config/database");
const candidateService_1 = require("./candidateService");
const timelineService_1 = require("./timelineService");
const documentService_1 = require("./documentService");
const documentNaming_1 = require("../utils/documentNaming");
const splitDocumentProcessor_1 = require("../utils/splitDocumentProcessor");
const progressiveDataCompletionService_1 = require("./progressiveDataCompletionService");
const STORAGE_BUCKET = 'documents';
const ORIGINAL_PREFIX = 'original_uploads';
const PARSER_URL = process.env.PYTHON_CV_PARSER_URL || process.env.PARSER_URL || 'http://127.0.0.1:8000';
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET || '';
/**
 * Mandatory doc_type -> storage folder mapping.
 * Unknown / unmapped -> other_documents/
 *
 * ⚠️ BUSINESS RULE: certificates folder = Professional/IT certifications ONLY
 * - Educational documents (degrees, diplomas) → educational_documents
 * - Experience letters → experience_certificates
 * - NAVTTC vocational certs → navttc_reports
 * - Police clearance → police_character_certificate
 */
exports.DOC_TYPE_TO_FOLDER = {
    // Identity documents
    passport: 'passport',
    driving_license: 'driving_license',
    national_id: 'cnic',
    cnic: 'cnic',
    // Police clearance certificates
    police_character_certificate: 'police_character_certificate',
    police_certificate: 'police_character_certificate',
    police_clearance: 'police_character_certificate',
    character_certificate: 'police_character_certificate',
    pcc: 'police_character_certificate',
    // Educational documents (academic qualifications)
    educational_documents: 'educational_documents',
    educational_document: 'educational_documents',
    degree: 'educational_documents',
    diploma: 'educational_documents',
    transcript: 'educational_documents',
    marksheet: 'educational_documents',
    academic_certificate: 'educational_documents',
    university_degree: 'educational_documents',
    college_diploma: 'educational_documents',
    // Experience certificates (employment proof)
    experience_certificate: 'experience_certificates',
    experience_certificates: 'experience_certificates',
    employment_certificate: 'experience_certificates',
    experience_letter: 'experience_certificates',
    service_certificate: 'experience_certificates',
    employment_letter: 'experience_certificates',
    work_reference: 'experience_certificates',
    // NAVTTC vocational training (government technical training)
    navttc_report: 'navttc_reports',
    navttc_reports: 'navttc_reports',
    navtic_report: 'navttc_reports',
    nvtc_report: 'navttc_reports',
    navttc: 'navttc_reports',
    navttc_certificate: 'navttc_reports',
    vocational_certificate: 'navttc_reports',
    trade_certificate: 'navttc_reports',
    technical_training: 'navttc_reports',
    // Professional/IT certifications ONLY
    cv_resume: 'cv_resume',
    medical_certificate: 'medical_reports',
    medical_reports: 'medical_reports',
    certificate: 'certificates',
    certificates: 'certificates',
    professional_certificate: 'certificates',
    skill_certificate: 'certificates',
    contract: 'contracts',
    contracts: 'contracts',
    photos: 'other_documents',
    other_documents: 'other_documents',
};
function docTypeToFolder(docType) {
    const t = (docType || '').trim().toLowerCase();
    return exports.DOC_TYPE_TO_FOLDER[t] ?? 'other_documents';
}
/**
 * Preserve original upload: store raw file as-is at original_uploads/upload_<uuid>.pdf (immutable).
 * Uses actual mimeType for Content-Type when storing.
 */
async function preserveOriginalPdf(buffer, uploadId, mimeType = 'application/pdf') {
    const db = (0, database_1.supabaseAdminClient)();
    const path = `${ORIGINAL_PREFIX}/upload_${uploadId}.pdf`;
    const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, buffer, {
        contentType: mimeType || 'application/pdf',
        upsert: false,
    });
    if (error)
        throw new Error(`Failed to preserve original PDF: ${error.message}`);
    return path;
}
/**
 * Compute HMAC-SHA256(secret, body) hex for parser x-hmac-signature.
 */
function hmacSignature(body) {
    if (!HMAC_SECRET)
        throw new Error('PYTHON_HMAC_SECRET is required for split-and-categorize');
    return crypto_1.default.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}
/**
 * Call POST /split-and-categorize on Python parser. HMAC auth.
 */
async function callSplitAndCategorize(fileContentBase64, fileName, mimeType, candidateData, useTextract) {
    const payload = {
        file_content: fileContentBase64,
        file_name: fileName,
        mime_type: mimeType,
        candidate_data: candidateData ?? null,
        use_textract: useTextract ?? true,
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = hmacSignature(body);
    const res = await fetch(`${PARSER_URL.replace(/\/$/, '')}/split-and-categorize`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-hmac-signature': sig,
        },
        body,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Parser split-and-categorize failed (${res.status}): ${text}`);
    }
    const json = (await res.json());
    if (!json.success || !Array.isArray(json.documents)) {
        throw new Error('Parser returned invalid split-and-categorize response');
    }
    return json;
}
/**
 * Create candidate from parser identity when no candidate_id. Use name or placeholder.
 * If identity matches existing (cnic/passport), return existing candidate id.
 */
async function createCandidateFromIdentity(identity, userId) {
    const cnic = identity?.cnic || undefined;
    const passport = identity?.passport_no || undefined;
    const duplicates = await (0, candidateService_1.checkForDuplicates)(cnic, passport);
    if (duplicates.length > 0) {
        return { id: duplicates[0].id };
    }
    const name = identity?.name || identity?.father_name || 'Unknown';
    // Filter government emails
    let email = identity?.email || undefined;
    if (email && (0, progressiveDataCompletionService_1.isGovernmentEmail)(email)) {
        console.log(`🚫 Filtered government email in split upload: ${email}`);
        email = undefined;
    }
    const data = {
        name: String(name).trim() || 'Unknown',
        email,
        phone: identity?.phone || undefined,
        date_of_birth: identity?.date_of_birth || undefined,
        cnic,
        passport,
    };
    const candidate = await (0, candidateService_1.createCandidate)(data, userId);
    return { id: candidate.id };
}
/**
 * Ensure we have a candidate_id: use existing (if found) or create from identity.
 * If candidate_id provided but not found, create new candidate from identity.
 */
async function ensureCandidateId(candidateId, identity, userId) {
    if (candidateId) {
        const db = (0, database_1.supabaseAdminClient)();
        const { data, error } = await db.from('candidates').select('id').eq('id', candidateId).single();
        if (!error && data)
            return candidateId;
    }
    const { id } = await createCandidateFromIdentity(identity, userId);
    return id;
}
/**
 * Upload one split document to storage and create DB record.
 */
async function uploadOneSplitDoc(candidateId, doc, uploadId, userId, engineUsed) {
    const db = (0, database_1.supabaseAdminClient)();
    const folder = docTypeToFolder(doc.doc_type);
    // Use shared utility to process the split document (handles images, profile photos, etc.)
    const processed = await (0, splitDocumentProcessor_1.processSplitDocument)(doc, candidateId, uploadId, folder);
    const fileBuffer = Buffer.from(doc.pdf_base64, 'base64');
    const sha256 = (0, documentService_1.calculateSHA256)(fileBuffer);
    // Fetch candidate name for better filename
    let candidateName;
    try {
        const { data: candidate } = await db
            .from('candidates')
            .select('name')
            .eq('id', candidateId)
            .single();
        candidateName = candidate?.name;
    }
    catch (e) {
        console.log('[uploadOneSplitDoc] Could not fetch candidate name, using default');
    }
    // Generate descriptive filename
    const ts = Date.now();
    const descriptiveFilename = (0, documentNaming_1.generateDescriptiveFilename)({
        doc_type: doc.doc_type,
        pages: doc.pages,
        split_strategy: doc.split_strategy,
        page_number: doc.pages && doc.pages.length === 1 ? doc.pages[0] : undefined,
    }, candidateName, ts);
    const metadata = {
        split_strategy: doc.split_strategy,
        engine_used: engineUsed,
        needs_review: !!doc.needs_review,
    };
    // For profile photos that were extracted as images, set verification_status to 'verified'
    // to skip the approval workflow since we've already saved them as the candidate's profile photo
    const verificationStatus = processed.shouldAutoVerify ? 'verified' : undefined;
    const { error: insErr } = await db.from('documents').insert({
        candidate_id: candidateId,
        doc_type: doc.doc_type,
        storage_bucket: STORAGE_BUCKET,
        storage_path: processed.storagePath,
        file_name: descriptiveFilename,
        mime_type: processed.mimeType,
        sha256,
        is_primary: false,
        pages: doc.pages ?? [],
        confidence: doc.confidence ?? null,
        needs_review: false, // Photos are auto-verified, no review needed
        verification_status: verificationStatus, // Set to 'verified' for extracted photos
        metadata,
    });
    if (insErr) {
        await db.storage.from(STORAGE_BUCKET).remove([processed.storagePath]);
        throw new Error(`Failed to create document record: ${insErr.message}`);
    }
    // Update candidate flags based on document type
    // Note: Database trigger should handle this, but we also update here for immediate consistency
    try {
        const updateFlags = {};
        const docType = (doc.doc_type || '').toLowerCase();
        const now = new Date().toISOString();
        if (docType === 'passport') {
            updateFlags.passport_received = true;
            updateFlags.passport_received_at = now;
        }
        else if (docType === 'cnic' || docType === 'national_id') {
            updateFlags.cnic_received = true;
            updateFlags.cnic_received_at = now;
        }
        else if (docType === 'driving_license' || docType === 'drivers_license' || docType === 'driver_license') {
            updateFlags.driving_license_received = true;
            updateFlags.driving_license_received_at = now;
        }
        else if (docType === 'police_character_certificate' || docType === 'police_clearance' || docType === 'pcc') {
            updateFlags.police_character_received = true;
            updateFlags.police_character_received_at = now;
        }
        else if (docType === 'cv' || docType === 'cv_resume') {
            updateFlags.cv_received = true;
            updateFlags.cv_received_at = now;
        }
        else if (docType === 'photo' || docType === 'photos') {
            updateFlags.photo_received = true;
            updateFlags.photo_received_at = now;
        }
        else if (docType.includes('medical')) {
            updateFlags.medical_received = true;
            updateFlags.medical_received_at = now;
        }
        else if (docType === 'degree' || docType.includes('diploma') || docType.includes('transcript')) {
            updateFlags.degree_received = true;
            updateFlags.degree_received_at = now;
        }
        else if (docType === 'visa') {
            updateFlags.visa_received = true;
            updateFlags.visa_received_at = now;
        }
        else if (docType === 'certificate' || docType === 'certificates') {
            updateFlags.certificate_received = true;
            updateFlags.certificate_received_at = now;
        }
        if (Object.keys(updateFlags).length > 0) {
            const { error: flagError } = await db
                .from('candidates')
                .update(updateFlags)
                .eq('id', candidateId);
            if (flagError) {
                console.error(`[SplitUpload] Failed to update flags for ${doc.doc_type}:`, flagError);
                // Don't throw - flag update is not critical, trigger should handle it
            }
        }
    }
    catch (flagErr) {
        console.error('[SplitUpload] Error updating candidate flags:', flagErr);
        // Don't throw - flag update is not critical
    }
    try {
        await (0, timelineService_1.logDocumentUploaded)(candidateId, userId, {
            doc_type: doc.doc_type,
            file_name: descriptiveFilename,
            mime_type: 'application/pdf',
            split_strategy: doc.split_strategy,
            needs_review: doc.needs_review,
        });
    }
    catch (e) {
        console.error('Failed to log timeline for split doc:', e);
    }
}
/**
 * Full flow: preserve original -> call parser -> create candidate if none -> create one doc per documents[].
 */
async function splitUpload(input) {
    const { buffer, fileName, mimeType, candidateId, candidateData, useTextract, userId } = input;
    const uploadId = (0, crypto_2.randomUUID)();
    // 1. Preserve original PDF
    const originalPath = await preserveOriginalPdf(buffer, uploadId, mimeType);
    // 2. Call split-and-categorize
    const base64 = buffer.toString('base64');
    const res = await callSplitAndCategorize(base64, fileName, mimeType, candidateData, useTextract);
    // 3. Resolve candidate_id (create if none)
    const firstIdentity = res.documents[0]?.identity;
    const resolvedCandidateId = await ensureCandidateId(candidateId, firstIdentity, userId);
    // 4. Create one document record per documents[]
    for (const doc of res.documents) {
        await uploadOneSplitDoc(resolvedCandidateId, doc, uploadId, userId, res.engine_used);
    }
    return {
        uploadId,
        originalPath,
        candidateId: resolvedCandidateId,
        engineUsed: res.engine_used,
        documentCount: res.documents.length,
    };
}
