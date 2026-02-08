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
const gmailService_1 = require("./gmailService");
const logger = (0, errorHandling_1.createLogger)('MissingDataEmailService');
function sha256(text) {
    return crypto_1.default.createHash('sha256').update(text).digest('hex');
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
async function maybeBackfillGmailThreadIdentity(candidateId) {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const { data: candidate } = await db
            .from('candidates')
            .select('id,email,gmail_thread_id,gmail_from_email')
            .eq('id', candidateId)
            .maybeSingle();
        if (!candidate)
            return { ok: false };
        if (safeString(candidate.gmail_thread_id).trim())
            return { ok: false };
        const { data: rows, error } = await db
            .from('inbox_attachments')
            .select('inbox_message_id, created_at, inbox_messages (source, payload)')
            .eq('candidate_id', candidateId)
            .order('created_at', { ascending: false })
            .limit(10);
        if (error || !rows || rows.length === 0)
            return { ok: false };
        for (const row of rows) {
            const msg = row?.inbox_messages;
            if (!msg || msg.source !== 'gmail')
                continue;
            const payload = msg.payload || {};
            const threadId = typeof payload.threadId === 'string' ? payload.threadId.trim() : '';
            if (!threadId)
                continue;
            const subject = typeof payload.subject === 'string' ? payload.subject : null;
            const messageIdHeader = typeof payload.messageIdHeader === 'string'
                ? payload.messageIdHeader
                : typeof payload.messageId === 'string'
                    ? payload.messageId
                    : null;
            const fromRaw = typeof payload.from === 'string' ? payload.from : '';
            const emailMatch = fromRaw.match(/<([^>]+)>/) || fromRaw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
            const fromEmail = (emailMatch?.[1] || emailMatch?.[0] || '').trim() || null;
            const candidateEmail = safeString(candidate.email).trim();
            const update = {
                gmail_thread_id: threadId,
                gmail_last_subject: subject,
                gmail_last_message_id: messageIdHeader,
            };
            // Only set gmail_from_email if candidate has no real email.
            // This avoids accidentally preferring a forwarding sender over the candidate's actual email.
            if (!candidateEmail && fromEmail) {
                update.gmail_from_email = fromEmail;
            }
            await db.from('candidates').update(update).eq('id', candidateId);
            return { ok: true, threadId, subject, messageIdHeader, fromEmail };
        }
        return { ok: false };
    }
    catch {
        return { ok: false };
    }
}
async function computeMissingDocsForCandidate(args) {
    const candidate = args.candidate;
    const flags = {
        cv_received: !!candidate?.cv_received,
        passport_received: !!candidate?.passport_received,
        degree_received: !!candidate?.degree_received,
        medical_received: !!candidate?.medical_received,
        certificate_received: !!candidate?.certificate_received,
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
    const hasEducation = flags.degree_received || categories.has('educational_documents') || docTypes.has('degree') || fileNames.some((n) => n.includes('degree') || n.includes('diploma') || n.includes('transcript'));
    const hasExperienceCerts = categories.has('experience_certificates');
    const hasNavttc = categories.has('navttc_reports') || fileNames.some((n) => n.includes('navttc'));
    const hasPolice = categories.has('police_character_certificate') || fileNames.some((n) => n.includes('police'));
    const hasProfessionalCerts = flags.certificate_received || categories.has('certificates') || categories.has('certificate') || docTypes.has('certificate');
    const hasContracts = categories.has('contracts') || fileNames.some((n) => n.includes('contract'));
    const hasMedical = flags.medical_received || categories.has('medical_reports') || categories.has('medical') || docTypes.has('medical') || fileNames.some((n) => n.includes('medical'));
    const missing = [];
    // Only request what's actually missing (but include all categories you listed).
    if (!hasCv)
        missing.push('cv');
    if (!hasPassport)
        missing.push('passport');
    if (!hasEducation)
        missing.push('degree');
    if (!hasExperienceCerts)
        missing.push('experience_certificates');
    if (!hasNavttc)
        missing.push('navttc_reports');
    if (!hasPolice)
        missing.push('police_certificate');
    if (!hasProfessionalCerts)
        missing.push('certificate');
    if (!hasContracts)
        missing.push('contracts');
    if (!hasMedical)
        missing.push('medical');
    return Array.from(new Set(missing));
}
function docLabel(doc) {
    switch (doc) {
        case 'cv':
            return '📄 CV / Resume';
        case 'passport':
            return '🛂 Passport';
        case 'degree':
            return '🎓 Educational Documents';
        case 'experience_certificates':
            return '💼 Experience Certificates';
        case 'navttc_reports':
            return '👷 NAVTTC Reports';
        case 'police_certificate':
            return '👮 Police Certificate';
        case 'medical':
            return '🏥 Medical Reports';
        case 'certificate':
            return '📜 Professional Certificates';
        case 'contracts':
            return '📋 Contracts';
        default:
            return doc;
    }
}
function renderMissingDataEmail(args) {
    const name = (args.candidateName || '').trim() || 'Candidate';
    const fieldsLinesText = args.missingFields.map((f) => `${f.label}: `);
    const fieldsBlockText = fieldsLinesText.length ? fieldsLinesText.join('\n') : '(No fields listed)';
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
    const subject = 'Action required: reply with missing details';
    const bodyText = [
        `Assalam o Alaikum ${name},`,
        '',
        'Thanks for your application. To complete your profile, please reply with the missing details below.',
        'You can simply type your answers after each ":" on the same line.',
        '',
        'Reply (copy/paste and fill):',
        fieldsBlockText,
        '',
        args.missingDocs.length
            ? 'Please also attach clear photos/scans of these document(s):\n' + docsBlockText
            : '',
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
        `<p>Thanks for your application. To complete your profile, please reply with the missing details below.</p>`,
        `<p><strong>Tip:</strong> You can type your answers in the right column, or after each “:” in your reply.</p>`,
        args.missingFields.length
            ? `<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%;">` +
                `<thead><tr><th align="left" style="padding:6px;">Field</th><th align="left" style="padding:6px;">Answer</th></tr></thead>` +
                `<tbody>${fieldsTableRowsHtml}</tbody>` +
                `</table>`
            : `<p>(No fields listed)</p>`,
        args.missingDocs.length
            ? `<p><strong>Please also attach clear photos/scans of:</strong></p>${docsListHtml}`
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
        let threadId = safeString(candidate.gmail_thread_id).trim();
        const inReplyTo = safeString(candidate.gmail_last_message_id).trim();
        const lastSubject = safeString(candidate.gmail_last_subject).trim();
        if (!toEmail) {
            return { sent: false, reason: 'missing_email' };
        }
        if (!threadId) {
            const backfill = await maybeBackfillGmailThreadIdentity(args.candidateId);
            if (backfill.ok) {
                threadId = backfill.threadId;
            }
        }
        if (!threadId)
            return { sent: false, reason: 'missing_thread' };
        const { calculateMissingFields, EXCEL_BROWSER_FIELDS } = await Promise.resolve().then(() => __importStar(require('./progressiveDataCompletionService')));
        const missingFieldsRaw = Array.from(new Set(calculateMissingFields(candidate)));
        const missingFields = missingFieldsRaw.map((field) => ({
            field,
            label: EXCEL_BROWSER_FIELDS[field] || field,
        }));
        const missingDocs = await computeMissingDocsForCandidate({
            candidateId: args.candidateId,
            candidate,
            missingFields: missingFieldsRaw,
        });
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
        const rendered = renderMissingDataEmail({
            candidateId: args.candidateId,
            candidateName: candidate.name,
            missingFields,
            missingDocs,
        });
        const subject = lastSubject ? `Re: ${lastSubject.replace(/^re:\s*/i, '')}` : rendered.subject;
        await (0, gmailService_1.sendThreadReply)({
            toEmail,
            subject,
            bodyText: rendered.bodyText,
            threadId,
            inReplyToMessageId: inReplyTo || undefined,
            referencesMessageId: inReplyTo || undefined,
        });
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
                gmail_thread_id: threadId,
                to_email: toEmail,
                subject,
                body_text: rendered.bodyText,
                missing_fields: missingFieldsRaw,
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
    const { calculateMissingFields, EXCEL_BROWSER_FIELDS } = await Promise.resolve().then(() => __importStar(require('./progressiveDataCompletionService')));
    const missingFieldsRaw = Array.from(new Set(calculateMissingFields(candidate)));
    const missingFields = missingFieldsRaw.map((field) => ({
        field,
        label: EXCEL_BROWSER_FIELDS[field] || field,
    }));
    const missingDocs = await computeMissingDocsForCandidate({
        candidateId: args.candidateId,
        candidate,
        missingFields: missingFieldsRaw,
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
        const { calculateMissingFields, EXCEL_BROWSER_FIELDS } = await Promise.resolve().then(() => __importStar(require('./progressiveDataCompletionService')));
        const missingFieldsRaw = Array.from(new Set(calculateMissingFields(candidate)));
        const missingFields = missingFieldsRaw.map((field) => ({
            field,
            label: EXCEL_BROWSER_FIELDS[field] || field,
        }));
        const missingDocs = await computeMissingDocsForCandidate({
            candidateId: args.candidateId,
            candidate,
            missingFields: missingFieldsRaw,
        });
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
        const rendered = renderMissingDataEmail({
            candidateId: args.candidateId,
            candidateName: candidate.name,
            missingFields,
            missingDocs,
        });
        // Send via Brevo/emailService (SMTP, not Gmail)
        const { emailService: emailSvc } = await Promise.resolve().then(() => __importStar(require('./emailService')));
        const brevoResult = await emailSvc.sendEmail({
            to: toEmail,
            subject: rendered.subject,
            html: rendered.bodyHtml,
            text: rendered.bodyText,
        });
        if (!brevoResult) {
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
                gmail_thread_id: null,
                to_email: toEmail,
                subject: rendered.subject,
                body_text: rendered.bodyText,
                missing_fields: missingFieldsRaw,
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
