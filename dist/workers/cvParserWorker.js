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
exports.startCvParserWorker = startCvParserWorker;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const crypto_1 = __importDefault(require("crypto"));
const parsingJobsService_1 = require("../services/parsingJobsService");
const candidateService_1 = require("../services/candidateService");
const database_1 = require("../config/database");
const splitUploadService_1 = require("../services/splitUploadService");
const hybridPhotoExtractionService_1 = require("../services/hybridPhotoExtractionService");
const documentCategories_1 = require("../config/documentCategories");
const queue_1 = require("../config/queue");
const documentVerificationLogService_1 = require("../services/documentVerificationLogService");
const crypto_2 = require("crypto");
const splitDocumentProcessor_1 = require("../utils/splitDocumentProcessor");
const documentNaming_1 = require("../utils/documentNaming");
const progressiveDataCompletionService_1 = require("../services/progressiveDataCompletionService");
const aiProfilePhotoExtractionService_1 = require("../services/aiProfilePhotoExtractionService");
const whatsappService_1 = require("../services/whatsappService");
const whatsappInboxService_1 = require("../services/whatsappInboxService");
const professionInferenceService_1 = require("../services/professionInferenceService");
const emailService_1 = require("../services/emailService");
const singleCvHeuristics_1 = require("../utils/singleCvHeuristics");
const PY_URL = (process.env.PYTHON_CV_PARSER_URL || 'https://recruitment-python-parser-production.up.railway.app');
const HMAC_SECRET = process.env.PYTHON_HMAC_SECRET;
const STORAGE_BUCKET = 'documents';
function isVarcharOverflowError(err) {
    const message = String(err?.message || err || '');
    const code = String(err?.code || err?.status || err?.statusCode || '');
    const details = String(err?.details || err?.hint || '');
    // Postgres: string_data_right_truncation
    if (code === '22001')
        return true;
    return (/value too long for type character varying\(\d+\)/i.test(message) ||
        /value too long for type character varying\(\d+\)/i.test(details) ||
        /string_data_right_truncation/i.test(message) ||
        /string_data_right_truncation/i.test(details));
}
function safeErrorMessage(err, maxLen = 500) {
    const msg = String(err?.message || err || 'Unknown error');
    return msg.length > maxLen ? `${msg.slice(0, maxLen)}…` : msg;
}
function signHmac(body) {
    return crypto_1.default.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
}
function isMissingParseCvRoute(status, bodyText) {
    return status === 404 && /Cannot POST \/parse-cv/i.test(bodyText);
}
function isPlaceholderName(name) {
    if (!name)
        return false;
    return /^(john|jane)\s+doe$/i.test(name.trim());
}
function isPlaceholderEmail(email) {
    if (!email)
        return false;
    return /@example\.com$/i.test(email.trim()) || /^test@/i.test(email.trim());
}
function isPlaceholderPhone(phone) {
    if (!phone)
        return false;
    const digits = phone.replace(/\D/g, '');
    return digits === '1234567890';
}
function hasProfilePhoto(candidate) {
    return !!(candidate?.profile_photo_path ||
        candidate?.profile_photo_url ||
        (candidate?.profile_photo_bucket && candidate?.profile_photo_path));
}
function hasMeaningfulText(value) {
    if (typeof value !== 'string')
        return false;
    const normalized = value.trim();
    if (!normalized)
        return false;
    const lower = normalized.toLowerCase();
    return !['unknown', 'n/a', 'na', 'none', 'null', 'undefined', 'not provided', 'missing'].includes(lower);
}
async function ensureOriginalCvCandidateDocument(args) {
    const { db, candidate, attachmentId, fileName, mimeType, fileBytes, reason } = args;
    const { data: existingCvDoc, error: existingCvErr } = await db
        .from('candidate_documents')
        .select('id')
        .eq('inbox_attachment_id', attachmentId)
        .limit(1);
    if (!existingCvErr && existingCvDoc && existingCvDoc.length > 0) {
        return;
    }
    const timestamp = Date.now();
    const sanitizedFileName = String(fileName).replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const destPath = `${candidate.id}/cv_resume/${timestamp}_${sanitizedFileName}`;
    const upload = await db.storage.from(STORAGE_BUCKET).upload(destPath, fileBytes, {
        upsert: true,
        contentType: mimeType,
    });
    const uploadErr = upload?.error;
    if (uploadErr) {
        throw new Error(`Failed to copy CV to candidate storage: ${uploadErr.message || 'unknown error'}`);
    }
    const cvDocData = {
        candidate_id: candidate.id,
        inbox_attachment_id: attachmentId,
        document_type: 'other',
        category: documentCategories_1.DOCUMENT_CATEGORIES.CV_RESUME,
        detected_category: documentCategories_1.DOCUMENT_CATEGORIES.CV_RESUME,
        confidence: null,
        storage_bucket: STORAGE_BUCKET,
        storage_path: destPath,
        file_name: (0, documentNaming_1.generateDescriptiveFilename)({ doc_type: 'cv_resume' }, candidate.name || undefined, timestamp),
        mime_type: mimeType,
        source: 'web',
        status: 'received',
        verification_status: documentCategories_1.VERIFICATION_STATUS.PENDING_AI,
        received_at: new Date().toISOString(),
    };
    const { data: createdCvDoc, error: cvInsErr } = await db
        .from('candidate_documents')
        .insert(cvDocData)
        .select()
        .single();
    if (cvInsErr || !createdCvDoc) {
        throw cvInsErr || new Error('Failed to create candidate_documents CV entry');
    }
    const requestId = (0, documentVerificationLogService_1.generateRequestId)();
    try {
        await queue_1.documentVerificationQueue.add('verify-document', {
            requestId,
            documentId: createdCvDoc.id,
            candidateId: candidate.id,
            storageBucket: STORAGE_BUCKET,
            storagePath: destPath,
            fileName: createdCvDoc.file_name,
            mimeType,
        }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
    }
    catch (qErr) {
        console.warn(`[CVParser] Failed to enqueue verification for original CV doc (${reason}) (non-fatal):`, qErr?.message || qErr);
    }
}
function hasRealCandidateSignals(parsedCandidate, identityFields) {
    const primaryIdentitySignals = [
        identityFields?.cnic,
        identityFields?.passport_no,
        identityFields?.email,
        identityFields?.phone,
        parsedCandidate?.cnic,
        parsedCandidate?.passport,
        parsedCandidate?.passport_no,
        parsedCandidate?.email,
        parsedCandidate?.phone,
    ].some(hasMeaningfulText);
    const nameSignal = [
        parsedCandidate?.full_name,
        parsedCandidate?.name,
        identityFields?.name,
    ].some(hasMeaningfulText);
    const profileSignals = [
        parsedCandidate?.position,
        parsedCandidate?.professional_summary,
        parsedCandidate?.summary,
        parsedCandidate?.country_of_interest,
    ].some(hasMeaningfulText);
    const structuredSignals = (Array.isArray(parsedCandidate?.skills) && parsedCandidate.skills.length > 0) ||
        (Array.isArray(parsedCandidate?.education) && parsedCandidate.education.length > 0) ||
        (Array.isArray(parsedCandidate?.experience) && parsedCandidate.experience.length > 0) ||
        (Array.isArray(parsedCandidate?.languages) && parsedCandidate.languages.length > 0) ||
        (Array.isArray(parsedCandidate?.certifications) && parsedCandidate.certifications.length > 0) ||
        (typeof parsedCandidate?.experience_years === 'number' && parsedCandidate.experience_years > 0);
    return primaryIdentitySignals || (nameSignal && (profileSignals || structuredSignals));
}
function normalizeWhatsAppTo(phoneRaw) {
    if (!phoneRaw)
        return null;
    let digits = String(phoneRaw).replace(/\D/g, '');
    if (!digits)
        return null;
    // Handle 00-prefixed international format (e.g. 0092...)
    if (digits.startsWith('00'))
        digits = digits.slice(2);
    // Pakistan-focused normalization (most common in this system)
    // 03XXXXXXXXX -> 92XXXXXXXXXX
    if (digits.startsWith('0') && digits.length === 11) {
        digits = `92${digits.slice(1)}`;
    }
    // 3XXXXXXXXX -> 92XXXXXXXXXX
    if (digits.length === 10 && digits.startsWith('3')) {
        digits = `92${digits}`;
    }
    // WhatsApp expects E.164 digits without +
    if (digits.startsWith('0'))
        return null;
    if (digits.length < 10 || digits.length > 15)
        return null;
    return digits;
}
function buildCvReceivedWhatsAppText(params) {
    const name = (params.candidateName || '').trim();
    const email = (params.candidateEmail || '').trim();
    const emailSent = !!params.missingDataEmailSent;
    const greeting = name ? `Assalam o Alaikum ${name}` : 'Assalam o Alaikum';
    const emailLine = email
        ? emailSent
            ? `We have sent an email to ${email} requesting the missing documents. Please check your inbox/spam and reply to that email with the required documents.`
            : `We will contact you via email at ${email} if any documents are missing.`
        : `If any documents are missing, our team will contact you.`;
    const linkedinLine = 'For further updates, please follow us on LinkedIn:\nhttps://www.linkedin.com/company/111465919/admin/analytics/followers/?invite=true';
    return `${greeting},\n\nFalisha Manpower: We have received your CV.\n${emailLine}\n\n${linkedinLine}\n\nThank you.`;
}
// Helper to parse and validate dates from various formats
function parseDate(dateStr, fieldName) {
    if (!dateStr)
        return undefined;
    try {
        // Try to parse formats like "13 October 1983", "13-10-1983", "23-09-2033", "1983-10-13"
        if (dateStr.includes(' ')) {
            // Format: "13 October 1983"
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
            }
        }
        else if (dateStr.includes('-')) {
            // Format: "13-10-1983", "23-09-2033", or "1983-10-13"
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                if (parts[0].length === 4) {
                    // YYYY-MM-DD (already correct format)
                    return dateStr;
                }
                else {
                    // DD-MM-YYYY → convert to YYYY-MM-DD
                    const day = parts[0];
                    const month = parts[1];
                    const year = parts[2];
                    return `${year}-${month}-${day}`;
                }
            }
        }
        else if (dateStr.includes('/')) {
            // Format: "13/10/1983" or "10/13/1983"
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                // Assume DD/MM/YYYY
                const day = parts[0];
                const month = parts[1];
                const year = parts[2];
                return `${year}-${month}-${day}`;
            }
        }
        // Try generic Date constructor as fallback
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
        }
        console.warn(`[CVParser] Could not parse ${fieldName}: ${dateStr}`);
        return undefined;
    }
    catch (e) {
        console.warn(`[CVParser] Failed to parse ${fieldName}: ${dateStr}`, e);
        return undefined;
    }
}
/** Truncate a string to maxLen characters without throwing. */
function trunc(value, maxLen) {
    if (!value)
        return undefined;
    return value.length > maxLen ? value.slice(0, maxLen) : value;
}
// Helper to create candidate from parsed CV data
async function createCandidateFromParsedData(parsed, attachmentId, identityFields, messageSource) {
    try {
        const candidate = parsed.candidate || {};
        // Parse date of birth from various formats
        const dateOfBirth = parseDate(identityFields?.date_of_birth || identityFields?.dob || candidate.date_of_birth, 'date_of_birth');
        // Parse passport expiry date (can be in the future - this is normal!)
        const passportExpiry = parseDate(candidate.passport_expiry || identityFields?.passport_expiry || identityFields?.expiry_date, 'passport_expiry');
        // Build candidate data from parsed CV - map all fields from Python parser
        // Include identity fields extracted from CV (father_name, cnic, passport, date_of_birth, etc.)
        // Filter out government/police emails - don't use them as candidate email
        const extractedEmail = candidate.email || identityFields?.email;
        const candidateEmail = extractedEmail && !(0, progressiveDataCompletionService_1.isGovernmentEmail)(extractedEmail) ? extractedEmail : undefined;
        const resolvedEmail = identityFields?.email && isPlaceholderEmail(candidateEmail)
            ? identityFields.email
            : candidateEmail;
        const resolvedPhone = identityFields?.phone && isPlaceholderPhone(candidate.phone)
            ? identityFields.phone
            : (candidate.phone || identityFields?.phone || undefined);
        const resolvedName = identityFields?.name && isPlaceholderName(candidate.full_name)
            ? identityFields.name
            : (candidate.full_name || identityFields?.name || 'Unknown');
        if (extractedEmail && !candidateEmail) {
            console.log(`[CVParser] Filtered out official/government email during extraction: ${extractedEmail}`);
        }
        const extractedPosition = (0, professionInferenceService_1.inferProfessionFromCvData)(candidate);
        if (extractedPosition && !candidate.position) {
            console.log(`[CVParser] Inferred position from CV content: ${extractedPosition}`);
        }
        const rawProfilePhotoUrl = parsed?.candidate?.profile_photo_url || parsed?.profile_photo_url || undefined;
        const normalizedProfilePhotoUrl = typeof rawProfilePhotoUrl === 'string' && rawProfilePhotoUrl.trim()
            ? rawProfilePhotoUrl.trim()
            : undefined;
        const isProfilePhotoPdf = !!normalizedProfilePhotoUrl && normalizedProfilePhotoUrl.toLowerCase().includes('.pdf');
        if (isProfilePhotoPdf) {
            console.warn('[CVParser] Ignoring PDF profile_photo_url from parser response:', normalizedProfilePhotoUrl);
        }
        const candidateData = {
            name: trunc(resolvedName, 255) || 'Unknown',
            father_name: identityFields?.father_name || candidate.father_name || undefined,
            email: trunc(resolvedEmail, 255),
            phone: trunc(resolvedPhone, 50),
            address: candidate.location || undefined,
            date_of_birth: dateOfBirth,
            marital_status: trunc(candidate.marital_status, 20) || undefined,
            cnic: identityFields?.cnic || candidate.cnic || undefined,
            passport: identityFields?.passport_no || candidate.passport || undefined,
            nationality: trunc(candidate.nationality || identityFields?.nationality, 100) || undefined,
            position: trunc(extractedPosition, 255),
            experience_years: candidate.experience_years || undefined,
            country_of_interest: trunc(candidate.country_of_interest, 100) || undefined,
            skills: Array.isArray(candidate.skills) ? candidate.skills.join(', ') : undefined,
            languages: Array.isArray(candidate.languages) ? candidate.languages.join(', ') : undefined,
            education: trunc(Array.isArray(candidate.education) && candidate.education.length > 0
                ? candidate.education.map((e) => `${e.degree} from ${e.institution}`).join('; ')
                : undefined, 255),
            certifications: Array.isArray(candidate.certifications) ? candidate.certifications.join(', ') : undefined,
            internships: Array.isArray(candidate.internships) ? candidate.internships.join(', ') : undefined,
            previous_employment: candidate.previous_employment || (Array.isArray(candidate.experience) && candidate.experience.length > 0
                ? candidate.experience.map((e) => `${e.title} at ${e.company}`).join('; ')
                : undefined),
            passport_expiry: passportExpiry,
            professional_summary: candidate.professional_summary || candidate.summary || undefined,
            // Pass through profile_photo_url from parser response if present (ignore PDF links)
            profile_photo_url: isProfilePhotoPdf ? undefined : normalizedProfilePhotoUrl,
            source: messageSource === 'whatsapp' ? 'WhatsApp' : messageSource === 'gmail' ? 'Email' : 'Manual',
            auto_extracted: true,
        };
        // Create candidate (system-created, no specific userId)
        const newCandidate = await (0, candidateService_1.createCandidate)(candidateData);
        // Link the attachment to the candidate
        const db = (0, database_1.supabaseAdminClient)();
        await db
            .from('inbox_attachments')
            .update({ candidate_id: newCandidate.id })
            .eq('id', attachmentId);
        console.log(`[CVParser] Created candidate ${newCandidate.id} for attachment ${attachmentId}`);
        return newCandidate;
    }
    catch (err) {
        console.error(`[CVParser] Failed to create candidate from parsed data:`, err);
        // Don't throw - parsing was successful, just candidate creation failed
    }
}
function startCvParserWorker() {
    const parsingJobs = new parsingJobsService_1.ParsingJobsService();
    async function reconcileAttachmentCandidateOwnership(candidateId, attachmentId) {
        try {
            const db = (0, database_1.supabaseAdminClient)();
            const { data: existingDocs, error: existingDocsError } = await db
                .from('candidate_documents')
                .select('id, candidate_id')
                .eq('inbox_attachment_id', attachmentId);
            if (existingDocsError) {
                console.warn('[CVParser] Failed to inspect existing candidate_documents ownership (non-fatal):', existingDocsError);
            }
            else {
                const needsReassignment = (existingDocs || []).some((doc) => doc?.candidate_id && doc.candidate_id !== candidateId);
                if (needsReassignment) {
                    const { error: docUpdateError } = await db
                        .from('candidate_documents')
                        .update({ candidate_id: candidateId })
                        .eq('inbox_attachment_id', attachmentId)
                        .neq('candidate_id', candidateId);
                    if (docUpdateError) {
                        console.warn('[CVParser] Failed to reassign candidate_documents for attachment (non-fatal):', docUpdateError);
                    }
                    else {
                        console.log(`[CVParser] Reassigned candidate_documents for attachment ${attachmentId} to candidate ${candidateId}`);
                    }
                }
            }
            const { error: attachmentUpdateError } = await db
                .from('inbox_attachments')
                .update({
                candidate_id: candidateId,
                linked_candidate_id: candidateId,
            })
                .eq('id', attachmentId);
            if (attachmentUpdateError) {
                console.warn('[CVParser] Failed to synchronize inbox attachment candidate ownership (non-fatal):', attachmentUpdateError);
            }
        }
        catch (err) {
            console.warn('[CVParser] Attachment ownership reconciliation failed (non-fatal):', err);
        }
    }
    async function maybeAttachGmailThreadToCandidate(candidateId, attachmentId) {
        try {
            const db2 = (0, database_1.supabaseAdminClient)();
            const { data: att } = await db2
                .from('inbox_attachments')
                .select('inbox_message_id')
                .eq('id', attachmentId)
                .maybeSingle();
            const inboxMessageId = att?.inbox_message_id;
            if (!inboxMessageId)
                return;
            const { data: msg } = await db2
                .from('inbox_messages')
                .select('source, payload')
                .eq('id', inboxMessageId)
                .maybeSingle();
            if (!msg || msg.source !== 'gmail')
                return;
            const payload = msg.payload || {};
            const threadId = typeof payload.threadId === 'string' ? payload.threadId.trim() : '';
            if (!threadId)
                return;
            const fromRaw = typeof payload.from === 'string' ? payload.from : '';
            const emailMatch = fromRaw.match(/<([^>]+)>/) || fromRaw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
            const fromEmail = (emailMatch?.[1] || emailMatch?.[0] || '').trim();
            const update = {
                gmail_thread_id: threadId,
                gmail_from_email: fromEmail || null,
                gmail_last_subject: typeof payload.subject === 'string' ? payload.subject : null,
                gmail_last_message_id: typeof payload.messageIdHeader === 'string' ? payload.messageIdHeader : null,
            };
            await db2.from('candidates').update(update).eq('id', candidateId);
        }
        catch (err) {
            console.warn('[CVParser] Failed to attach Gmail thread to candidate (non-fatal):', err?.message || err);
        }
    }
    function buildPreviousEmploymentFromExperience(experience) {
        if (!Array.isArray(experience) || experience.length === 0)
            return undefined;
        const cleanText = (value) => {
            if (typeof value !== 'string')
                return '';
            const trimmed = value.trim();
            if (!trimmed)
                return '';
            const lower = trimmed.toLowerCase();
            if (['missing', 'null', 'undefined', 'n/a', 'na', 'none', 'not provided'].includes(lower))
                return '';
            return trimmed;
        };
        const lines = experience
            .filter((e) => e && typeof e === 'object')
            .map((e) => {
            const title = cleanText(e.title);
            const company = cleanText(e.company);
            const location = cleanText(e.location);
            const start = cleanText(e.start_date);
            const end = cleanText(e.end_date);
            const role = [title, company ? `at ${company}` : ''].filter(Boolean).join(' ');
            const metaParts = [location, start && end ? `${start} - ${end}` : start || end].filter(Boolean);
            const meta = metaParts.length > 0 ? ` (${metaParts.join(', ')})` : '';
            const description = cleanText(e.description);
            const desc = description ? `\n- ${description}` : '';
            const line = `${role || company || title}`.trim();
            if (!line)
                return null;
            return `${line}${meta}${desc}`;
        })
            .filter(Boolean);
        if (lines.length === 0)
            return undefined;
        return lines.slice(0, 12).join('\n\n');
    }
    /**
     * Read the inbox_message payload for a given attachment.
     * Used to detect backfill CVs (suppress immediate missing-data emails)
     * and to identify which Gmail account received the email (for reply routing).
     */
    async function getInboxPayloadForAttachment(attachmentId) {
        try {
            const db2 = (0, database_1.supabaseAdminClient)();
            const { data: att } = await db2
                .from('inbox_attachments')
                .select('inbox_message_id')
                .eq('id', attachmentId)
                .maybeSingle();
            const inboxMessageId = att?.inbox_message_id;
            if (!inboxMessageId)
                return { backfill: false, inbox_account: 1 };
            const { data: msg } = await db2
                .from('inbox_messages')
                .select('payload')
                .eq('id', inboxMessageId)
                .maybeSingle();
            const payload = msg?.payload || {};
            const bridgeBackfill = payload?.bridgeMetadata?.rawFields?.backfill === 'true'
                || payload?.raw?.bridgeMetadata?.rawFields?.backfill === 'true';
            return {
                backfill: payload.backfill === true || bridgeBackfill,
                inbox_account: payload.inbox_account === 2 ? 2 : 1,
            };
        }
        catch {
            return { backfill: false, inbox_account: 1 };
        }
    }
    async function isWhatsAppOriginAttachment(attachmentId) {
        const db = (0, database_1.supabaseAdminClient)();
        const { data: att } = await db
            .from('inbox_attachments')
            .select('inbox_message_id, whatsapp_wamid, whatsapp_media_id')
            .eq('id', attachmentId)
            .maybeSingle();
        if (att?.whatsapp_wamid || att?.whatsapp_media_id)
            return true;
        const inboxMessageId = att?.inbox_message_id;
        if (!inboxMessageId)
            return false;
        const { data: msg } = await db
            .from('inbox_messages')
            .select('source')
            .eq('id', inboxMessageId)
            .maybeSingle();
        return msg?.source === 'whatsapp';
    }
    async function maybeSendCvReceivedWhatsAppNotification(params) {
        try {
            if (process.env.DISABLE_CV_WHATSAPP_NOTIFY === 'true') {
                console.log(`[CVParser] CV WhatsApp notification disabled via DISABLE_CV_WHATSAPP_NOTIFY (candidateId=${params.candidateId}). Skipping.`);
                return;
            }
            const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
            const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
            if (!accessToken || !phoneNumberId)
                return;
            // Always use the phone number extracted from the CV itself.
            // Never fall back to the sender's phone – the sender can be a partner,
            // referral, or employee forwarding the CV on behalf of the candidate.
            const to = normalizeWhatsAppTo(params.cvExtractedPhone);
            if (!to) {
                console.log(`[CVParser] No CV-extracted phone number available for WhatsApp notification (candidateId=${params.candidateId}). Skipping.`);
                return;
            }
            const conversation = await (0, whatsappInboxService_1.ensureConversationForPhone)(to);
            // Idempotency: do not send twice for the same attachment
            try {
                const db = (0, database_1.supabaseAdminClient)();
                const { data: existing } = await db
                    .from('whatsapp_messages')
                    .select('id')
                    .eq('conversation_id', conversation.id)
                    .eq('direction', 'outbound')
                    .eq('raw->>kind', 'cv_received_notification')
                    .eq('raw->>inbox_attachment_id', params.attachmentId)
                    .limit(1);
                if (Array.isArray(existing) && existing.length > 0)
                    return;
            }
            catch (dedupeErr) {
                console.warn('[CVParser] WhatsApp CV notification dedupe check failed (non-fatal):', dedupeErr);
            }
            // Best-effort: attach candidate to conversation if missing
            if (!conversation.candidate_id) {
                try {
                    const db = (0, database_1.supabaseAdminClient)();
                    await db
                        .from('whatsapp_conversations')
                        .update({
                        candidate_id: params.candidateId,
                        display_name: params.candidateName || conversation.display_name,
                    })
                        .eq('id', conversation.id);
                }
                catch (linkErr) {
                    console.warn('[CVParser] Failed to link candidate to WhatsApp conversation (non-fatal):', linkErr);
                }
            }
            // ─────────────────────────────────────────────────────────────────────────
            // Determine send strategy:
            //   1. If WHATSAPP_MISSING_DOCS_TEMPLATE_NAME is configured AND the candidate
            //      is missing documents → use Template 2 (missing_documents_request).
            //      This bypasses the 24-hour window restriction that blocks free-form text
            //      to candidates who haven't messaged us first.
            //   2. Otherwise fall back to free-form text (works only within 24h window).
            // ─────────────────────────────────────────────────────────────────────────
            const templateName = (process.env.WHATSAPP_MISSING_DOCS_TEMPLATE_NAME || '').trim();
            // Compute which documents are still missing for this candidate.
            let missingDocsList = [];
            if (templateName) {
                try {
                    const db = (0, database_1.supabaseAdminClient)();
                    const [candRes, docsRes] = await Promise.all([
                        db
                            .from('candidates')
                            .select('cv_received,passport_received,cnic_received,driving_license_received,degree_received')
                            .eq('id', params.candidateId)
                            .maybeSingle(),
                        db
                            .from('candidate_documents')
                            .select('category,document_type,file_name')
                            .eq('candidate_id', params.candidateId)
                            .limit(100),
                    ]);
                    const cand = candRes.data;
                    const categories = new Set((docsRes.data || []).map((d) => String(d?.category || '').toLowerCase()).filter(Boolean));
                    const fileNames = (docsRes.data || []).map((d) => String(d?.file_name || '').toLowerCase());
                    if (!cand?.cv_received && !categories.has('cv_resume') && !categories.has('cv'))
                        missingDocsList.push('CV / Resume');
                    if (!cand?.passport_received && !categories.has('passport') && !fileNames.some((n) => n.includes('passport')))
                        missingDocsList.push('Passport (clear scan, all pages)');
                    if (!cand?.cnic_received && !categories.has('cnic') && !categories.has('national_id') && !fileNames.some((n) => n.includes('cnic') || n.includes('nic')))
                        missingDocsList.push('CNIC (front & back)');
                    if (!cand?.driving_license_received && !categories.has('driving_license') && !fileNames.some((n) => n.includes('driving') || n.includes('license')))
                        missingDocsList.push('Driving License');
                    if (!cand?.degree_received && !categories.has('educational_documents') && !fileNames.some((n) => n.includes('degree') || n.includes('diploma')))
                        missingDocsList.push('Educational Degree / Certificate');
                }
                catch (mdErr) {
                    console.warn('[CVParser] Failed to compute missing docs for WhatsApp template (non-fatal):', mdErr);
                }
            }
            const useTemplate = !!templateName && missingDocsList.length > 0;
            // Build body text (used for free-form fallback and for audit recording)
            const fallbackText = buildCvReceivedWhatsAppText({
                candidateName: params.candidateName,
                candidateEmail: params.candidateEmail,
                missingDataEmailSent: params.missingDataEmailSent,
            });
            const candidateName = (params.candidateName || 'Candidate').trim();
            const candidateCode = (params.candidateCode || 'N/A').trim();
            const bulletList = missingDocsList.map((d) => `• ${d}`).join('\n');
            // Body text to store in whatsapp_messages for visibility in inbox UI
            const recordBody = useTemplate
                ? `[Template: ${templateName}]\n\nAssalam o Alaikum ${candidateName},\n\nThank you for submitting your CV (Ref: ${candidateCode}).\n\nTo complete your application, we still need:\n${bulletList}\n\nPlease reply or send them to our WhatsApp at your earliest convenience.\n\n— Falisha Manpower Team`
                : fallbackText;
            try {
                let sendRes;
                if (useTemplate) {
                    console.log(`[CVParser] Sending Template 2 (${templateName}) to ${to} – ${missingDocsList.length} missing doc(s)`);
                    sendRes = await (0, whatsappService_1.sendTemplateMessage)(phoneNumberId, accessToken, to, {
                        name: templateName,
                        language: 'en',
                        components: [
                            {
                                type: 'body',
                                parameters: [
                                    { type: 'text', text: candidateName }, // {{1}} candidate name
                                    { type: 'text', text: candidateCode }, // {{2}} application reference
                                    { type: 'text', text: bulletList }, // {{3}} missing docs bullet list
                                ],
                            },
                        ],
                    });
                }
                else {
                    console.log(`[CVParser] Template not configured or no missing docs – sending free-form CV received message to ${to}`);
                    sendRes = await (0, whatsappService_1.sendMessage)(phoneNumberId, accessToken, to, fallbackText);
                }
                const metaMessageId = sendRes?.messages?.[0]?.id ?? null;
                await (0, whatsappInboxService_1.recordOutboundMessage)({
                    conversationId: conversation.id,
                    direction: 'outbound',
                    fromNumberId: phoneNumberId,
                    toPhoneNumber: to,
                    body: recordBody,
                    metaMessageId: metaMessageId ?? undefined,
                    status: 'sent',
                    raw: {
                        kind: 'cv_received_notification',
                        inbox_attachment_id: params.attachmentId,
                        candidate_id: params.candidateId,
                        candidate_code: params.candidateCode ?? null,
                        email: params.candidateEmail ?? null,
                        missing_data_email_sent: !!params.missingDataEmailSent,
                        template_used: useTemplate ? templateName : null,
                        missing_docs: useTemplate ? missingDocsList : null,
                        whatsapp_send: sendRes,
                    },
                });
                console.log(`[CVParser] ✅ WhatsApp notification sent (${useTemplate ? 'template' : 'free-form'})`, {
                    attachmentId: params.attachmentId,
                    candidateId: params.candidateId,
                    to,
                    templateName: useTemplate ? templateName : null,
                    missingDocs: missingDocsList,
                });
            }
            catch (sendErr) {
                console.warn('[CVParser] WhatsApp notification send failed (non-fatal):', sendErr?.message || sendErr);
                // Still record the attempt for audit/visibility
                try {
                    await (0, whatsappInboxService_1.recordOutboundMessage)({
                        conversationId: conversation.id,
                        direction: 'outbound',
                        fromNumberId: phoneNumberId,
                        toPhoneNumber: to,
                        body: recordBody,
                        status: 'failed',
                        raw: {
                            kind: 'cv_received_notification',
                            inbox_attachment_id: params.attachmentId,
                            candidate_id: params.candidateId,
                            candidate_code: params.candidateCode ?? null,
                            email: params.candidateEmail ?? null,
                            missing_data_email_sent: !!params.missingDataEmailSent,
                            template_used: useTemplate ? templateName : null,
                            missing_docs: useTemplate ? missingDocsList : null,
                            error: String(sendErr?.message || sendErr),
                        },
                    });
                }
                catch (recordErr) {
                    console.warn('[CVParser] Failed to record failed WhatsApp notification (non-fatal):', recordErr);
                }
            }
        }
        catch (err) {
            console.warn('[CVParser] WhatsApp CV notification failed (non-fatal):', err);
        }
    }
    function parseYear(value) {
        if (!value || typeof value !== 'string')
            return null;
        const v = value.trim();
        if (!v)
            return null;
        if (/^(present|current|now)$/i.test(v))
            return new Date().getFullYear();
        const match = v.match(/(19\d{2}|20\d{2})/);
        if (!match)
            return null;
        const year = Number(match[1]);
        return Number.isFinite(year) ? year : null;
    }
    function inferExperienceYearsFromExperience(experience) {
        if (!Array.isArray(experience) || experience.length === 0)
            return undefined;
        const years = experience
            .filter((e) => e && typeof e === 'object')
            .map((e) => ({
            start: parseYear(e.start_date) ?? undefined,
            end: parseYear(e.end_date) ?? (parseYear(e.start_date) ? new Date().getFullYear() : undefined),
        }))
            .filter((r) => r.start);
        if (years.length === 0)
            return undefined;
        const minStart = Math.min(...years.map((y) => y.start));
        const maxEnd = Math.max(...years.map((y) => (y.end ?? new Date().getFullYear())));
        const diff = maxEnd - minStart;
        if (!Number.isFinite(diff) || diff <= 0)
            return undefined;
        // Keep as integer years for DB column type
        return Math.max(1, Math.round(diff));
    }
    const worker = new bullmq_1.Worker('cv-parsing', async (job) => {
        const { jobId, attachmentId, fileHash, force } = job.data;
        try {
            const db = (0, database_1.supabaseAdminClient)();
            const updateAttachmentParsingStatus = async (status, extra) => {
                const payload = { parsing_status: status };
                if (extra && Object.prototype.hasOwnProperty.call(extra, 'candidate_id')) {
                    payload.candidate_id = extra.candidate_id;
                }
                const { error } = await db
                    .from('inbox_attachments')
                    .update(payload)
                    .eq('id', attachmentId);
                if (error) {
                    console.warn(`[CVParser] Failed to sync attachment parsing_status for ${attachmentId}:`, error.message);
                }
            };
            const setJobAndAttachmentStatus = async (status, extra) => {
                await parsingJobs.setStatus(jobId, status, extra);
                const attachmentExtra = extra && Object.prototype.hasOwnProperty.call(extra, 'candidate_id')
                    ? { candidate_id: extra.candidate_id ?? null }
                    : undefined;
                await updateAttachmentParsingStatus(status, attachmentExtra);
            };
            await setJobAndAttachmentStatus('processing', {
                started_at: new Date().toISOString(),
                attempts: (job.attemptsMade ?? 0) + 1,
                finished_at: null,
                error_code: null,
                error_message: null,
            });
            // Fetch attachment metadata + linked inbox_message to get real Gmail email date.
            // inbox_attachments.received_at is insertion time (useless for date filtering).
            // The actual email date lives in inbox_messages.payload->>'internalDate' (Unix ms from Gmail API).
            const { data: attachmentMeta, error: attachmentMetaError } = await db
                .from('inbox_attachments')
                .select('file_name, mime_type, storage_bucket, storage_path, sha256, candidate_id, parsing_status, attachment_kind, attachment_type, inbox_message_id, inbox_messages(payload, source)')
                .eq('id', attachmentId)
                .maybeSingle();
            if (!force && attachmentMeta?.attachment_kind !== 'cv') {
                console.log(`[CVParser] ⏭  Skipping attachment ${attachmentId} — attachment_kind=${attachmentMeta?.attachment_kind || 'null'} is not cv`);
                await setJobAndAttachmentStatus('extracted', {
                    finished_at: new Date().toISOString(),
                    skipped_reason: 'non_cv_attachment',
                    error_code: null,
                    error_message: null,
                });
                return { skipped: true, reason: 'non_cv_attachment' };
            }
            if (attachmentMetaError) {
                throw new Error(`Failed to fetch attachment metadata: ${attachmentMetaError.message}`);
            }
            // ── Gmail date guard: skip CVs whose email was sent before 2024-01-01 ───────
            // Only applies to Gmail-sourced attachments (internalDate is Gmail Unix ms).
            // WhatsApp / web-upload attachments don’t have internalDate — always process.
            const CV_CUTOFF_MS = new Date('2024-01-01T00:00:00.000Z').getTime();
            const inboxMsg = attachmentMeta?.inbox_messages;
            const gmailInternalDate = inboxMsg?.payload?.internalDate;
            if (gmailInternalDate) {
                // internalDate can arrive as:
                // - Unix ms string: "1704067200000"
                // - Unix sec string: "1704067200"
                // - ISO string:      "2025-09-28T12:50:50.000Z"
                let emailDateMs = null;
                const raw = String(gmailInternalDate).trim();
                if (/^\d+$/.test(raw)) {
                    const asNum = Number(raw);
                    if (Number.isFinite(asNum) && asNum > 0) {
                        // Heuristic: seconds are <= 10 digits, milliseconds are >= 13 digits
                        emailDateMs = raw.length <= 10 ? asNum * 1000 : asNum;
                    }
                }
                else {
                    const parsedIsoMs = Date.parse(raw);
                    if (Number.isFinite(parsedIsoMs)) {
                        emailDateMs = parsedIsoMs;
                    }
                }
                if (emailDateMs && emailDateMs < CV_CUTOFF_MS) {
                    const emailDateStr = new Date(emailDateMs).toISOString().split('T')[0];
                    console.log(`[CVParser] ⏭  Skipping pre-2024 attachment ${attachmentId} — Gmail email date ${emailDateStr} (before cutoff 2024-01-01)`);
                    await setJobAndAttachmentStatus('extracted', {
                        finished_at: new Date().toISOString(),
                        skipped_reason: 'pre_2024_cutoff',
                        error_code: null,
                        error_message: null,
                    });
                    return { skipped: true, reason: 'pre_2024_cutoff', emailDate: emailDateStr };
                }
            }
            // ─────────────────────────────────────────────────────────────────────
            // ── Idempotency guard ──────────────────────────────────────────────────
            // If this attachment was already successfully linked to a candidate by a
            // previous job (e.g., BullMQ retry or Gmail poller picking the same email
            // twice), skip re-processing to avoid creating a duplicate candidate.
            // The `force` flag bypasses this check for manual admin reprocessing.
            if (!force && attachmentMeta?.candidate_id) {
                const existingId = attachmentMeta.candidate_id;
                console.log(`[CVParser] ⏭  Skipping attachment ${attachmentId} — already linked to candidate ${existingId} (idempotency guard)`);
                await setJobAndAttachmentStatus('extracted', {
                    finished_at: new Date().toISOString(),
                    skipped_reason: 'already_linked',
                    candidate_id: existingId,
                });
                return { skipped: true, candidateId: existingId };
            }
            // ──────────────────────────────────────────────────────────────────────
            const storageBucket = attachmentMeta?.storage_bucket || STORAGE_BUCKET;
            const storagePath = attachmentMeta?.storage_path;
            if (!storagePath) {
                throw new Error(`Attachment storage_path missing for attachmentId=${attachmentId}`);
            }
            // Create a fresh signed URL just-in-time (avoid queue delays causing expiry).
            const { data: signed, error: signedErr } = await db.storage
                .from(storageBucket)
                .createSignedUrl(storagePath, 3600);
            if (signedErr || !signed?.signedUrl) {
                throw new Error(`Failed to create signed URL for attachment: ${signedErr?.message || 'unknown error'}`);
            }
            const fileUrl = signed.signedUrl;
            // Download bytes from storage for identity extraction (base64).
            const download = await db.storage.from(storageBucket).download(storagePath);
            const downloadError = download?.error;
            const fileData = download?.data;
            if (downloadError || !fileData) {
                throw new Error(`Failed to download attachment from storage: ${downloadError?.message || 'unknown error'}`);
            }
            const fileArrayBuffer = await fileData.arrayBuffer();
            const fileBytes = Buffer.from(fileArrayBuffer);
            if (fileBytes.length === 0) {
                throw new Error('Downloaded attachment is empty');
            }
            const fileBase64 = fileBytes.toString('base64');
            const fileName = attachmentMeta?.file_name || 'upload.pdf';
            const mimeType = attachmentMeta?.mime_type ||
                (fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
            const resolvedFileHash = fileHash ?? attachmentMeta?.sha256 ?? null;
            // ── File-hash dedup: skip parser if identical CV already processed ──────────
            if (!force && resolvedFileHash) {
                const { data: dupAttachment } = await db
                    .from('inbox_attachments')
                    .select('id, candidate_id')
                    .eq('sha256', resolvedFileHash)
                    .not('candidate_id', 'is', null)
                    .neq('id', attachmentId)
                    .limit(1)
                    .maybeSingle();
                if (dupAttachment?.candidate_id) {
                    console.log(`[CVParser] ⏭  Skipping attachment ${attachmentId} — duplicate file hash (sha256 match), already linked to candidate ${dupAttachment.candidate_id}`);
                    await db
                        .from('inbox_attachments')
                        .update({ candidate_id: dupAttachment.candidate_id })
                        .eq('id', attachmentId);
                    await setJobAndAttachmentStatus('extracted', {
                        finished_at: new Date().toISOString(),
                        skipped_reason: 'duplicate_file_hash',
                        candidate_id: dupAttachment.candidate_id,
                        error_code: null,
                        error_message: null,
                    });
                    return { skipped: true, reason: 'duplicate_file_hash', candidateId: dupAttachment.candidate_id };
                }
            }
            // ─────────────────────────────────────────────────────────────────────────
            const payloadObj = {
                attachment_id: attachmentId,
                file_url: fileUrl,
                file_hash: resolvedFileHash,
            };
            const payload = JSON.stringify(payloadObj);
            // Step 1: Parse CV for professional fields.
            // Prefer the URL-based parser route when it exists, but fall back to the
            // base64 endpoint for deployments that only expose /parse.
            let parsed;
            const res = await fetch(`${PY_URL}/parse-cv`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-signature': signHmac(payload),
                },
                body: payload,
            });
            if (res.ok) {
                parsed = await res.json();
            }
            else {
                const text = await res.text();
                if (!isMissingParseCvRoute(res.status, text)) {
                    throw new Error(`PYTHON_${res.status}: ${text.slice(0, 300)}`);
                }
                console.warn('[CVParser] /parse-cv unavailable, retrying with /parse fallback', {
                    attachmentId,
                    parserUrl: PY_URL,
                });
                const fallbackPayload = JSON.stringify({
                    file_content: fileBase64,
                    file_name: fileName,
                    mime_type: mimeType,
                });
                const fallbackRes = await fetch(`${PY_URL}/parse`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-hmac-signature': signHmac(fallbackPayload),
                    },
                    body: fallbackPayload,
                });
                if (!fallbackRes.ok) {
                    const fallbackText = await fallbackRes.text();
                    throw new Error(`PYTHON_${fallbackRes.status}: ${fallbackText.slice(0, 300)}`);
                }
                const fallbackParsed = await fallbackRes.json();
                parsed = fallbackParsed?.data ?? fallbackParsed;
            }
            const parsedCandidate = parsed.candidate || {};
            const parsedIdentityFields = {
                name: parsedCandidate.full_name || parsedCandidate.name || null,
                father_name: parsedCandidate.father_name || null,
                cnic: parsedCandidate.cnic || null,
                passport_no: parsedCandidate.passport || parsedCandidate.passport_no || null,
                email: parsedCandidate.email || null,
                phone: parsedCandidate.phone || null,
                date_of_birth: parsedCandidate.date_of_birth || null,
                dob: parsedCandidate.date_of_birth || parsedCandidate.dob || null,
                nationality: parsedCandidate.nationality || null,
                passport_expiry: parsedCandidate.passport_expiry || null,
                expiry_date: parsedCandidate.passport_expiry || parsedCandidate.expiry_date || null,
            };
            const identityFields = Object.values(parsedIdentityFields).some((value) => Boolean(value))
                ? parsedIdentityFields
                : null;
            console.log(`[CVParser] Using identity fields extracted during CV parse:`, {
                hasName: !!identityFields?.name,
                hasFatherName: !!identityFields?.father_name,
                hasCNIC: !!identityFields?.cnic,
                hasPassport: !!identityFields?.passport_no,
                hasDOB: !!identityFields?.date_of_birth,
            });
            await setJobAndAttachmentStatus('extracted', {
                finished_at: new Date().toISOString(),
                schema_version: parsed.schema_version ?? 'v1',
                result_json: { ...parsed, identity_fields: identityFields },
                error_code: null,
                error_message: null,
            });
            // Use progressive completion service to find existing candidate
            // Priority: CNIC > Passport > Email/Phone > Name + Father Name + DOB
            const { findExistingCandidate, enrichCandidateData, updateMissingFields } = await Promise.resolve().then(() => __importStar(require('../services/progressiveDataCompletionService')));
            if (!hasRealCandidateSignals(parsedCandidate, identityFields)) {
                console.log(`[CVParser] ⚠️  Parsed attachment ${attachmentId} — no candidate signals found (no name/phone/email/experience). Marking as needs_review.`);
                // Keep the job as 'extracted' (parsing succeeded) but flag the attachment for human review.
                await parsingJobs.setStatus(jobId, 'extracted', {
                    finished_at: new Date().toISOString(),
                    schema_version: parsed.schema_version ?? 'v1',
                    result_json: { ...parsed, identity_fields: identityFields },
                    skipped_reason: 'insufficient_candidate_signals',
                    error_code: null,
                    error_message: null,
                });
                await db.from('inbox_attachments').update({ parsing_status: 'needs_review' }).eq('id', attachmentId);
                return { skipped: true, reason: 'insufficient_candidate_signals' };
            }
            // Combine data from the CV parse and normalized identity fields.
            const derivedPreviousEmployment = typeof parsedCandidate.previous_employment === 'string' && parsedCandidate.previous_employment.trim()
                ? parsedCandidate.previous_employment
                : buildPreviousEmploymentFromExperience(parsedCandidate.experience);
            const derivedExperienceYears = typeof parsedCandidate.experience_years === 'number' && Number.isFinite(parsedCandidate.experience_years)
                ? parsedCandidate.experience_years
                : inferExperienceYearsFromExperience(parsedCandidate.experience);
            const combinedData = {
                // From parse-cv
                name: parsedCandidate.full_name,
                email: parsedCandidate.email,
                phone: parsedCandidate.phone,
                nationality: parsedCandidate.nationality,
                father_name: parsedCandidate.father_name,
                cnic: parsedCandidate.cnic,
                passport: parsedCandidate.passport,
                passport_no: parsedCandidate.passport, // For matching
                date_of_birth: parsedCandidate.date_of_birth,
                marital_status: parsedCandidate.marital_status,
                position: parsedCandidate.position || (0, professionInferenceService_1.inferProfessionFromCvData)(parsedCandidate),
                experience_years: derivedExperienceYears,
                country_of_interest: parsedCandidate.country_of_interest,
                skills: parsedCandidate.skills,
                languages: parsedCandidate.languages,
                education: parsedCandidate.education,
                certifications: parsedCandidate.certifications,
                internships: parsedCandidate.internships,
                previous_employment: derivedPreviousEmployment,
                passport_expiry: parsedCandidate.passport_expiry,
                professional_summary: parsedCandidate.professional_summary || parsedCandidate.summary,
            };
            // Override with identityFields if available (from categorize-document)
            if (identityFields) {
                if (identityFields.name)
                    combinedData.name = identityFields.name;
                if (identityFields.father_name)
                    combinedData.father_name = identityFields.father_name;
                if (identityFields.cnic)
                    combinedData.cnic = identityFields.cnic;
                if (identityFields.passport_no) {
                    combinedData.passport = identityFields.passport_no;
                    combinedData.passport_no = identityFields.passport_no;
                }
                if (identityFields.email)
                    combinedData.email = identityFields.email;
                if (identityFields.phone)
                    combinedData.phone = identityFields.phone;
                if (identityFields.date_of_birth || identityFields.dob) {
                    combinedData.date_of_birth = parseDate(identityFields.date_of_birth || identityFields.dob, 'date_of_birth');
                }
                if (identityFields.nationality)
                    combinedData.nationality = identityFields.nationality;
                if (identityFields.passport_expiry || identityFields.expiry_date) {
                    combinedData.passport_expiry = parseDate(identityFields.passport_expiry || identityFields.expiry_date, 'passport_expiry');
                }
            }
            // Also parse the initial dates from parsedCandidate
            if (combinedData.date_of_birth) {
                combinedData.date_of_birth = parseDate(combinedData.date_of_birth, 'date_of_birth');
            }
            if (combinedData.passport_expiry) {
                combinedData.passport_expiry = parseDate(combinedData.passport_expiry, 'passport_expiry');
            }
            // WhatsApp CVs are often forwarded by recruiters or agencies on behalf of
            // multiple candidates, so a shared phone/email is not strong enough to
            // auto-link on its own.
            const requireCorroborationForContactSignals = inboxMsg?.source === 'whatsapp';
            // Find existing candidate using progressive completion matching.
            // If force=true and the attachment is already linked to a candidate, use that
            // ID directly — progressive matching may fail (e.g. WhatsApp corroboration rules)
            // when the candidate was already identified by an earlier verification step.
            let existingCandidateId = await findExistingCandidate(combinedData, {
                requireCorroborationForContactSignals,
            });
            if (!existingCandidateId && force && attachmentMeta?.candidate_id) {
                console.log(`[CVParser] Progressive match returned no result; using attachment's linked candidate ${attachmentMeta.candidate_id} (force=true)`);
                existingCandidateId = attachmentMeta.candidate_id;
            }
            // ── Sibling-attachment race condition guard ────────────────────────────
            // When a single email contains many attachments (e.g. CV + passport +
            // certificates), BullMQ processes them all concurrently.  Each job may
            // see an empty DB (no candidate yet) and create its own duplicate.
            // Fix: if a sibling attachment from the same inbox_message was already
            // linked to a candidate, use that candidate instead of creating a new one.
            const siblingInboxMessageId = attachmentMeta?.inbox_message_id;
            if (!existingCandidateId && siblingInboxMessageId) {
                const { data: siblingAttachment } = await db
                    .from('inbox_attachments')
                    .select('candidate_id')
                    .eq('inbox_message_id', siblingInboxMessageId)
                    .not('candidate_id', 'is', null)
                    .neq('id', attachmentId)
                    .limit(1)
                    .maybeSingle();
                if (siblingAttachment?.candidate_id) {
                    existingCandidateId = siblingAttachment.candidate_id;
                    console.log(`[CVParser] 🔗 Sibling-attachment match: using candidate ${existingCandidateId} ` +
                        `from same inbox_message ${siblingInboxMessageId} (prevents race-condition duplicate)`);
                }
            }
            // ──────────────────────────────────────────────────────────────────────
            let candidate;
            if (existingCandidateId) {
                // Update existing candidate using progressive completion
                console.log(`[CVParser] Found existing candidate ${existingCandidateId}, enriching with CV data...`);
                // Enrich candidate with CV data (progressive completion - only fills missing fields)
                const enrichmentResult = await enrichCandidateData(existingCandidateId, combinedData, 'cv', attachmentId, 'cv');
                console.log(`[CVParser] ✅ Progressive enrichment completed:`, {
                    updated: enrichmentResult.updated,
                    skipped: enrichmentResult.skipped,
                    source: 'cv',
                });
                // Recalculate missing fields
                await updateMissingFields(existingCandidateId);
                // Get updated candidate
                const { data: updatedCandidate } = await db
                    .from('candidates')
                    .select('*')
                    .eq('id', existingCandidateId)
                    .maybeSingle();
                candidate = updatedCandidate;
                // Apply profile photo from parser response if this candidate doesn't have one yet
                const rawPhotoUrl = parsedCandidate?.profile_photo_url || undefined;
                const normalizedProfilePhotoUrl = typeof rawPhotoUrl === 'string' && rawPhotoUrl.trim() ? rawPhotoUrl.trim() : undefined;
                const isProfilePhotoPdf = !!normalizedProfilePhotoUrl && normalizedProfilePhotoUrl.toLowerCase().includes('.pdf');
                if (!hasProfilePhoto(candidate) && normalizedProfilePhotoUrl && !isProfilePhotoPdf) {
                    try {
                        await db.from('candidates').update({
                            profile_photo_url: normalizedProfilePhotoUrl,
                            photo_received: true,
                            photo_received_at: new Date().toISOString(),
                        }).eq('id', existingCandidateId);
                        console.log(`[CVParser] ✅ Applied profile photo from parser for existing candidate ${existingCandidateId}: ${normalizedProfilePhotoUrl}`);
                    }
                    catch (photoApplyErr) {
                        console.warn(`[CVParser] Failed to apply photo to existing candidate (non-fatal):`, photoApplyErr?.message || photoApplyErr);
                    }
                }
                // Link attachment to existing candidate
                await db
                    .from('inbox_attachments')
                    .update({ candidate_id: existingCandidateId })
                    .eq('id', attachmentId);
                // Persist Gmail thread identity (if this CV came via Gmail)
                await maybeAttachGmailThreadToCandidate(existingCandidateId, attachmentId);
                await reconcileAttachmentCandidateOwnership(existingCandidateId, attachmentId);
                // Detect backfill: suppress immediate missing-data email to avoid mass spam on historical imports
                const { backfill: isBackfill } = await getInboxPayloadForAttachment(attachmentId);
                // Fetch updated candidate to check if gmail_thread_id was set
                const { data: updatedCandidateForEmail } = await db
                    .from('candidates')
                    .select('gmail_thread_id')
                    .eq('id', existingCandidateId)
                    .maybeSingle();
                // Ensure CV is marked received before sending missing-data email.
                // This avoids asking the candidate to attach the CV we just ingested.
                try {
                    await db
                        .from('candidates')
                        .update({
                        cv_received: true,
                        cv_received_at: new Date().toISOString(),
                    })
                        .eq('id', existingCandidateId);
                }
                catch (flagErr) {
                    console.warn('[CVParser] Failed to set cv_received before email (non-fatal):', flagErr?.message || flagErr);
                }
                // Send missing-data email (Gmail-threaded if thread exists, standalone otherwise)
                // SKIP for backfill CVs — mass emailing historical candidates on import is not acceptable.
                let missingDataEmailSent = false;
                if (isBackfill) {
                    console.log(`[CVParser] Backfill CV — suppressing immediate missing-data email for candidate ${existingCandidateId}`);
                }
                else {
                    try {
                        const { maybeSendMissingDataEmail } = await Promise.resolve().then(() => __importStar(require('../services/missingDataEmailService')));
                        const res = await maybeSendMissingDataEmail({
                            candidateId: existingCandidateId,
                            trigger: 'cv_parsed_existing',
                        });
                        missingDataEmailSent = !!res?.sent;
                    }
                    catch (emailErr) {
                        console.warn('[CVParser] Missing-data email send failed (non-fatal):', emailErr);
                    }
                } // end !isBackfill
                // Notify candidate on CV-extracted phone (WhatsApp-origin CVs only)
                await maybeSendCvReceivedWhatsAppNotification({
                    attachmentId,
                    candidateId: existingCandidateId,
                    candidateName: candidate?.name ?? null,
                    candidateCode: candidate?.candidate_code ?? null,
                    cvExtractedPhone: combinedData?.phone ?? null,
                    candidatePhone: candidate?.phone ?? null,
                    candidateEmail: (combinedData?.email ?? candidate?.email) ?? null,
                    missingDataEmailSent,
                });
                console.log(`[CVParser] ✅ Enriched existing candidate ${existingCandidateId} with CV data`);
            }
            else {
                // Create new candidate from parsed data (including identity fields) and link to attachment
                candidate = await createCandidateFromParsedData(parsed, attachmentId, identityFields, inboxMsg?.source);
                // If creation failed silently (e.g. duplicate email/CNIC), fall back to finding
                // the existing candidate without WhatsApp corroboration restrictions.
                if (!candidate?.id) {
                    const fallbackId = await findExistingCandidate(combinedData, {
                        requireCorroborationForContactSignals: false,
                    });
                    if (fallbackId) {
                        console.log(`[CVParser] createCandidateFromParsedData returned null -- fallback matched existing candidate ${fallbackId}. Linking attachment.`);
                        await db.from('inbox_attachments').update({ candidate_id: fallbackId, linked_candidate_id: fallbackId }).eq('id', attachmentId);
                        existingCandidateId = fallbackId;
                        const { data: fc } = await db.from('candidates').select('*').eq('id', fallbackId).maybeSingle();
                        candidate = fc;
                    }
                }
                // After creation (or fallback link), enrich with any additional data and recalculate missing fields
                if (candidate?.id) {
                    try {
                        await enrichCandidateData(candidate.id, combinedData, 'cv', attachmentId, 'cv');
                        await updateMissingFields(candidate.id);
                        await reconcileAttachmentCandidateOwnership(candidate.id, attachmentId);
                        // Persist Gmail thread identity (if this CV came via Gmail)
                        await maybeAttachGmailThreadToCandidate(candidate.id, attachmentId);
                        // Detect backfill: suppress immediate missing-data email to avoid mass spam on historical imports
                        const { backfill: isBackfillNew } = await getInboxPayloadForAttachment(attachmentId);
                        // Fetch updated candidate to check if gmail_thread_id was set
                        const { data: updatedCandidateNew } = await db
                            .from('candidates')
                            .select('gmail_thread_id')
                            .eq('id', candidate.id)
                            .maybeSingle();
                        // Ensure CV is marked received before sending missing-data email.
                        // This avoids asking the candidate to attach the CV we just ingested.
                        try {
                            await db
                                .from('candidates')
                                .update({
                                cv_received: true,
                                cv_received_at: new Date().toISOString(),
                            })
                                .eq('id', candidate.id);
                        }
                        catch (flagErr) {
                            console.warn('[CVParser] Failed to set cv_received before email (non-fatal):', flagErr?.message || flagErr);
                        }
                        // Send missing-data email (Gmail-threaded if thread exists, standalone otherwise)
                        // SKIP for backfill CVs — mass emailing historical candidates on import is not acceptable.
                        let missingDataEmailSent = false;
                        if (isBackfillNew) {
                            console.log(`[CVParser] Backfill CV — suppressing immediate missing-data email for new candidate ${candidate.id}`);
                        }
                        else {
                            try {
                                const { maybeSendMissingDataEmail } = await Promise.resolve().then(() => __importStar(require('../services/missingDataEmailService')));
                                const res = await maybeSendMissingDataEmail({
                                    candidateId: candidate.id,
                                    trigger: 'cv_parsed_new',
                                });
                                missingDataEmailSent = !!res?.sent;
                            }
                            catch (emailErr) {
                                console.warn('[CVParser] Missing-data email send failed (non-fatal):', emailErr);
                            }
                        } // end !isBackfillNew
                        // Notify candidate on CV-extracted phone (WhatsApp-origin CVs only)
                        await maybeSendCvReceivedWhatsAppNotification({
                            attachmentId,
                            candidateId: candidate.id,
                            candidateName: candidate?.name ?? null,
                            candidateCode: candidate?.candidate_code ?? null,
                            cvExtractedPhone: combinedData?.phone ?? null,
                            candidatePhone: candidate?.phone ?? null,
                            candidateEmail: (combinedData?.email ?? candidate?.email) ?? null,
                            missingDataEmailSent,
                        });
                    }
                    catch (enrichError) {
                        console.warn(`[CVParser] Failed to enrich newly created candidate:`, enrichError);
                    }
                }
            }
            const newCandidate = candidate;
            // If all candidate creation / matching attempts failed, flag for human review.
            // This prevents the attachment from silently staying 'extracted' with no candidate.
            if (!newCandidate?.id) {
                console.warn(`[CVParser] ⚠️  No candidate created or found for attachment ${attachmentId} after all attempts. Marking as needs_review.`);
                await setJobAndAttachmentStatus('extracted', {
                    finished_at: new Date().toISOString(),
                    skipped_reason: 'candidate_creation_failed',
                    error_code: null,
                    error_message: null,
                });
                await db.from('inbox_attachments').update({ parsing_status: 'needs_review' }).eq('id', attachmentId);
                return { skipped: true, reason: 'candidate_creation_failed' };
            }
            // ============================================================================
            // Ensure ORIGINAL CV is visible as a candidate document for non-PDF uploads.
            // PDF uploads are handled by split-and-categorize below which generates cv_resume.
            // ============================================================================
            if (newCandidate?.id && mimeType !== 'application/pdf') {
                try {
                    await ensureOriginalCvCandidateDocument({
                        db,
                        candidate: newCandidate,
                        attachmentId,
                        fileName,
                        mimeType,
                        fileBytes,
                        reason: 'non_pdf_upload',
                    });
                }
                catch (ensureErr) {
                    console.warn('[CVParser] Failed to ensure original CV candidate_document (non-fatal):', ensureErr?.message || ensureErr);
                }
            }
            // ============================================================================
            // SPLIT-AND-CATEGORIZE for multi-document PDFs uploaded via CV Inbox (Web Form)
            // This is required so inbox uploads also create candidate_documents + mapped folders.
            // ============================================================================
            if (newCandidate?.id && mimeType === 'application/pdf') {
                try {
                    const shouldSkipSingleCvSplit = (0, singleCvHeuristics_1.shouldSkipSplitAndCategorizeForSingleCvUpload)({
                        fileName,
                        attachmentKind: attachmentMeta?.attachment_kind,
                        parsedCandidate,
                    });
                    if (shouldSkipSingleCvSplit) {
                        console.log(`[CVParser] PDF detected for attachment ${attachmentId}. Skipping split-and-categorize for likely single CV upload.`);
                        await ensureOriginalCvCandidateDocument({
                            db,
                            candidate: newCandidate,
                            attachmentId,
                            fileName,
                            mimeType,
                            fileBytes,
                            reason: 'single_cv_pdf_skip',
                        });
                    }
                    else {
                        console.log(`[CVParser] PDF detected for attachment ${attachmentId}. Running split-and-categorize for candidate ${newCandidate.id}...`);
                        // Avoid creating duplicate split documents on reprocessing unless explicitly forced.
                        let shouldSkipSplit = false;
                        if (!force) {
                            const { data: existingSplitDocs, error: existingErr } = await db
                                .from('candidate_documents')
                                .select('id')
                                .eq('inbox_attachment_id', attachmentId)
                                .limit(1);
                            if (!existingErr && existingSplitDocs && existingSplitDocs.length > 0) {
                                console.log(`[CVParser] Split documents already exist for attachment ${attachmentId}; skipping split-and-categorize (use force=1 to override).`);
                                shouldSkipSplit = true;
                            }
                        }
                        if (shouldSkipSplit) {
                            // Skip split doc creation to avoid duplicates.
                        }
                        else {
                            // Preserve original PDF for audit/reprocessing
                            const uploadId = (0, crypto_2.randomUUID)();
                            const originalPath = await (0, splitUploadService_1.preserveOriginalPdf)(fileBytes, uploadId, mimeType);
                            console.log(`[CVParser] Original PDF preserved at: ${originalPath}`);
                            const splitResult = await (0, splitUploadService_1.callSplitAndCategorize)(fileBase64, fileName, mimeType, undefined, false);
                            const docs = (splitResult?.documents || []).slice().sort((a, b) => {
                                const aIsCv = String(a?.doc_type || '').toLowerCase() === 'cv_resume';
                                const bIsCv = String(b?.doc_type || '').toLowerCase() === 'cv_resume';
                                if (aIsCv === bIsCv)
                                    return 0;
                                return aIsCv ? -1 : 1;
                            });
                            console.log(`[CVParser] Split returned ${docs.length} document(s) (engine=${splitResult.engine_used})`);
                            // Only create records when we have at least 1 doc (normally always true)
                            for (const d of docs) {
                                try {
                                    const folder = (0, splitUploadService_1.docTypeToFolder)(d.doc_type);
                                    const pdfBuffer = Buffer.from(d.pdf_base64, 'base64');
                                    const docTypeLower = (d.doc_type || '').toLowerCase();
                                    // Special handling: if parser produced a PHOTOS PDF section, try hybrid extraction
                                    // from that section instead of scanning the whole CV.
                                    if ((docTypeLower === 'photo' || docTypeLower === 'photos') && d.is_image !== true) {
                                        try {
                                            console.log(`[CVParser] Photos PDF detected for candidate ${newCandidate.id}. Attempting hybrid extraction from photos section...`);
                                            const extractionResult = await (0, hybridPhotoExtractionService_1.extractProfilePhotoHybrid)(newCandidate.id, attachmentId, pdfBuffer);
                                            if (extractionResult.success && extractionResult.photoBuffer) {
                                                const uploaded = await (0, hybridPhotoExtractionService_1.uploadExtractedPhotoToCandidatePhotos)(newCandidate.id, attachmentId, extractionResult.photoBuffer);
                                                console.log(`[CVParser] ✅ Hybrid photos-section extraction succeeded (method=${extractionResult.method}). Skipping split_photos document creation.`, {
                                                    candidateId: newCandidate.id,
                                                    attachmentId,
                                                    storagePath: uploaded.storagePath,
                                                });
                                                continue;
                                            }
                                            console.log(`[CVParser] Hybrid photos-section extraction did not produce a photo. Continuing with normal split document creation.`, {
                                                candidateId: newCandidate.id,
                                                attachmentId,
                                            });
                                        }
                                        catch (hyErr) {
                                            console.warn(`[CVParser] Hybrid photos-section extraction error; continuing with normal split document creation:`, hyErr?.message || hyErr);
                                        }
                                    }
                                    // Use shared utility to handle image detection, profile photo saving, and storage upload
                                    let processed;
                                    try {
                                        processed = await (0, splitDocumentProcessor_1.processSplitDocument)(d, newCandidate.id, uploadId, folder);
                                    }
                                    catch (processErr) {
                                        console.error(`[CVParser] Failed to process split doc ${d.doc_type}:`, processErr.message);
                                        continue;
                                    }
                                    // Map parser doc_type to candidate_documents category
                                    const categoryMap = {
                                        cv_resume: documentCategories_1.DOCUMENT_CATEGORIES.CV_RESUME,
                                        passport: documentCategories_1.DOCUMENT_CATEGORIES.PASSPORT,
                                        national_id: documentCategories_1.DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
                                        cnic: documentCategories_1.DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
                                        driving_license: documentCategories_1.DOCUMENT_CATEGORIES.OTHER_DOCUMENTS,
                                        police_character_certificate: documentCategories_1.DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE,
                                        police_certificate: documentCategories_1.DOCUMENT_CATEGORIES.POLICE_CHARACTER_CERTIFICATE,
                                        educational_documents: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                                        educational_document: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                                        degree: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                                        diploma: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                                        transcript: documentCategories_1.DOCUMENT_CATEGORIES.EDUCATIONAL_DOCUMENTS,
                                        experience_certificate: documentCategories_1.DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES,
                                        experience_certificates: documentCategories_1.DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES,
                                        employment_certificate: documentCategories_1.DOCUMENT_CATEGORIES.EXPERIENCE_CERTIFICATES,
                                        navttc_report: documentCategories_1.DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
                                        navttc_reports: documentCategories_1.DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
                                        navttc: documentCategories_1.DOCUMENT_CATEGORIES.NAVTTC_REPORTS,
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
                                    const category = categoryMap[d.doc_type] || documentCategories_1.DOCUMENT_CATEGORIES.OTHER_DOCUMENTS;
                                    // Map parser doc_type to DB constraint document_type
                                    const docTypeMap = {
                                        passport: 'passport',
                                        cnic: 'cnic',
                                        national_id: 'cnic',
                                        police_character_certificate: 'police_character_certificate',
                                        police_certificate: 'police_character_certificate',
                                        educational_documents: 'degree',
                                        educational_document: 'degree',
                                        degree: 'degree',
                                        diploma: 'degree',
                                        transcript: 'degree',
                                        experience_certificate: 'certificate',
                                        experience_certificates: 'certificate',
                                        employment_certificate: 'certificate',
                                        navttc_report: 'certificate',
                                        navttc_reports: 'certificate',
                                        navttc: 'certificate',
                                        cv_resume: 'other',
                                        medical_reports: 'medical',
                                        medical_certificate: 'medical',
                                        certificate: 'certificate',
                                        certificates: 'certificate',
                                        professional_certificate: 'certificate',
                                        driving_license: 'other',
                                        contracts: 'other',
                                        contract: 'other',
                                        photos: 'other',
                                        other_documents: 'other',
                                    };
                                    const dbDocumentType = docTypeMap[d.doc_type] || 'other';
                                    // For extracted profile photos, set verification_status to 'verified' to skip approval workflow
                                    const verificationStatus = processed.shouldAutoVerify
                                        ? documentCategories_1.VERIFICATION_STATUS.VERIFIED
                                        : documentCategories_1.VERIFICATION_STATUS.PENDING_AI;
                                    // Important: candidate_documents has a unique index on inbox_attachment_id in some deployments.
                                    // We only attach inbox_attachment_id to the CV/resume row to keep idempotency without blocking
                                    // creation of multiple extracted documents.
                                    const isCvResumeDoc = docTypeLower === 'cv_resume';
                                    const splitDocData = {
                                        candidate_id: newCandidate.id,
                                        inbox_attachment_id: isCvResumeDoc ? attachmentId : null,
                                        document_type: dbDocumentType,
                                        category,
                                        detected_category: category,
                                        confidence: d.confidence ?? null,
                                        ai_confidence: d.confidence ?? null,
                                        extracted_identity_json: d.identity && typeof d.identity === 'object' ? d.identity : {},
                                        ai_processing_completed_at: d.confidence != null ? new Date().toISOString() : null,
                                        storage_bucket: STORAGE_BUCKET,
                                        storage_path: processed.storagePath,
                                        file_name: (0, documentNaming_1.generateDescriptiveFilename)({
                                            doc_type: d.doc_type,
                                            pages: d.pages,
                                            split_strategy: d.split_strategy,
                                            page_number: d.pages && d.pages.length === 1 ? d.pages[0] : undefined,
                                        }, newCandidate.name, Date.now()),
                                        mime_type: processed.mimeType, // Use detected MIME type (image/jpeg for photos)
                                        source: 'web',
                                        status: 'received',
                                        verification_status: verificationStatus, // Auto-verify extracted photos
                                        received_at: new Date().toISOString(),
                                    };
                                    const { data: createdDoc, error: insErr } = await db
                                        .from('candidate_documents')
                                        .insert(splitDocData)
                                        .select()
                                        .single();
                                    if (insErr || !createdDoc) {
                                        console.error(`[CVParser] Failed to create candidate_document for ${d.doc_type}:`, insErr);
                                        await db.storage.from(STORAGE_BUCKET).remove([processed.storagePath]);
                                        continue;
                                    }
                                    // Permanent safety net: if a photos split is still a PDF, immediately try AI extraction
                                    // from that specific split document before leaving the parse flow.
                                    if (category === documentCategories_1.DOCUMENT_CATEGORIES.PHOTOS && processed.mimeType === 'application/pdf') {
                                        try {
                                            const { data: candidatePhotoState } = await db
                                                .from('candidates')
                                                .select('profile_photo_bucket, profile_photo_path, profile_photo_url')
                                                .eq('id', newCandidate.id)
                                                .maybeSingle();
                                            if (!hasProfilePhoto(candidatePhotoState)) {
                                                const aiResult = await (0, aiProfilePhotoExtractionService_1.extractProfilePhotoFromPdfUsingAI)({
                                                    candidateId: newCandidate.id,
                                                    documentId: createdDoc.id,
                                                    maxPages: 10,
                                                });
                                                console.log(`[CVParser] ✅ AI extracted profile photo from split photos PDF`, {
                                                    candidateId: newCandidate.id,
                                                    documentId: createdDoc.id,
                                                    pageUsed: aiResult.pageUsed,
                                                    confidence: aiResult.confidence,
                                                });
                                            }
                                        }
                                        catch (aiExtractErr) {
                                            console.warn(`[CVParser] AI extraction from split photos PDF failed (non-fatal):`, aiExtractErr?.message || aiExtractErr);
                                        }
                                    }
                                    // Enqueue verification job (skip for auto-verified photos)
                                    if (verificationStatus !== documentCategories_1.VERIFICATION_STATUS.VERIFIED) {
                                        const splitRequestId = (0, documentVerificationLogService_1.generateRequestId)();
                                        try {
                                            await queue_1.documentVerificationQueue.add('verify-document', {
                                                requestId: splitRequestId,
                                                documentId: createdDoc.id,
                                                candidateId: newCandidate.id,
                                                storageBucket: STORAGE_BUCKET,
                                                storagePath: processed.storagePath,
                                                fileName: createdDoc.file_name,
                                                mimeType: processed.mimeType,
                                            }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
                                        }
                                        catch (qErr) {
                                            console.error(`[CVParser] Failed to enqueue verification for split doc ${createdDoc.id}:`, qErr?.message || qErr);
                                        }
                                    }
                                    else {
                                        console.log(`[CVParser] ⏭️  Skipped AI verification for auto-verified photo ${createdDoc.id}`);
                                    }
                                }
                                catch (oneErr) {
                                    console.error(`[CVParser] Error processing split doc:`, oneErr?.message || oneErr);
                                }
                            }
                            // If the splitter didn't emit a cv_resume doc, create a single CV entry so the
                            // original CV is visible in the candidate documents list (and to keep split idempotency).
                            try {
                                const { data: hasLinked, error: hasLinkedErr } = await db
                                    .from('candidate_documents')
                                    .select('id')
                                    .eq('inbox_attachment_id', attachmentId)
                                    .limit(1);
                                if (!hasLinkedErr && (!hasLinked || hasLinked.length === 0)) {
                                    const timestamp = Date.now();
                                    const sanitizedFileName = String(fileName).replace(/[^a-zA-Z0-9.\-_]/g, '_');
                                    const destPath = `${newCandidate.id}/cv_resume/${timestamp}_${sanitizedFileName}`;
                                    const upload = await db.storage.from(STORAGE_BUCKET).upload(destPath, fileBytes, {
                                        upsert: true,
                                        contentType: mimeType,
                                    });
                                    const uploadErr = upload?.error;
                                    if (uploadErr) {
                                        throw new Error(`Failed to copy CV to candidate storage: ${uploadErr.message || 'unknown error'}`);
                                    }
                                    const cvDocData = {
                                        candidate_id: newCandidate.id,
                                        inbox_attachment_id: attachmentId,
                                        document_type: 'other',
                                        category: documentCategories_1.DOCUMENT_CATEGORIES.CV_RESUME,
                                        detected_category: documentCategories_1.DOCUMENT_CATEGORIES.CV_RESUME,
                                        confidence: null,
                                        storage_bucket: STORAGE_BUCKET,
                                        storage_path: destPath,
                                        file_name: (0, documentNaming_1.generateDescriptiveFilename)({ doc_type: 'cv_resume' }, newCandidate.name, timestamp),
                                        mime_type: mimeType,
                                        source: 'web',
                                        status: 'received',
                                        verification_status: documentCategories_1.VERIFICATION_STATUS.PENDING_AI,
                                        received_at: new Date().toISOString(),
                                    };
                                    const { data: createdCvDoc, error: cvInsErr } = await db
                                        .from('candidate_documents')
                                        .insert(cvDocData)
                                        .select()
                                        .single();
                                    if (cvInsErr || !createdCvDoc) {
                                        console.warn('[CVParser] Failed to create fallback cv_resume candidate_document (non-fatal):', cvInsErr);
                                    }
                                    else {
                                        const requestId = (0, documentVerificationLogService_1.generateRequestId)();
                                        try {
                                            await queue_1.documentVerificationQueue.add('verify-document', {
                                                requestId,
                                                documentId: createdCvDoc.id,
                                                candidateId: newCandidate.id,
                                                storageBucket: STORAGE_BUCKET,
                                                storagePath: destPath,
                                                fileName: createdCvDoc.file_name,
                                                mimeType,
                                            }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
                                        }
                                        catch (qErr) {
                                            console.warn('[CVParser] Failed to enqueue verification for fallback cv_resume (non-fatal):', qErr?.message || qErr);
                                        }
                                    }
                                }
                            }
                            catch (fallbackErr) {
                                console.warn('[CVParser] Failed to ensure fallback cv_resume after split (non-fatal):', fallbackErr?.message || fallbackErr);
                            }
                        }
                    }
                }
                catch (splitErr) {
                    const msg = String(splitErr?.message || splitErr || '');
                    const statusMatch = msg.match(/split-and-categorize failed \((\d+)\)/i);
                    const statusCode = statusMatch ? Number(statusMatch[1]) : null;
                    // If the parser is temporarily unavailable (e.g. Railway cold-start / 502),
                    // fail the job so BullMQ can retry (attempts/backoff configured on enqueue).
                    const isTransient = statusCode === 502 ||
                        statusCode === 503 ||
                        statusCode === 504 ||
                        /Application failed to respond/i.test(msg) ||
                        /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(msg);
                    console.error(`[CVParser] Split-and-categorize failed for attachment ${attachmentId}:`, msg);
                    if (isTransient) {
                        throw new Error(`Transient split-and-categorize failure (will retry): ${msg}`);
                    }
                    // Non-blocking for non-transient failures: CV parsing should still succeed.
                }
            }
            // If no profile photo exists yet, try extracting it directly from the CV PDF.
            // Strategy (in order):
            //   1. Hybrid extraction: Python parser /extract-photo on the full CV buffer (fast, reliable face detection)
            //   2. Fallback: OpenAI Vision page scan via Puppeteer (extractProfilePhotoFromPdfUsingAI)
            // This ensures WhatsApp-ingested CVs where the photo is embedded in the CV pages (no separate
            // 'photos' split section) still get a profile photo extracted reliably.
            if (newCandidate?.id && mimeType === 'application/pdf') {
                try {
                    const { data: freshCandidate } = await db
                        .from('candidates')
                        .select('profile_photo_bucket, profile_photo_path, profile_photo_url, photo_received')
                        .eq('id', newCandidate.id)
                        .maybeSingle();
                    if (!hasProfilePhoto(freshCandidate)) {
                        console.log(`[CVParser] No profile photo found for candidate ${newCandidate.id}. Attempting hybrid extraction from full CV PDF...`);
                        // Primary: Python parser /extract-photo + AI buffer fallback (no Puppeteer needed)
                        const hybridResult = await (0, hybridPhotoExtractionService_1.extractProfilePhotoHybrid)(newCandidate.id, attachmentId, fileBytes);
                        if (hybridResult.success && hybridResult.photoBuffer) {
                            await (0, hybridPhotoExtractionService_1.uploadExtractedPhotoToCandidatePhotos)(newCandidate.id, attachmentId, hybridResult.photoBuffer);
                            console.log(`[CVParser] ✅ Hybrid extraction from full CV succeeded (method=${hybridResult.method}).`, {
                                candidateId: newCandidate.id,
                                attachmentId,
                            });
                        }
                        else {
                            // Secondary fallback: OpenAI Vision scan of rendered PDF pages via Puppeteer
                            console.log(`[CVParser] Hybrid extraction produced no photo for candidate ${newCandidate.id}. Falling back to AI page scan...`);
                            const extraction = await (0, aiProfilePhotoExtractionService_1.extractProfilePhotoFromPdfUsingAI)({
                                candidateId: newCandidate.id,
                                maxPages: 10,
                            });
                            console.log(`[CVParser] ✅ AI page scan extracted photo from CV PDF`, {
                                candidateId: newCandidate.id,
                                pageUsed: extraction.pageUsed,
                                confidence: extraction.confidence,
                            });
                        }
                    }
                    else {
                        console.log(`[CVParser] Profile photo already present for candidate ${newCandidate.id}. Skipping CV photo extraction.`);
                    }
                }
                catch (photoErr) {
                    console.warn(`[CVParser] CV photo extraction failed for candidate ${newCandidate?.id}:`, photoErr?.message || photoErr);
                }
            }
            // IMPORTANT: Set cv_received flag immediately after candidate is created from inbox CV
            // This ensures the document flag shows green/red on the card from the start
            if (newCandidate?.id) {
                try {
                    // Call the service function directly instead of the controller to avoid mock response issues
                    const { data: documents } = await db
                        .from('candidate_documents')
                        .select('category')
                        .eq('candidate_id', newCandidate.id);
                    const hasCV = documents?.some((d) => d.category === 'cv_resume' || d.category === 'cv');
                    if (hasCV || parsed.candidate) {
                        await db
                            .from('candidates')
                            .update({
                            cv_received: true,
                            cv_received_at: new Date().toISOString()
                        })
                            .eq('id', newCandidate.id);
                        console.log(`[CVParser] Successfully set cv_received flag for candidate ${newCandidate.id}`);
                    }
                }
                catch (flagError) {
                    // Log but don't fail the parsing job if flag update fails
                    console.error(`[CVParser] Failed to update document flags for candidate ${newCandidate.id}:`, flagError?.message);
                }
            }
            return { ok: true };
        }
        catch (err) {
            const db = (0, database_1.supabaseAdminClient)();
            const errMsg = safeErrorMessage(err);
            // PERMANENT DEFUSE: known DB constraint / varchar overflow should NEVER retry-loop.
            // Mark the attachment as unknown + needs_review to force the worker to skip it in future,
            // and prevent BullMQ from retrying this job.
            if (isVarcharOverflowError(err)) {
                const { error: attachmentUpdateError } = await db
                    .from('inbox_attachments')
                    .update({ attachment_kind: 'unknown', parsing_status: 'needs_review' })
                    .eq('id', attachmentId);
                if (attachmentUpdateError) {
                    console.warn(`[CVParser] Failed to defuse attachment ${attachmentId} after varchar overflow:`, attachmentUpdateError.message);
                }
                await parsingJobs.setStatus(jobId, 'failed', {
                    finished_at: new Date().toISOString(),
                    error_code: 'NON_RETRYABLE_DB_VARCHAR_OVERFLOW',
                    error_message: errMsg,
                });
                throw new bullmq_1.UnrecoverableError(`Non-retryable DB varchar overflow: ${errMsg}`);
            }
            const { error: attachmentStatusError } = await db
                .from('inbox_attachments')
                .update({ parsing_status: 'failed' })
                .eq('id', attachmentId);
            if (attachmentStatusError) {
                console.warn(`[CVParser] Failed to mark attachment ${attachmentId} as failed:`, attachmentStatusError.message);
            }
            await parsingJobs.setStatus(jobId, 'failed', {
                finished_at: new Date().toISOString(),
                error_code: 'PARSING_FAILED',
                error_message: errMsg,
            });
            throw err;
        }
    }, {
        connection: redis_1.redis,
        concurrency: 2,
        drainDelay: 60, // seconds — idle poll every 60s instead of 5s
        stalledInterval: 300000, // check stalled jobs every 5 min instead of 30s
        lockDuration: 60000, // 1-min lock → renewal every 30s instead of 15s
        limiter: { max: 10, duration: 60000 },
    });
    worker.on('failed', async (job, err) => {
        const maxAttempts = job?.opts?.attempts ?? 3;
        const attemptsMade = job?.attemptsMade ?? 0;
        console.error('cv-parsing failed', job?.id, `attempt ${attemptsMade}/${maxAttempts}`, err?.message);
        // Only alert admin when all retries are exhausted — never on intermediate failures
        if (job && attemptsMade >= maxAttempts) {
            const { attachmentId, jobId } = (job.data ?? {});
            const adminEmail = process.env.ADMIN_ALERT_EMAIL || 'falishaoep4035@gmail.com';
            try {
                await emailService_1.emailService.sendEmail({
                    to: adminEmail,
                    subject: `[Falisha] CV parsing permanently failed – ${attachmentId ?? jobId ?? job.id}`,
                    html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #dc2626; padding: 16px; border-radius: 8px 8px 0 0;">
                <h2 style="color: white; margin: 0;">CV Parsing Failed Permanently</h2>
              </div>
              <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
                <p>A CV has exhausted all <strong>${maxAttempts} retry attempts</strong> and will not retry automatically. Manual review is required.</p>
                <table style="border-collapse: collapse; width: 100%;">
                  <tr><td style="padding: 6px; font-weight: bold;">Attachment ID:</td><td style="padding: 6px;">${attachmentId ?? 'N/A'}</td></tr>
                  <tr><td style="padding: 6px; font-weight: bold;">Parsing Job ID:</td><td style="padding: 6px;">${jobId ?? 'N/A'}</td></tr>
                  <tr><td style="padding: 6px; font-weight: bold;">Error:</td><td style="padding: 6px; color: #dc2626;">${err?.message ?? 'Unknown error'}</td></tr>
                  <tr><td style="padding: 6px; font-weight: bold;">Attempts:</td><td style="padding: 6px;">${attemptsMade} of ${maxAttempts}</td></tr>
                  <tr><td style="padding: 6px; font-weight: bold;">Failed at:</td><td style="padding: 6px;">${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} (PKT)</td></tr>
                </table>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
                <p><a href="https://app.falishajobs.com/cv-inbox" style="background: #2563eb; color: white; padding: 8px 16px; border-radius: 4px; text-decoration: none;">Review in CV Inbox</a></p>
                <p style="color: #6b7280; font-size: 13px;">To retry manually, open the CV Inbox, find this attachment and click Reprocess.</p>
              </div>
            </div>`,
                    text: `CV Parsing Failed Permanently\nAttachment ID: ${attachmentId ?? 'N/A'}\nError: ${err?.message ?? 'Unknown error'}\nAttempts: ${attemptsMade}/${maxAttempts}\nReview: https://app.falishajobs.com/cv-inbox`,
                });
                console.log(`[CVParser] Admin notified of permanent failure for attachment ${attachmentId}`);
            }
            catch (emailErr) {
                console.warn('[CVParser] Failed to send admin failure notification:', emailErr?.message);
            }
        }
    });
    return worker;
}
