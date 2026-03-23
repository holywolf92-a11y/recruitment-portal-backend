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
exports.maybeSendMissingDataEmail = maybeSendMissingDataEmail;
exports.generateMissingDataEmailContent = generateMissingDataEmailContent;
exports.sendStandaloneMissingDataEmail = sendStandaloneMissingDataEmail;
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('MissingDataEmailService');
const REQUESTED_MISSING_FIELDS = ['country_of_interest', 'salary_expectation'];
const REQUESTED_MISSING_DOCS = ['passport', 'cnic'];
const FIELD_LABEL_OVERRIDES = {
    country_of_interest: 'Country of Interest',
    salary_expectation: 'Salary Exp.',
};
function sha256(text) {
    return crypto_1.default.createHash('sha256').update(text).digest('hex');
}
function generateTrackingToken() {
    // Generate 8-char alphanumeric tracking token (production-grade approach)
    // Format: 2 letters + 6 digits (e.g., FL123456)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const prefix = chars[Math.floor(Math.random() * chars.length)] + chars[Math.floor(Math.random() * chars.length)];
    const numbers = Math.floor(100000 + Math.random() * 900000);
    return `${prefix}${numbers}`;
}
function safeString(value) {
    return typeof value === 'string' ? value : '';
}
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function getCandidatePreferredEmail(candidate) {
    // IMPORTANT:
    // Always prefer the candidate's extracted email.
    // Do NOT fall back to gmail_from_email because it can be a forwarder/sender
    // and may not belong to the candidate.
    const email = safeString(candidate?.email).trim();
    return email || null;
}
async function computeMissingDocsForCandidate(args) {
    const candidate = args.candidate;
    const flags = {
        cv_received: !!candidate?.cv_received,
        passport_received: !!candidate?.passport_received,
        cnic_received: !!candidate?.cnic_received,
        driving_license_received: !!candidate?.driving_license_received,
        degree_received: !!candidate?.degree_received,
    };
    let docs = [];
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { data } = await db
            .from('candidate_documents')
            .select('category, document_type, file_name')
            .eq('candidate_id', args.candidateId)
            .limit(200);
        docs = data || [];
    }
    catch {
        // Non-fatal: fallback to flags only.
        docs = [];
    }
    const categories = new Set(docs
        .map((d) => (typeof d?.category === 'string' ? d.category.toLowerCase().trim() : ''))
        .filter(Boolean));
    const docTypes = new Set(docs
        .map((d) => (typeof d?.document_type === 'string' ? d.document_type.toLowerCase().trim() : ''))
        .filter(Boolean));
    const fileNames = docs
        .map((d) => (typeof d?.file_name === 'string' ? d.file_name.toLowerCase() : ''))
        .filter(Boolean);
    const hasCv = flags.cv_received || categories.has('cv_resume') || categories.has('cv');
    const hasPassport = flags.passport_received || categories.has('passport') || docTypes.has('passport') || fileNames.some((n) => n.includes('passport'));
    const hasCnic = flags.cnic_received || categories.has('cnic') || docTypes.has('cnic') || fileNames.some((n) => n.includes('cnic') || n.includes('nic'));
    const hasDrivingLicense = flags.driving_license_received || categories.has('driving_license') || docTypes.has('driving_license') || fileNames.some((n) => n.includes('driving') || n.includes('license') || n.includes('licence'));
    const hasEducation = flags.degree_received || categories.has('educational_documents') || docTypes.has('degree') || fileNames.some((n) => n.includes('degree') || n.includes('diploma') || n.includes('transcript'));
    const hasPolice = categories.has('police_character_certificate') || fileNames.some((n) => n.includes('police'));
    const missing = [];
    // Only request the core documents requested by the client.
    if (!hasCv)
        missing.push('cv');
    if (!hasPassport)
        missing.push('passport');
    if (!hasCnic)
        missing.push('cnic');
    if (!hasDrivingLicense)
        missing.push('driving_license');
    if (!hasPolice)
        missing.push('police_certificate');
    if (!hasEducation)
        missing.push('degree');
    return Array.from(new Set(missing));
}
function docLabel(doc) {
    switch (doc) {
        case 'cv':
            return 'CV / Resume';
        case 'passport':
            return 'Passport';
        case 'cnic':
            return 'CNIC / National ID';
        case 'driving_license':
            return 'Driving License';
        case 'police_certificate':
            return 'Police Character Certificate';
        case 'degree':
            return 'Educational Documents';
        default:
            return doc;
    }
}
function getRequestedMissingFields(args) {
    return args.missingFieldsRaw
        .filter((field) => REQUESTED_MISSING_FIELDS.includes(field))
        .map((field) => ({
        field,
        label: FIELD_LABEL_OVERRIDES[field] || args.fieldLabels[field] || field,
    }));
}
async function getRequestedMissingDocs(args) {
    const allMissingDocs = await computeMissingDocsForCandidate({
        candidateId: args.candidateId,
        candidate: args.candidate,
        missingFields: args.missingFieldsRaw,
    });
    return allMissingDocs.filter((doc) => REQUESTED_MISSING_DOCS.includes(doc));
}
async function getRequestedMissingData(args) {
    const { calculateMissingFields, EXCEL_BROWSER_FIELDS } = await Promise.resolve().then(() => __importStar(require('./progressiveDataCompletionService')));
    const missingFieldsRaw = Array.from(new Set(calculateMissingFields(args.candidate)));
    const missingFields = getRequestedMissingFields({
        missingFieldsRaw,
        fieldLabels: EXCEL_BROWSER_FIELDS,
    });
    const missingDocs = await getRequestedMissingDocs({
        candidateId: args.candidateId,
        candidate: args.candidate,
        missingFieldsRaw,
    });
    return {
        missingFieldsRaw,
        missingFields,
        missingDocs,
    };
}
function renderMissingDataEmail(args) {
    const name = (args.candidateName || '').trim() || 'Candidate';
    const fieldsLinesText = args.missingFields.map((f) => `${f.label}: `);
    const fieldsBlockText = fieldsLinesText.length ? fieldsLinesText.join('\n') : '';
    const docsLinesText = args.missingDocs.map((d) => `- ${docLabel(d)}`);
    const docsBlockText = docsLinesText.join('\n');
    const fieldsTableRowsHtml = args.missingFields
        .map((f) => `<tr>` +
        `<td style="padding:6px; vertical-align:top;"><strong>${escapeHtml(f.label)}</strong></td>` +
        `<td style="padding:6px; vertical-align:top;">&nbsp;</td>` +
        `</tr>`)
        .join('');
    const docsListHtml = args.missingDocs.length
        ? `<ul>${args.missingDocs.map((d) => `<li>${escapeHtml(docLabel(d))}</li>`).join('')}</ul>`
        : '';
    const referenceBlockText = [
        '--- Reference (please keep) ---',
        `RAP_CANDIDATE_ID: ${args.candidateId}`,
    ].join('\n');
    // Embed tracking token in subject for reliable reply matching
    const trackingToken = args.trackingToken || '';
    const subject = trackingToken
        ? `Action required: please send missing documents [#${trackingToken}]`
        : 'Action required: please send missing documents';
    const bodyText = [
        `Assalam o Alaikum ${name},`,
        '',
        'Thanks for your application. To complete your profile, please share the missing details below and send clear photos/scans of the required documents.',
        '',
        fieldsBlockText ? 'Reply with:' : '',
        fieldsBlockText || '',
        '',
        args.missingDocs.length ? 'Please attach:' : '',
        args.missingDocs.length ? docsBlockText : '',
        '',
        'Notes:',
        '- Please reply to this same email (keep the thread).',
        '- Do not send passwords/OTPs.',
        '',
        referenceBlockText,
        '',
        'JazakAllah.',
    ].join('\n');
    const bodyHtml = [
        `<p>Assalam o Alaikum ${escapeHtml(name)},</p>`,
        `<p>Thanks for your application. To complete your profile, please share the missing details below and send clear photos/scans of the required documents.</p>`,
        args.missingFields.length
            ? `<p><strong>Reply with:</strong></p>` +
                `<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%;">` +
                `<thead><tr><th align="left" style="padding:6px;">Field</th><th align="left" style="padding:6px;">Answer</th></tr></thead>` +
                `<tbody>${fieldsTableRowsHtml}</tbody>` +
                `</table>`
            : '',
        args.missingDocs.length
            ? `<p><strong>Please attach:</strong></p>${docsListHtml}`
            : '',
        `<p><strong>Notes:</strong></p>`,
        `<ul><li>Please reply to this same email (keep the thread).</li><li>Do not send passwords/OTPs.</li></ul>`,
        `<!-- ${escapeHtml(`RAP_CANDIDATE_ID: ${args.candidateId}`)} -->`,
        `<p>JazakAllah.</p>`,
    ].join('');
    const snapshotHash = sha256(JSON.stringify({
        candidate_id: args.candidateId,
        missing_fields: args.missingFields.map((f) => f.field),
        missing_docs: args.missingDocs,
    }));
    return { subject, bodyText, bodyHtml, snapshotHash };
}
function addHours(date, hours) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
}
async function maybeSendMissingDataEmail(args) {
    const db = (0, database_1.supabaseAdminClient)();
    try {
        const { data: candidate, error } = await db
            .from('candidates')
            .select('*')
            .eq('id', args.candidateId)
            .maybeSingle();
        if (error || !candidate) {
            logger.warn('Candidate not found for missing-data email', { candidateId: args.candidateId, error });
            return { sent: false, reason: 'candidate_not_found' };
        }
        const toEmail = getCandidatePreferredEmail(candidate);
        if (!toEmail) {
            return { sent: false, reason: 'missing_email' };
        }
        const { missingFieldsRaw, missingFields, missingDocs } = await getRequestedMissingData({
            candidateId: args.candidateId,
            candidate,
        });
        const importantMissingFieldsRaw = missingFields.map((field) => field.field);
        if (missingFields.length === 0 && missingDocs.length === 0) {
            if (candidate.missing_data_email_status !== 'completed') {
                await db
                    .from('candidates')
                    .update({
                    missing_data_email_status: 'completed',
                    missing_data_email_next_send_at: null,
                })
                    .eq('id', args.candidateId);
            }
            return { sent: false, reason: 'nothing_missing' };
        }
        const status = safeString(candidate.missing_data_email_status).trim() || 'inactive';
        const attempts = Number(candidate.missing_data_email_attempts || 0);
        if (status === 'stopped' || status === 'completed') {
            return { sent: false, reason: 'status_blocked' };
        }
        if (attempts >= 3) {
            await db
                .from('candidates')
                .update({
                missing_data_email_status: 'stopped',
                missing_data_email_next_send_at: null,
            })
                .eq('id', args.candidateId);
            return { sent: false, reason: 'max_attempts' };
        }
        const now = new Date();
        const nextSendAt = candidate.missing_data_email_next_send_at
            ? new Date(String(candidate.missing_data_email_next_send_at))
            : null;
        if (!args.force) {
            if (nextSendAt && nextSendAt.getTime() > now.getTime()) {
                return { sent: false, reason: 'cooldown' };
            }
        }
        // Generate or reuse tracking token for subject-line threading
        let trackingToken = safeString(candidate.email_tracking_token).trim();
        if (!trackingToken) {
            trackingToken = generateTrackingToken();
            await db
                .from('candidates')
                .update({ email_tracking_token: trackingToken })
                .eq('id', args.candidateId);
        }
        const rendered = renderMissingDataEmail({
            candidateId: args.candidateId,
            candidateName: candidate.name,
            missingFields,
            missingDocs,
            trackingToken,
        });
        // Send via EmailService (Resend in production, SMTP in local dev)
        const { emailService: emailSvc } = await Promise.resolve().then(() => __importStar(require('./emailService')));
        const sendResult = await emailSvc.sendEmailDetailed({
            to: toEmail,
            subject: rendered.subject,
            html: rendered.bodyHtml,
            text: rendered.bodyText,
            auditPayload: {
                candidateId: args.candidateId,
                candidateName: candidate.name || null,
                trackingToken,
                kind: 'missing_data_request',
                trigger: args.trigger,
                missingFields: importantMissingFieldsRaw,
                missingDocs,
            },
        });
        if (!sendResult.sent) {
            return { sent: false, reason: 'send_failed' };
        }
        const newAttempts = attempts + 1;
        const newNextSendAt = addHours(now, 24);
        await db
            .from('candidates')
            .update({
            missing_data_email_status: 'active',
            missing_data_email_attempts: newAttempts,
            missing_data_email_last_sent_at: now.toISOString(),
            missing_data_email_next_send_at: newNextSendAt.toISOString(),
            missing_data_email_last_snapshot_hash: rendered.snapshotHash,
        })
            .eq('id', args.candidateId);
        try {
            await db.from('candidate_missing_data_email_log').insert({
                candidate_id: args.candidateId,
                provider_message_id: sendResult.providerMessageId || null,
                to_email: toEmail,
                subject: rendered.subject,
                body_text: rendered.bodyText,
                missing_fields: importantMissingFieldsRaw,
                missing_docs: missingDocs,
                attempt_no: newAttempts,
                trigger: args.trigger,
            });
        }
        catch (logErr) {
            logger.warn('Failed to write missing-data email log (non-fatal)', { candidateId: args.candidateId, error: logErr });
        }
        return { sent: true, attempt: newAttempts };
    }
    catch (err) {
        logger.error('maybeSendMissingDataEmail failed', err, { candidateId: args.candidateId, trigger: args.trigger });
        return { sent: false, reason: 'error' };
    }
}
async function generateMissingDataEmailContent(args) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data: candidate, error } = await db
        .from('candidates')
        .select('*')
        .eq('id', args.candidateId)
        .maybeSingle();
    if (error || !candidate) {
        return { ok: false, reason: 'candidate_not_found' };
    }
    const toEmail = getCandidatePreferredEmail(candidate);
    if (!toEmail) {
        return { ok: false, reason: 'missing_email' };
    }
    const { missingFields, missingDocs } = await getRequestedMissingData({
        candidateId: args.candidateId,
        candidate,
    });
    const rendered = renderMissingDataEmail({
        candidateId: args.candidateId,
        candidateName: candidate.name,
        missingFields,
        missingDocs,
    });
    return {
        ok: true,
        toEmail,
        subject: rendered.subject,
        bodyText: rendered.bodyText,
        bodyHtml: rendered.bodyHtml,
        missingFields,
        missingDocs,
        snapshotHash: rendered.snapshotHash,
    };
}
/**
 * Send standalone missing-data email via Brevo/SMTP for manual CV uploads
 * (not Gmail-threaded). Same missing-fields logic + cooldown/max-attempts.
 */
async function sendStandaloneMissingDataEmail(args) {
    const db = (0, database_1.supabaseAdminClient)();
    try {
        const { data: candidate, error } = await db
            .from('candidates')
            .select('*')
            .eq('id', args.candidateId)
            .maybeSingle();
        if (error || !candidate) {
            return { sent: false, reason: 'candidate_not_found' };
        }
        const toEmail = getCandidatePreferredEmail(candidate);
        if (!toEmail) {
            return { sent: false, reason: 'missing_email' };
        }
        const { missingFields, missingDocs } = await getRequestedMissingData({
            candidateId: args.candidateId,
            candidate,
        });
        const importantMissingFieldsRaw = missingFields.map((field) => field.field);
        if (missingFields.length === 0 && missingDocs.length === 0) {
            if (candidate.missing_data_email_status !== 'completed') {
                await db
                    .from('candidates')
                    .update({
                    missing_data_email_status: 'completed',
                    missing_data_email_next_send_at: null,
                })
                    .eq('id', args.candidateId);
            }
            return { sent: false, reason: 'nothing_missing' };
        }
        const status = safeString(candidate.missing_data_email_status).trim() || 'inactive';
        const attempts = Number(candidate.missing_data_email_attempts || 0);
        if (status === 'stopped' || status === 'completed') {
            return { sent: false, reason: 'status_blocked' };
        }
        if (attempts >= 3) {
            await db
                .from('candidates')
                .update({
                missing_data_email_status: 'stopped',
                missing_data_email_next_send_at: null,
            })
                .eq('id', args.candidateId);
            return { sent: false, reason: 'max_attempts' };
        }
        const now = new Date();
        const nextSendAt = candidate.missing_data_email_next_send_at
            ? new Date(String(candidate.missing_data_email_next_send_at))
            : null;
        if (!args.force) {
            if (nextSendAt && nextSendAt.getTime() > now.getTime()) {
                return { sent: false, reason: 'cooldown' };
            }
        }
        // Generate or reuse tracking token (same as maybeSendMissingDataEmail)
        let trackingToken = safeString(candidate.email_tracking_token).trim();
        if (!trackingToken) {
            trackingToken = generateTrackingToken();
            await db
                .from('candidates')
                .update({ email_tracking_token: trackingToken })
                .eq('id', args.candidateId);
        }
        const rendered = renderMissingDataEmail({
            candidateId: args.candidateId,
            candidateName: candidate.name,
            missingFields,
            missingDocs,
            trackingToken,
        });
        // Send via Hostinger SMTP
        const { emailService: emailSvc } = await Promise.resolve().then(() => __importStar(require('./emailService')));
        const smtpResult = await emailSvc.sendEmailDetailed({
            to: toEmail,
            subject: rendered.subject,
            html: rendered.bodyHtml,
            text: rendered.bodyText,
            auditPayload: {
                candidateId: args.candidateId,
                candidateName: candidate.name || null,
                trackingToken,
                kind: 'missing_data_request',
                trigger: args.trigger,
                missingFields: importantMissingFieldsRaw,
                missingDocs,
            },
        });
        if (!smtpResult.sent) {
            return { sent: false, reason: 'send_failed' };
        }
        const newAttempts = attempts + 1;
        const newNextSendAt = addHours(now, 24);
        await db
            .from('candidates')
            .update({
            missing_data_email_status: 'active',
            missing_data_email_attempts: newAttempts,
            missing_data_email_last_sent_at: now.toISOString(),
            missing_data_email_next_send_at: newNextSendAt.toISOString(),
            missing_data_email_last_snapshot_hash: rendered.snapshotHash,
        })
            .eq('id', args.candidateId);
        try {
            await db.from('candidate_missing_data_email_log').insert({
                candidate_id: args.candidateId,
                provider_message_id: smtpResult.providerMessageId || null,
                to_email: toEmail,
                subject: rendered.subject,
                body_text: rendered.bodyText,
                missing_fields: importantMissingFieldsRaw,
                missing_docs: missingDocs,
                attempt_no: newAttempts,
                trigger: args.trigger,
            });
        }
        catch (logErr) {
            logger.warn('Failed to write missing-data email log (non-fatal)', { candidateId: args.candidateId });
        }
        return { sent: true, attempt: newAttempts };
    }
    catch (err) {
        logger.error('sendStandaloneMissingDataEmail failed', err, { candidateId: args.candidateId });
        return { sent: false, reason: 'error' };
    }
}
