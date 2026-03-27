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
exports.startWhatsAppAttachmentVerificationWorker = startWhatsAppAttachmentVerificationWorker;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const candidateMatcher_1 = require("../services/candidateMatcher");
const candidateService_1 = require("../services/candidateService");
const documentClassifier_1 = require("../services/documentClassifier");
const queue_1 = require("../config/queue");
const logger = (0, errorHandling_1.createLogger)('WhatsAppAttachmentVerificationWorker');
const PY_URL = (process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-python-parser-production.up.railway.app');
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET || 'dev-hmac-secret';
function signHmac(body) {
    return crypto_1.default.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}
async function callAICategorizationService(fileContentBase64, fileName, mimeType) {
    const requestBody = JSON.stringify({
        file_content: fileContentBase64,
        file_name: fileName,
        mime_type: mimeType,
        operation: 'categorize_document',
    });
    const signature = signHmac(requestBody);
    const res = await fetch(`${PY_URL.replace(/\/$/, '')}/categorize-document`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-HMAC-Signature': signature,
        },
        body: requestBody,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { success: false, error: `AI service HTTP ${res.status}: ${text}` };
    }
    const result = (await res.json());
    // Map Python response variants to our expected shape.
    // Python commonly returns: { success, category, confidence, extracted_identity: {...} }
    // or: { success, category, confidence, identity_fields: {...} }
    const extracted = (result?.extracted_identity || result?.identity_fields || {});
    const emailRaw = normalizeString(extracted.email);
    const emailFiltered = emailRaw && !candidateMatcher_1.CandidateMatcher.isGovernmentEmail(emailRaw) ? emailRaw : undefined;
    const mapped = {
        success: !!result?.success,
        category: normalizeString(result?.category),
        confidence: typeof result?.confidence === 'number' ? result.confidence : undefined,
        ocr_confidence: typeof result?.ocr_confidence === 'number' ? result.ocr_confidence : undefined,
        raw_text: typeof result?.raw_text === 'string' ? result.raw_text : undefined,
        error: normalizeString(result?.error),
        extracted_identity: {
            name: normalizeString(extracted.name) || undefined,
            father_name: normalizeString(extracted.father_name) || undefined,
            cnic: normalizeString(extracted.cnic) || undefined,
            passport_no: normalizeString(extracted.passport_no) || normalizeString(extracted.passport) || undefined,
            email: emailFiltered,
            phone: normalizeString(extracted.phone) || undefined,
            date_of_birth: normalizeString(extracted.date_of_birth) ||
                normalizeString(extracted.dob) ||
                undefined,
        },
    };
    if (emailRaw && !emailFiltered) {
        mapped.extracted_identity = mapped.extracted_identity || {};
        mapped.extracted_identity.email = undefined;
    }
    return mapped;
}
function normalizeString(value) {
    const s = String(value ?? '').trim();
    return s ? s : undefined;
}
function hasStrongIdentity(identity) {
    return !!(identity?.cnic || identity?.passport_no || identity?.email);
}
function mapAiCategoryToDocumentType(aiCategory, fallback) {
    const fb = String(fallback || '').toLowerCase();
    if (fb && fb !== 'unknown')
        return fb;
    const c = String(aiCategory || '').toLowerCase();
    if (c === 'passport')
        return 'passport';
    if (c === 'cnic')
        return 'cnic';
    if (c === 'medical_reports' || c === 'medical')
        return 'medical';
    if (c === 'certificates' || c === 'certificate' || c === 'degree')
        return 'certificate';
    if (c === 'visa')
        return 'visa';
    return 'other';
}
async function insertCandidateDocumentWithFallback(db, row) {
    const { data, error } = await db.from('candidate_documents').insert(row).select('id,candidate_id,storage_bucket,storage_path,file_name,mime_type').single();
    if (!error)
        return data;
    const msg = String(error?.message || error);
    if (/identity_conflict/i.test(msg) && /does not exist/i.test(msg)) {
        const { identity_conflict, ...rest } = row;
        const retry = await db.from('candidate_documents').insert(rest).select('id,candidate_id,storage_bucket,storage_path,file_name,mime_type').single();
        if (retry.error)
            throw retry.error;
        return retry.data;
    }
    throw error;
}
function startWhatsAppAttachmentVerificationWorker() {
    const worker = new bullmq_1.Worker('whatsapp-attachment-verification', async (job) => {
        if (!process.env.PYTHON_CV_PARSER_URL || !process.env.PYTHON_HMAC_SECRET) {
            throw new Error('PYTHON_CV_PARSER_URL / PYTHON_HMAC_SECRET must be configured');
        }
        const { attachmentId, fromPhone, wamid } = job.data;
        const db = (0, database_1.supabaseAdminClient)();
        logger.info('Pre-verifying WhatsApp attachment (identity-first)', { jobId: job.id, attachmentId, wamid });
        const { data: attachment, error: attachError } = await db
            .from('inbox_attachments')
            .select('*')
            .eq('id', attachmentId)
            .single();
        if (attachError || !attachment) {
            throw new Error(`Attachment not found: ${attachmentId}`);
        }
        // Idempotency: if already linked, do nothing.
        const { data: existing } = await db
            .from('candidate_documents')
            .select('id,candidate_id')
            .eq('inbox_attachment_id', attachmentId)
            .limit(1);
        if (Array.isArray(existing) && existing.length > 0) {
            logger.info('Attachment already linked to candidate_documents (idempotent skip)', {
                attachmentId,
                documentId: existing[0]?.id,
                candidateId: existing[0]?.candidate_id,
            });
            return { status: 'skipped', documentId: existing[0]?.id };
        }
        // Download raw file
        const download = await db.storage.from(attachment.storage_bucket).download(attachment.storage_path);
        const downloadError = download?.error;
        const fileData = download?.data;
        if (downloadError || !fileData) {
            throw new Error(`Failed to download attachment from storage: ${downloadError?.message || 'unknown error'}`);
        }
        const arrayBuffer = await fileData.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (buffer.length === 0)
            throw new Error('Downloaded attachment is empty');
        const base64Content = buffer.toString('base64');
        const fileName = String(attachment.file_name || `${attachmentId}.bin`);
        const mimeType = String(attachment.mime_type || 'application/octet-stream');
        const aiResult = await callAICategorizationService(base64Content, fileName, mimeType);
        if (!aiResult.success || aiResult.error) {
            logger.warn('AI categorization failed (manual review required)', {
                attachmentId,
                error: aiResult.error,
            });
            await db.from('unmatched_documents').insert({
                inbox_attachment_id: attachmentId,
                document_type: attachment.document_type || 'unknown',
                storage_bucket: attachment.storage_bucket,
                storage_path: attachment.storage_path,
                file_name: attachment.file_name,
                source: 'whatsapp',
                needs_manual_review: true,
                review_reasons: [aiResult.error || 'AI categorization failed'],
                status: 'pending_link',
            });
            return { status: 'needs_manual_review', reason: 'ai_failed' };
        }
        const identity = aiResult.extracted_identity || {};
        const extractedCnic = normalizeString(identity.cnic);
        const extractedPassport = normalizeString(identity.passport_no);
        const extractedEmail = normalizeString(identity.email)?.toLowerCase();
        const extractedName = normalizeString(identity.name);
        const extractedFather = normalizeString(identity.father_name);
        const extractedDob = normalizeString(identity.date_of_birth);
        // Matching priority: CNIC -> Passport -> Email -> (WhatsApp Phone fallback) -> Name + DOB -> Name + Father -> Name
        const strong = hasStrongIdentity(identity);
        const strongMatch = await candidateMatcher_1.CandidateMatcher.findCandidate({
            cnic: extractedCnic,
            passport: extractedPassport,
            email: extractedEmail,
            phone: undefined,
            name: extractedName,
            fatherName: extractedFather,
            dateOfBirth: extractedDob,
        });
        const phoneMatch = await candidateMatcher_1.CandidateMatcher.findCandidate({
            phone: fromPhone,
        });
        // Conflict handling: CNIC/passport wins, but we flag conflict for review.
        const isConflict = !!strongMatch.candidateId &&
            !!phoneMatch.candidateId &&
            strongMatch.candidateId !== phoneMatch.candidateId;
        if (strongMatch.needsManualReview || strongMatch.multipleMatches) {
            await db.from('unmatched_documents').insert({
                inbox_attachment_id: attachmentId,
                document_type: attachment.document_type || 'unknown',
                storage_bucket: attachment.storage_bucket,
                storage_path: attachment.storage_path,
                file_name: attachment.file_name,
                source: 'whatsapp',
                extracted_email: extractedEmail,
                extracted_phone: fromPhone,
                extracted_name: extractedName,
                extracted_father_name: extractedFather,
                extracted_cnic: extractedCnic,
                needs_manual_review: true,
                review_reasons: strongMatch.reviewReasons || ['Multiple/ambiguous identity matches'],
                status: 'pending_link',
            });
            return { status: 'needs_manual_review', reason: 'ambiguous_match' };
        }
        let candidateId = strongMatch.candidateId;
        // Fallback: if no strong identity, only then consider WhatsApp phone (channel fallback).
        if (!candidateId && !strong) {
            if (phoneMatch.needsManualReview || phoneMatch.multipleMatches) {
                await db.from('unmatched_documents').insert({
                    inbox_attachment_id: attachmentId,
                    document_type: attachment.document_type || 'unknown',
                    storage_bucket: attachment.storage_bucket,
                    storage_path: attachment.storage_path,
                    file_name: attachment.file_name,
                    source: 'whatsapp',
                    extracted_phone: fromPhone,
                    extracted_name: extractedName,
                    needs_manual_review: true,
                    review_reasons: phoneMatch.reviewReasons || ['Multiple phone matches'],
                    status: 'pending_link',
                });
                return { status: 'needs_manual_review', reason: 'phone_ambiguous' };
            }
            candidateId = phoneMatch.candidateId;
        }
        // Candidate creation rule: only create when we have at least one strong identity field.
        if (!candidateId && strong) {
            try {
                const created = await (0, candidateService_1.createCandidate)({
                    name: extractedName || `WhatsApp Document ${wamid}`,
                    father_name: extractedFather,
                    cnic: extractedCnic,
                    passport: extractedPassport,
                    email: extractedEmail,
                    date_of_birth: extractedDob,
                    source: 'WhatsApp',
                    status: 'Applied',
                    auto_extracted: true,
                    needs_review: true,
                });
                candidateId = created?.id ? String(created.id) : null;
            }
            catch (err) {
                // If createCandidate detects a duplicate, fall back to matching (or manual review) instead of failing the job.
                const msg = err instanceof Error ? err.message : String(err);
                logger.warn('Candidate creation failed; falling back to match/manual review', { attachmentId, error: msg });
                const retryMatch = await candidateMatcher_1.CandidateMatcher.findCandidate({
                    cnic: extractedCnic,
                    passport: extractedPassport,
                    email: extractedEmail,
                    name: extractedName,
                    fatherName: extractedFather,
                    dateOfBirth: extractedDob,
                });
                if (retryMatch.candidateId && !retryMatch.needsManualReview) {
                    candidateId = retryMatch.candidateId;
                }
                else {
                    await db.from('unmatched_documents').insert({
                        inbox_attachment_id: attachmentId,
                        document_type: attachment.document_type || 'unknown',
                        storage_bucket: attachment.storage_bucket,
                        storage_path: attachment.storage_path,
                        file_name: attachment.file_name,
                        source: 'whatsapp',
                        extracted_email: extractedEmail,
                        extracted_phone: fromPhone,
                        extracted_name: extractedName,
                        extracted_father_name: extractedFather,
                        extracted_cnic: extractedCnic,
                        needs_manual_review: true,
                        review_reasons: [msg || 'Candidate creation failed'],
                        status: 'pending_link',
                    });
                    return { status: 'needs_manual_review', reason: 'create_candidate_failed' };
                }
            }
        }
        if (!candidateId) {
            // No candidate match and no strong identity => store as unassigned/manual review.
            await db.from('unmatched_documents').insert({
                inbox_attachment_id: attachmentId,
                document_type: attachment.document_type || 'unknown',
                storage_bucket: attachment.storage_bucket,
                storage_path: attachment.storage_path,
                file_name: attachment.file_name,
                source: 'whatsapp',
                extracted_email: extractedEmail,
                extracted_phone: fromPhone,
                extracted_name: extractedName,
                extracted_father_name: extractedFather,
                extracted_cnic: extractedCnic,
                needs_manual_review: true,
                review_reasons: ['No strong identity extracted (CNIC/Passport/Email required to auto-create)'],
                status: 'pending_link',
            });
            return { status: 'needs_manual_review', reason: 'no_strong_identity' };
        }
        // Copy raw upload into candidate folder (audit keeps raw path too).
        const documentType = mapAiCategoryToDocumentType(aiResult.category, attachment.document_type);
        const candidateStoragePath = documentClassifier_1.DocumentClassifier.generateStoragePath(candidateId, documentType, fileName);
        const { error: copyError } = await db.storage
            .from(attachment.storage_bucket)
            .copy(attachment.storage_path, candidateStoragePath);
        if (copyError) {
            throw new Error(`Failed to copy attachment into candidate folder: ${copyError.message}`);
        }
        // Create candidate_documents
        const createdDoc = await insertCandidateDocumentWithFallback(db, {
            candidate_id: candidateId,
            inbox_attachment_id: attachmentId,
            document_type: documentType,
            storage_bucket: attachment.storage_bucket,
            storage_path: candidateStoragePath,
            file_name: fileName,
            mime_type: mimeType,
            source: 'whatsapp',
            received_at: attachment.received_at || new Date().toISOString(),
            identity_conflict: isConflict,
        });
        // Attach candidate_id to conversation only after identity-based binding.
        try {
            await db
                .from('whatsapp_conversations')
                .update({ candidate_id: candidateId })
                .eq('phone_number', fromPhone)
                .is('candidate_id', null);
        }
        catch {
            // fail-open
        }
        // If we detected an identity conflict, keep it visible for manual review.
        // CNIC/passport wins for binding, but conflict should still be reviewed.
        if (isConflict) {
            logger.warn('Identity conflict detected (bound by strong identity)', {
                attachmentId,
                candidateId,
                phoneCandidateId: phoneMatch.candidateId,
                matchedBy: strongMatch.matchedBy,
            });
        }
        // Enqueue full document verification (may re-call AI); skip on conflict to avoid auto-actions.
        if (!isConflict && createdDoc?.id) {
            const requestId = crypto_1.default.randomUUID();
            await queue_1.documentVerificationQueue.add('verify', {
                requestId,
                documentId: createdDoc.id,
                candidateId: createdDoc.candidate_id,
                storageBucket: createdDoc.storage_bucket,
                storagePath: createdDoc.storage_path,
                fileName: createdDoc.file_name,
                mimeType: createdDoc.mime_type,
            }, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: 200,
                removeOnFail: 200,
            });
        }
        // Mark inbox_attachments as linked (do not overwrite storage_path; it points to raw upload).
        // Write both linked_candidate_id (identity-first signal) AND candidate_id (required by CV Inbox
        // UI to show status as "extracted" rather than "queued").
        await db.from('inbox_attachments').update({ linked_candidate_id: candidateId, candidate_id: candidateId }).eq('id', attachmentId);
        // If the AI identified this as a CV/resume, also trigger full structured CV parsing so that
        // position, experience, skills, education etc. get extracted into the candidate profile.
        // The WhatsApp media worker only enqueues cv-parsing for attachments already classified as 'cv'
        // by filename (e.g. "cv.pdf", "resume.docx"). PDFs with person-name filenames ("JOHN DOE.pdf")
        // arrive here as 'unknown', pass through verification, but never receive full text parsing.
        if (aiResult.category === 'cv_resume' && !isConflict && createdDoc?.id) {
            try {
                await db.from('inbox_attachments').update({ attachment_kind: 'cv' }).eq('id', attachmentId);
                const { enqueueCvParsingJobForAttachment } = await Promise.resolve().then(() => __importStar(require('../services/inboxAttachmentService')));
                // force: true bypasses the 'already_linked' idempotency guard because candidate_id was
                // just written above and would otherwise cause the CV parser to skip this attachment.
                await enqueueCvParsingJobForAttachment(attachmentId, { force: true });
                logger.info('Enqueued full CV parsing for cv_resume WhatsApp attachment', { attachmentId, candidateId });
            }
            catch (cvParseErr) {
                logger.error('Failed to enqueue CV parsing for cv_resume WhatsApp attachment (non-fatal)', cvParseErr, { attachmentId });
            }
        }
        return {
            status: 'linked',
            candidateId,
            documentId: createdDoc?.id,
            identityConflict: isConflict,
            matchedBy: strongMatch.matchedBy,
        };
    }, {
        connection: redis_1.redis,
        concurrency: 1,
        drainDelay: 60, // seconds — idle poll every 60s instead of 5s
        stalledInterval: 300000, // check stalled jobs every 5 min instead of 30s
        lockDuration: 60000,
        limiter: { max: 30, duration: 60000 },
    });
    worker.on('completed', (job) => {
        logger.info('WhatsApp attachment verification job completed', { jobId: job.id });
    });
    worker.on('failed', (job, err) => {
        logger.error('WhatsApp attachment verification job failed', err, {
            jobId: job?.id,
            attachmentId: job?.data?.attachmentId,
            wamid: job?.data?.wamid,
            inboxMessageId: job?.data?.inboxMessageId,
        });
    });
    return worker;
}
