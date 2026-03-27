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
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailRouter = void 0;
const express_1 = __importStar(require("express"));
const database_1 = require("../config/database");
const emailService_1 = require("../services/emailService");
const emailReplyAuditService_1 = require("../services/emailReplyAuditService");
const errorHandling_1 = require("../utils/errorHandling");
const hostingerMailboxService_1 = require("../services/hostingerMailboxService");
const hostingerPollingWorker_1 = require("../workers/hostingerPollingWorker");
const publicUrl_1 = require("../utils/publicUrl");
exports.emailRouter = (0, express_1.Router)();
// Allow text/plain bodies (some clients send text/plain for JSON).
// This is scoped to the email routes to avoid impacting other middleware.
exports.emailRouter.use(express_1.default.text({ type: ['text/plain', 'text/*'], limit: '2mb' }));
function slugifyName(name) {
    if (!name)
        return 'candidate';
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'candidate';
}
function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function normalizeFieldSources(value) {
    if (!value || typeof value !== 'object')
        return [];
    return Object.entries(value)
        .map(([field, meta]) => {
        const data = meta && typeof meta === 'object' ? meta : {};
        return {
            field,
            source: String(data.source || ''),
            document_type: data.document_type ? String(data.document_type) : undefined,
            updated_at: data.updated_at ? String(data.updated_at) : undefined,
            updated_by: data.updated_by ? String(data.updated_by) : undefined,
        };
    })
        .filter((entry) => entry.source.length > 0);
}
async function getLastMatchedReplyRecord() {
    const db = (0, database_1.supabaseAdminClient)();
    const { data } = await db
        .from('email_reply_events')
        .select('id, candidate_id, subject, from_display, matched_by, received_at, provider_message_id, body_preview')
        .eq('provider', emailReplyAuditService_1.HOSTINGER_PROVIDER)
        .eq('match_status', 'matched')
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!data)
        return null;
    return {
        id: data.id,
        candidateId: data.candidate_id || null,
        subject: data.subject || null,
        from: data.from_display || null,
        matchedBy: data.matched_by || null,
        receivedAt: data.received_at || null,
        messageId: data.provider_message_id || null,
        bodyPreview: data.body_preview || null,
    };
}
async function getRecentHostingerPollingRuns(limit = 10) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data } = await db
        .from('hostinger_polling_runs')
        .select('id, trigger, status, worker_instance_id, started_at, completed_at, last_heartbeat_at, abandoned_at, duration_ms, unread_count_before, unread_count_after, messages_discovered, messages_processed, messages_matched, messages_unmatched, attachment_upload_success_count, attachment_upload_error_count, success_count, error_count, error_code, error_message')
        .eq('provider', emailReplyAuditService_1.HOSTINGER_PROVIDER)
        .order('started_at', { ascending: false })
        .limit(limit);
    return (data || []).map((row) => ({
        id: row.id,
        trigger: row.trigger || 'worker',
        status: row.status || 'completed',
        workerInstanceId: row.worker_instance_id || null,
        startedAt: row.started_at || null,
        completedAt: row.completed_at || null,
        lastHeartbeatAt: row.last_heartbeat_at || null,
        abandonedAt: row.abandoned_at || null,
        durationMs: row.duration_ms || null,
        unreadCountBefore: Number(row.unread_count_before || 0),
        unreadCountAfter: Number(row.unread_count_after || 0),
        messagesDiscovered: Number(row.messages_discovered || 0),
        messagesProcessed: Number(row.messages_processed || 0),
        messagesMatched: Number(row.messages_matched || 0),
        messagesUnmatched: Number(row.messages_unmatched || 0),
        attachmentUploadSuccessCount: Number(row.attachment_upload_success_count || 0),
        attachmentUploadErrorCount: Number(row.attachment_upload_error_count || 0),
        successCount: Number(row.success_count || 0),
        errorCount: Number(row.error_count || 0),
        errorCode: row.error_code || null,
        errorMessage: row.error_message || null,
    }));
}
async function getRecentMatchedReplies(limit = 10) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data } = await db
        .from('email_reply_events')
        .select('id, candidate_id, subject, from_display, matched_by, received_at, attachment_count, body_preview')
        .eq('provider', emailReplyAuditService_1.HOSTINGER_PROVIDER)
        .eq('match_status', 'matched')
        .order('received_at', { ascending: false })
        .limit(limit);
    const candidateIds = Array.from(new Set((data || []).map((row) => row.candidate_id).filter(Boolean)));
    let candidateMap = new Map();
    if (candidateIds.length > 0) {
        const { data: candidates } = await db
            .from('candidates')
            .select('id, name')
            .in('id', candidateIds);
        candidateMap = new Map((candidates || []).map((row) => [row.id, { name: row.name || null }]));
    }
    return (data || []).map((row) => ({
        id: row.id,
        candidateId: row.candidate_id || null,
        candidateName: candidateMap.get(row.candidate_id || '')?.name || null,
        subject: row.subject || null,
        from: row.from_display || null,
        matchedBy: row.matched_by || null,
        receivedAt: row.received_at || null,
        attachmentCount: Number(row.attachment_count || 0),
        bodyPreview: row.body_preview || null,
    }));
}
async function getRecentHostingerRunItems(limit = 20) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data } = await db
        .from('hostinger_polling_run_items')
        .select('id, run_id, provider_message_id, message_uid, candidate_id, matched_by, status, attachment_count, attachment_upload_success_count, attachment_upload_error_count, received_at, completed_at, error_code, error_message')
        .eq('provider', emailReplyAuditService_1.HOSTINGER_PROVIDER)
        .order('created_at', { ascending: false })
        .limit(limit);
    const candidateIds = Array.from(new Set((data || []).map((row) => row.candidate_id).filter(Boolean)));
    let candidateMap = new Map();
    if (candidateIds.length > 0) {
        const { data: candidates } = await db
            .from('candidates')
            .select('id, name')
            .in('id', candidateIds);
        candidateMap = new Map((candidates || []).map((row) => [row.id, { name: row.name || null }]));
    }
    return (data || []).map((row) => ({
        id: row.id,
        runId: row.run_id || null,
        providerMessageId: row.provider_message_id || null,
        messageUid: row.message_uid || null,
        candidateId: row.candidate_id || null,
        candidateName: candidateMap.get(row.candidate_id || '')?.name || null,
        matchedBy: row.matched_by || null,
        status: row.status || 'pending',
        attachmentCount: Number(row.attachment_count || 0),
        attachmentUploadSuccessCount: Number(row.attachment_upload_success_count || 0),
        attachmentUploadErrorCount: Number(row.attachment_upload_error_count || 0),
        receivedAt: row.received_at || null,
        completedAt: row.completed_at || null,
        errorCode: row.error_code || null,
        errorMessage: row.error_message || null,
    }));
}
async function buildCandidateReplyTrace(candidateId) {
    const db = (0, database_1.supabaseAdminClient)();
    const [{ data: candidate }, { data: sentMessages }, { data: replyMessages }, { data: documents }, { data: messageLog }] = await Promise.all([
        db
            .from('candidates')
            .select('id, name, email, email_tracking_token, field_sources, missing_data_email_last_sent_at, missing_data_email_last_reply_processed_at, updated_at')
            .eq('id', candidateId)
            .maybeSingle(),
        db
            .from('inbox_messages')
            .select('id, source, status, received_at, payload')
            .eq('source', 'email_outbound')
            .eq('payload->>candidateId', candidateId)
            .order('received_at', { ascending: true })
            .limit(50),
        db
            .from('email_reply_events')
            .select('id, provider, match_status, matched_by, attachment_count, provider_message_id, body_preview, body_text, received_at, from_display, subject, run_id, run_item_id, attachment_upload_error_count')
            .eq('candidate_id', candidateId)
            .order('received_at', { ascending: true })
            .limit(50),
        db
            .from('candidate_documents')
            .select('id, file_name, document_type, category, verification_status, created_at, source')
            .eq('candidate_id', candidateId)
            .eq('source', 'email')
            .order('created_at', { ascending: true })
            .limit(100),
        db
            .from('candidate_missing_data_email_log')
            .select('id, to_email, subject, body_text, missing_fields, missing_docs, attempt_no, trigger, sent_at, provider_message_id')
            .eq('candidate_id', candidateId)
            .order('sent_at', { ascending: true })
            .limit(50),
    ]);
    if (!candidate) {
        return null;
    }
    const candidateUpdates = normalizeFieldSources(candidate.field_sources)
        .filter((entry) => entry.source === 'manual' || entry.source === 'email_reply' || (entry.source === 'other' && entry.document_type === 'email_reply'))
        .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')))
        .map((entry) => ({
        field: entry.field,
        source: entry.source === 'other' && entry.document_type === 'email_reply' ? 'email_reply' : entry.source,
        updatedAt: entry.updated_at || null,
        updatedBy: entry.updated_by || null,
    }));
    return {
        candidate: {
            id: candidate.id,
            name: candidate.name || null,
            email: candidate.email || null,
            emailTrackingToken: candidate.email_tracking_token || null,
            lastSentAt: candidate.missing_data_email_last_sent_at || null,
            lastReplyProcessedAt: candidate.missing_data_email_last_reply_processed_at || null,
            updatedAt: candidate.updated_at || null,
        },
        sentMessages: (sentMessages || []).map((row) => ({
            id: row.id,
            source: row.source,
            status: row.status,
            sentAt: row.received_at,
            provider: row.payload?.provider || null,
            providerMessageId: row.payload?.providerMessageId || null,
            subject: row.payload?.subject || null,
            trigger: row.payload?.trigger || null,
            missingFields: row.payload?.missingFields || [],
            missingDocs: row.payload?.missingDocs || [],
        })),
        replyMessages: (replyMessages || []).map((row) => ({
            id: row.id,
            source: row.provider,
            status: row.match_status,
            receivedAt: row.received_at,
            subject: row.subject || null,
            from: row.from_display || null,
            matchedBy: row.matched_by || null,
            attachmentCount: Number(row.attachment_count || 0),
            messageId: row.provider_message_id || null,
            bodyPreview: row.body_preview || null,
            bodyText: row.body_text || null,
            runId: row.run_id || null,
            runItemId: row.run_item_id || null,
            attachmentUploadErrorCount: Number(row.attachment_upload_error_count || 0),
        })),
        documents: (documents || []).map((row) => ({
            id: row.id,
            fileName: row.file_name || null,
            documentType: row.document_type || row.category || null,
            category: row.category || null,
            verificationStatus: row.verification_status || null,
            createdAt: row.created_at || null,
            source: row.source || null,
        })),
        candidateUpdates,
        logEntries: (messageLog || []).map((row) => ({
            id: row.id,
            toEmail: row.to_email || null,
            subject: row.subject || null,
            attemptNo: row.attempt_no || null,
            trigger: row.trigger || null,
            sentAt: row.sent_at || null,
            providerMessageId: row.provider_message_id || null,
            missingFields: row.missing_fields || [],
            missingDocs: row.missing_docs || [],
        })),
    };
}
exports.emailRouter.get('/hostinger/status', (0, errorHandling_1.asyncHandler)(async (_req, res) => {
    const unreadCount = (0, hostingerMailboxService_1.isHostingerImapConfigured)() ? await (0, hostingerMailboxService_1.countUnreadHostingerMessages)() : 0;
    const [lastMatchedReply, polling, recentRuns, recentMatchedReplies, checkpoint, watchdog, recentRunItems] = await Promise.all([
        getLastMatchedReplyRecord(),
        (0, hostingerPollingWorker_1.getPersistentHostingerPollingState)(),
        getRecentHostingerPollingRuns(10),
        getRecentMatchedReplies(10),
        (0, emailReplyAuditService_1.getMailboxCheckpoint)(),
        (0, emailReplyAuditService_1.getWatchdogSummary)(parseInt(process.env.HOSTINGER_POLL_STALE_AFTER_MS || '900000', 10)),
        getRecentHostingerRunItems(20),
    ]);
    if (lastMatchedReply) {
        polling.lastMatchedReply = {
            candidateId: lastMatchedReply.candidateId || '',
            messageId: lastMatchedReply.messageId || '',
            subject: lastMatchedReply.subject || '',
            from: lastMatchedReply.from || '',
            matchedBy: lastMatchedReply.matchedBy || 'unknown',
            receivedAt: lastMatchedReply.receivedAt || '',
        };
    }
    return res.json({
        configured: (0, hostingerMailboxService_1.isHostingerImapConfigured)(),
        enabled: (0, hostingerPollingWorker_1.isHostingerPollingEnabled)(),
        schedulerActive: (0, hostingerPollingWorker_1.isHostingerPollingSchedulerActive)(),
        polling,
        unreadCount,
        checkpoint,
        watchdog,
        lastMatchedReply,
        recentRuns,
        recentRunItems,
        recentMatchedReplies,
    });
}));
exports.emailRouter.post('/hostinger/poll', (0, errorHandling_1.asyncHandler)(async (_req, res) => {
    const result = await (0, hostingerPollingWorker_1.triggerHostingerManualPoll)();
    return res.json({
        ok: true,
        result,
        polling: await (0, hostingerPollingWorker_1.getPersistentHostingerPollingState)(),
    });
}));
exports.emailRouter.get('/reply-trace/:candidateId', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const candidateId = String(req.params.candidateId || '').trim();
    if (!isUuid(candidateId)) {
        return res.status(400).json({ error: 'Invalid candidateId format (expected UUID)' });
    }
    const trace = await buildCandidateReplyTrace(candidateId);
    if (!trace) {
        return res.status(404).json({ error: 'Candidate not found' });
    }
    return res.json(trace);
}));
/**
 * Test Hostinger SMTP configuration
 * POST /api/email/test-email
 */
exports.emailRouter.post('/test-email', async (req, res) => {
    try {
        const parsedBody = (() => {
            if (typeof req.body === 'string') {
                try {
                    return JSON.parse(req.body);
                }
                catch {
                    return {};
                }
            }
            return req.body || {};
        })();
        const to = parsedBody.to || req.query.to;
        const subject = parsedBody.subject || 'Hostinger SMTP test email';
        const message = parsedBody.message || 'This is a test email from Falisha Jobs (support@falishajobs.com).';
        if (!to) {
            return res.status(400).json({ error: 'Please provide a recipient email via body.to or query ?to=' });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(to)) {
            return res.status(400).json({ error: 'Please provide a valid recipient email address' });
        }
        await emailService_1.emailService.sendEmail({
            to,
            subject,
            text: message,
            html: `<p>${message}</p>`,
        });
        return res.json({
            success: true,
            mode: process.env.RESEND_API_KEY ? 'resend' : 'hostinger-smtp',
            message: process.env.RESEND_API_KEY
                ? 'Test email sent successfully via Resend'
                : 'Test email sent successfully via Hostinger SMTP',
        });
    }
    catch (error) {
        return res.status(500).json({
            error: error?.message || 'Failed to send test email',
            mode: process.env.RESEND_API_KEY ? 'resend' : 'hostinger-smtp',
        });
    }
});
/**
 * Send candidate profiles to employer via email
 * POST /api/email/send-to-employer
 */
exports.emailRouter.post('/send-to-employer', async (req, res) => {
    try {
        // Accept bodies that may arrive as strings (e.g., if any upstream middleware leaves raw text)
        const parsedBody = (() => {
            if (typeof req.body === 'string') {
                try {
                    return JSON.parse(req.body);
                }
                catch (err) {
                    console.warn('[EmailRouter] Failed to parse string body as JSON', err);
                    return {};
                }
            }
            return req.body || {};
        })();
        console.log('\n\n========== EMAIL ROUTE HANDLER ==========');
        console.log('[EmailRouter] Full req.body:', JSON.stringify(parsedBody, null, 2));
        console.log('[EmailRouter] req.body type:', typeof parsedBody);
        console.log('[EmailRouter] req.body constructor:', parsedBody?.constructor?.name);
        console.log('[EmailRouter] req.body keys:', Object.keys(parsedBody || {}));
        const { candidateIds, employerEmail, employerId, message } = parsedBody;
        console.log('[EmailRouter] After destructuring:');
        console.log('[EmailRouter]   candidateIds:', candidateIds);
        console.log('[EmailRouter]   candidateIds type:', typeof candidateIds);
        console.log('[EmailRouter]   candidateIds is array?:', Array.isArray(candidateIds));
        console.log('[EmailRouter]   candidateIds length:', candidateIds?.length);
        console.log('[EmailRouter]   employerEmail:', employerEmail);
        console.log('[EmailRouter]   employerId:', employerId);
        console.log('[EmailRouter]   message:', message);
        console.log('========================================\n');
        // Validation
        if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
            console.log('[EmailRouter] ❌ VALIDATION FAILED');
            console.log('[EmailRouter] Reason:', {
                candidateIdsExists: !!candidateIds,
                isArray: Array.isArray(candidateIds),
                length: candidateIds?.length
            });
            return res.status(400).json({ error: 'Please provide at least one candidate ID' });
        }
        console.log('[EmailRouter] ✅ VALIDATION PASSED - ', candidateIds.length, 'candidates');
        // Get employer email (from direct input or by looking up employer ID)
        let targetEmail = employerEmail;
        if (!targetEmail && employerId) {
            const supabase = (0, database_1.supabaseAdminClient)();
            const { data: employer, error: employerError } = await supabase
                .from('employers')
                .select('email')
                .eq('id', employerId)
                .single();
            if (employerError) {
                console.error('[EmailRouter] Error fetching employer:', employerError);
                return res.status(500).json({ error: 'Failed to fetch employer details' });
            }
            if (!employer?.email) {
                return res.status(400).json({ error: 'Selected employer has no email address. Please enter manually.' });
            }
            targetEmail = employer.email;
        }
        if (!targetEmail) {
            return res.status(400).json({ error: 'Please provide employer email address' });
        }
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(targetEmail)) {
            return res.status(400).json({ error: 'Please provide a valid email address' });
        }
        // Fetch candidate details
        const supabase = (0, database_1.supabaseAdminClient)();
        const { data: candidates, error: fetchError } = await supabase
            .from('candidates')
            .select('id, name, position, date_of_birth, nationality')
            .in('id', candidateIds);
        if (fetchError) {
            console.error('[EmailRouter] Error fetching candidates:', fetchError);
            return res.status(500).json({ error: 'Failed to fetch candidate data' });
        }
        if (!candidates || candidates.length === 0) {
            return res.status(404).json({ error: 'No candidates found with provided IDs' });
        }
        // Calculate age helper
        const calculateAge = (dateOfBirth) => {
            if (!dateOfBirth)
                return undefined;
            try {
                const birthDate = new Date(dateOfBirth);
                const today = new Date();
                let age = today.getFullYear() - birthDate.getFullYear();
                const monthDiff = today.getMonth() - birthDate.getMonth();
                if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                    age--;
                }
                return age;
            }
            catch {
                return undefined;
            }
        };
        // Detect primary position (most common position among selected candidates)
        const positionCounts = {};
        candidates.forEach(c => {
            if (c.position) {
                positionCounts[c.position] = (positionCounts[c.position] || 0) + 1;
            }
        });
        let primaryPosition;
        let maxCount = 0;
        Object.entries(positionCounts).forEach(([pos, count]) => {
            if (count > maxCount) {
                maxCount = count;
                primaryPosition = pos;
            }
        });
        // Build candidate data for email
        const frontendUrl = (0, publicUrl_1.resolveFrontendUrl)(process.env.FRONTEND_URL);
        const apiBaseUrl = (0, publicUrl_1.resolveBackendApiBaseUrl)(process.env.BACKEND_URL);
        const candidateData = candidates.map(candidate => ({
            id: candidate.id,
            name: candidate.name || 'Unknown',
            age: calculateAge(candidate.date_of_birth),
            nationality: candidate.nationality,
            position: candidate.position,
            profileLink: `${frontendUrl}/profile/${candidate.id}/${slugifyName(candidate.name)}`,
            cvDownloadLink: `${apiBaseUrl}/cv-generator/${candidate.id}/download?format=employer-safe&force=true`,
        }));
        // Send email
        await emailService_1.emailService.sendCandidateProfilesToEmployer({
            employerEmail: targetEmail,
            candidates: candidateData,
            position: primaryPosition,
            message,
        });
        console.log(`[EmailRouter] Successfully sent ${candidates.length} candidate profiles to ${targetEmail}`);
        return res.status(200).json({
            success: true,
            message: `Email sent successfully to ${targetEmail}`,
            candidateCount: candidates.length,
        });
    }
    catch (error) {
        console.error('[EmailRouter] Error sending email:', error);
        return res.status(500).json({
            error: error.message || 'Failed to send email. Please try again.'
        });
    }
});
/**
 * Get list of employers (for dropdown selection)
 * GET /api/email/employers
 */
exports.emailRouter.get('/employers', async (req, res) => {
    try {
        const supabase = (0, database_1.supabaseAdminClient)();
        const { data: employers, error } = await supabase
            .from('employers')
            .select('id, company_name, email')
            .order('company_name', { ascending: true });
        if (error) {
            console.error('[EmailRouter] Error fetching employers:', error);
            return res.status(500).json({ error: 'Failed to fetch employers' });
        }
        return res.status(200).json({
            success: true,
            employers: employers || []
        });
    }
    catch (error) {
        console.error('[EmailRouter] Error fetching employers:', error);
        return res.status(500).json({ error: 'Failed to fetch employers' });
    }
});
/**
 * Manually trigger missing-documents email to one or all candidates.
 *
 * POST /api/email/send-missing-docs
 * Body (single):  { candidateId: string, force?: boolean }
 * Body (bulk):    { all: true, force?: boolean }
 *
 * Returns: { sent, skipped, errors, details[] }
 */
exports.emailRouter.post('/send-missing-docs', async (req, res) => {
    try {
        const body = typeof req.body === 'string' ? (() => { try {
            return JSON.parse(req.body);
        }
        catch {
            return {};
        } })() : (req.body || {});
        const force = !!body.force;
        const { maybeSendMissingDataEmail } = await Promise.resolve().then(() => __importStar(require('../services/missingDataEmailService')));
        // ── Single candidate ─────────────────────────────────────────────────────
        if (body.candidateId) {
            const { candidateId } = body;
            const emailIdRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!emailIdRegex.test(candidateId)) {
                return res.status(400).json({ error: 'Invalid candidateId format (expected UUID)' });
            }
            const result = await maybeSendMissingDataEmail({ candidateId, trigger: 'manual_admin', force });
            return res.json({
                sent: result.sent ? 1 : 0,
                skipped: result.sent ? 0 : 1,
                errors: 0,
                details: [{ candidateId, ...result }],
            });
        }
        // ── Bulk: all eligible candidates ────────────────────────────────────────
        if (body.all === true) {
            const db = (0, database_1.supabaseAdminClient)();
            const { data: candidates, error: dbError } = await db
                .from('candidates')
                .select('id')
                .not('email', 'is', null)
                .not('missing_data_email_status', 'in', '("stopped","completed")');
            if (dbError) {
                console.error('[EmailRouter] send-missing-docs bulk query failed:', dbError);
                return res.status(500).json({ error: 'Failed to fetch candidates', detail: dbError.message });
            }
            let sent = 0, skipped = 0, errors = 0;
            const details = [];
            for (const candidate of (candidates || [])) {
                try {
                    const result = await maybeSendMissingDataEmail({
                        candidateId: candidate.id,
                        trigger: 'manual_admin',
                        force,
                    });
                    if (result.sent) {
                        sent++;
                        details.push({ candidateId: candidate.id, sent: true });
                    }
                    else {
                        skipped++;
                        details.push({ candidateId: candidate.id, sent: false, reason: result.reason });
                    }
                }
                catch (err) {
                    errors++;
                    details.push({ candidateId: candidate.id, error: err?.message || 'Unknown error' });
                    console.error('[EmailRouter] send-missing-docs error for', candidate.id, err);
                }
            }
            console.log(`[EmailRouter] send-missing-docs bulk: sent=${sent} skipped=${skipped} errors=${errors}`);
            return res.json({ sent, skipped, errors, details });
        }
        return res.status(400).json({ error: 'Provide either candidateId (string) or all: true in request body' });
    }
    catch (error) {
        console.error('[EmailRouter] send-missing-docs error:', error);
        return res.status(500).json({ error: error?.message || 'Internal server error' });
    }
});
