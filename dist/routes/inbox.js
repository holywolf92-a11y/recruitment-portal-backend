"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const errorHandling_1 = require("../utils/errorHandling");
const database_1 = require("../config/database");
const inboxService_1 = require("../services/inboxService");
const inboxAttachmentService_1 = require("../services/inboxAttachmentService");
const queue_1 = require("../config/queue");
const parsingJobsService_1 = require("../services/parsingJobsService");
const router = (0, express_1.Router)();
function firstNonEmptyString(...values) {
    for (const value of values) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed)
                return trimmed;
        }
    }
    return null;
}
function extractSenderName(payload) {
    return firstNonEmptyString(payload?.sender_name, payload?.profile?.name, payload?.raw?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name, payload?.raw?.contacts?.[0]?.profile?.name);
}
function extractSenderContact(payload, source) {
    const direct = firstNonEmptyString(payload?.sender_contact, payload?.effectiveFrom, payload?.from, payload?.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from, payload?.raw?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id, payload?.raw?.contacts?.[0]?.wa_id);
    if (direct)
        return direct;
    if (source === 'gmail' || source === 'email' || source === 'hostinger-imap') {
        const fromRaw = firstNonEmptyString(payload?.from, payload?.sender_contact);
        if (!fromRaw)
            return null;
        const match = fromRaw.match(/<([^>]+)>/) || fromRaw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
        return match?.[1] || match?.[0] || null;
    }
    return null;
}
function isWhatsAppLikeSource(source) {
    return source === 'whatsapp' || source === 'WhatsApp' || source === 'whatsapp_backfill_pdf';
}
function isForwardedWhatsAppPayload(payload) {
    return payload?.context?.forwarded === true ||
        payload?.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.context?.forwarded === true ||
        payload?.raw?.messages?.[0]?.context?.forwarded === true;
}
function parseJobOutput(job) {
    const raw = job?.output ?? job?.result_json ?? null;
    if (!raw)
        return null;
    if (typeof raw === 'object')
        return raw;
    if (typeof raw !== 'string')
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function humanizeSkippedReason(skippedReason) {
    switch (skippedReason) {
        case 'insufficient_candidate_signals':
            return 'Insufficient identity signals in the CV';
        case 'candidate_creation_failed':
            return 'Candidate was not created automatically. Manual review is required.';
        case 'duplicate_file_hash':
            return 'Duplicate CV file already linked to an existing candidate';
        case 'already_linked':
            return 'Already linked to an existing candidate';
        case 'pre_2024_cutoff':
            return 'Historical pre-2024 email import skipped by policy';
        case 'non_cv_attachment':
            return 'Attachment is not a CV';
        default:
            return skippedReason.replace(/_/g, ' ');
    }
}
function deriveSenderContactNote(payload, source) {
    if (isWhatsAppLikeSource(source)) {
        return isForwardedWhatsAppPayload(payload)
            ? 'Sender WhatsApp number only. Forwarded message; not the candidate phone.'
            : 'Sender WhatsApp number only. Not stored as the candidate phone.';
    }
    if (source === 'gmail' || source === 'email' || source === 'hostinger-imap') {
        return 'Sender email only.';
    }
    return null;
}
function deriveReviewReason(args) {
    const { status, source, payload, job, hasCandidate } = args;
    if (hasCandidate) {
        return 'Candidate created and linked';
    }
    if (status === 'queued') {
        return 'Waiting to be parsed';
    }
    if (status === 'processing') {
        return 'Parsing in progress';
    }
    if (status === 'error') {
        return firstNonEmptyString(job?.error_message, 'Parsing failed') || 'Parsing failed';
    }
    const jobOutput = parseJobOutput(job);
    const skippedReason = firstNonEmptyString(jobOutput?.skipped_reason, job?.skipped_reason);
    if (skippedReason) {
        return humanizeSkippedReason(skippedReason);
    }
    if (isWhatsAppLikeSource(source) && isForwardedWhatsAppPayload(payload)) {
        return 'Forwarded WhatsApp CV. Sender contact below belongs to the sender, not the candidate.';
    }
    if (/duplicate/i.test(String(job?.error_message || ''))) {
        return 'Possible duplicate candidate or duplicate CV. Manual review required.';
    }
    if (isWhatsAppLikeSource(source)) {
        return 'No safe auto-link from WhatsApp. Review candidate identity manually.';
    }
    return 'Candidate was not created or auto-linked. Review identity details manually.';
}
// GET /cv-inbox/stats — accurate summary counts (2 DB queries, not N queries)
router.get('/stats', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const since = req.query.since;
    const db = (0, database_1.supabaseAdminClient)();
    // Total CV attachments
        // Include legacy `attachment_type=cv`, new `attachment_kind=cv` (WhatsApp flow often uses attachment_type=document)
        // and any explicitly defused/flagged rows (`parsing_status=needs_review`) so they show up for manual cleanup.
        let totalQ = db
            .from('inbox_attachments')
            .select('id', { count: 'exact', head: true })
            .or('attachment_kind.eq.cv,attachment_type.eq.cv,attachment_type.is.null,parsing_status.eq.needs_review');
    if (since)
        totalQ = totalQ.gte('created_at', since);
    const { count: total } = await totalQ;
    // Extracted (candidate linked)
        let extractedQ = db
            .from('inbox_attachments')
            .select('id', { count: 'exact', head: true })
            .or('attachment_kind.eq.cv,attachment_type.eq.cv,attachment_type.is.null,parsing_status.eq.needs_review')
            .not('candidate_id', 'is', null);
    if (since)
        extractedQ = extractedQ.gte('created_at', since);
    const { count: extracted } = await extractedQ;
    // linked_candidate_id extracted (WhatsApp flow)
        let linkedQ = db
            .from('inbox_attachments')
            .select('id', { count: 'exact', head: true })
            .or('attachment_kind.eq.cv,attachment_type.eq.cv,attachment_type.is.null,parsing_status.eq.needs_review')
            .is('candidate_id', null)
            .not('linked_candidate_id', 'is', null);
    if (since)
        linkedQ = linkedQ.gte('created_at', since);
    const { count: linked } = await linkedQ;
    const extractedTotal = (extracted ?? 0) + (linked ?? 0);
    const pending = (total ?? 0) - extractedTotal;
    // needs_review = parsing succeeded but no candidate could be created/linked
        let needsReviewQ = db
            .from('inbox_attachments')
            .select('id', { count: 'exact', head: true })
            .or('attachment_kind.eq.cv,attachment_type.eq.cv,attachment_type.is.null,parsing_status.eq.needs_review')
            .is('candidate_id', null)
            .is('linked_candidate_id', null)
            .in('parsing_status', ['needs_review', 'extracted']);
    if (since)
        needsReviewQ = needsReviewQ.gte('created_at', since);
    const { count: needsReview } = await needsReviewQ;
    res.json({
        total: total ?? 0,
        extracted: extractedTotal,
        pending,
        needs_review: needsReview ?? 0,
    });
}));
// GET /cv-inbox/items — efficient single-page fetch (replaces N+1 calls from UI)
// Returns inbox_attachments joined with message info + latest parsing_job status in 2 queries
router.get('/items', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 300);
    const offset = parseInt(req.query.offset || '0', 10);
    const since = req.query.since;
    const source = req.query.source;
    const db = (0, database_1.supabaseAdminClient)();
    // Query 1: inbox_attachments + joined message info
          let query = db
                .from('inbox_attachments')
                .select(`id, file_name, mime_type, attachment_type, parsing_status,
            candidate_id, linked_candidate_id, inbox_message_id, created_at,
            inbox_messages(source, received_at, status, payload)`, { count: 'exact' })
                .or('attachment_kind.eq.cv,attachment_type.eq.cv,attachment_type.is.null,parsing_status.eq.needs_review')
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);
    if (since)
        query = query.gte('created_at', since);
    const { data, error, count } = await query;
    if (error)
        throw new Error(error.message);
    const rows = data || [];
    const attachmentIds = rows.map((r) => r.id);
    // Query 2: latest parsing job per attachment (one batch query, not N)
    const jobMap = {};
    if (attachmentIds.length > 0) {
        const { data: jobs } = await db
            .from('parsing_jobs')
            .select('*')
            .or(`inbox_attachment_id.in.(${attachmentIds.join(',')}),attachment_id.in.(${attachmentIds.join(',')})`)
            .order('created_at', { ascending: false });
        for (const j of jobs || []) {
            const aid = j.inbox_attachment_id || j.attachment_id;
            if (aid && !jobMap[aid]) {
                jobMap[aid] = { id: j.id, status: j.status, error_message: j.error_message };
            }
        }
    }
    const items = rows
        // Optional source filter (applied in JS since nested resource filter varies by PG version)
        .filter((r) => !source || r.inbox_messages?.source === source)
        .map((r) => {
        const msg = r.inbox_messages;
        const payload = msg?.payload || {};
        const job = jobMap[r.id];
        const resolvedCandidateId = r.candidate_id || r.linked_candidate_id;
        let status;
        if (resolvedCandidateId) {
            status = 'extracted';
        }
        else if (r.parsing_status === 'needs_review') {
            // Explicitly flagged by the worker — no candidate signals or creation failed
            status = 'needs_review';
        }
        else if (r.parsing_status === 'extracted') {
            // Parsing ran and finished but no candidate was ever linked — stuck, needs human
            status = 'needs_review';
        }
        else if (!job) {
            status = 'queued';
        }
        else if (job.status === 'extracted') {
            // Job finished but attachment has no candidate — also needs review
            status = 'needs_review';
        }
        else if (job.status === 'failed') {
            status = 'error';
        }
        else {
            status = job.status; // 'processing' | 'queued'
        }
        return {
            id: r.id,
            messageId: r.inbox_message_id,
            fileName: r.file_name || 'Attachment',
            mimeType: r.mime_type,
            candidateId: resolvedCandidateId || null,
            candidateCreated: !!resolvedCandidateId,
            jobId: job?.id || null,
            jobStatus: job?.status || null,
            jobError: job?.error_message || null,
            status,
            reviewReason: deriveReviewReason({
                status,
                source: msg?.source,
                payload,
                job,
                hasCandidate: !!resolvedCandidateId,
            }),
            source: msg?.source || 'unknown',
            receivedAt: msg?.received_at || r.created_at,
            senderName: extractSenderName(payload),
            senderContact: extractSenderContact(payload, msg?.source),
            senderContactNote: deriveSenderContactNote(payload, msg?.source),
        };
    });
    res.json({ items, total: count ?? 0, limit, offset });
}));
router.get('/', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const { source, status, limit, offset } = req.query;
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? parseInt(offset, 10) : undefined;
    const result = await (0, inboxService_1.listInboxMessages)({
        source: source,
        status: status,
        limit: parsedLimit,
        offset: parsedOffset,
    });
    res.json(result);
}));
router.get('/:id', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const message = await (0, inboxService_1.getInboxMessageById)(req.params.id);
    res.json(message);
}));
router.post('/', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const { source, external_message_id, payload, status, received_at } = req.body ?? {};
    const message = await (0, inboxService_1.createInboxMessage)({
        source,
        externalMessageId: external_message_id,
        payload,
        status,
        receivedAt: received_at,
    });
    res.status(201).json(message);
}));
router.patch('/:id', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const updated = await (0, inboxService_1.updateInboxMessage)(req.params.id, {
        status: req.body?.status,
        payload: req.body?.payload,
    });
    res.json(updated);
}));
router.delete('/:id', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const deleted = await (0, inboxService_1.deleteInboxMessage)(req.params.id);
    res.json(deleted);
}));
router.get('/:id/attachments', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const attachments = await (0, inboxAttachmentService_1.listAttachmentsForMessage)(req.params.id);
    res.json(attachments);
}));
router.post('/:id/attachments', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const { file_name, mime_type, storage_bucket, storage_path, attachment_type, candidate_id, file_base64 } = req.body ?? {};
    if (!file_base64) {
        return res.status(400).json({ error: 'file_base64 is required' });
    }
    const buffer = Buffer.from(file_base64, 'base64');
    const attachment = await (0, inboxAttachmentService_1.createAttachment)({
        inboxMessageId: req.params.id,
        fileBuffer: buffer,
        fileName: file_name,
        mimeType: mime_type,
        attachmentType: attachment_type,
        storageBucket: storage_bucket,
        storagePath: storage_path,
        candidateId: candidate_id,
    });
    const shouldEnqueue = attachment?.attachment_kind === 'cv';
    let jobInfo = null;
    if (shouldEnqueue) {
        try {
            jobInfo = await (0, inboxAttachmentService_1.enqueueCvParsingJobForAttachment)(attachment.id, { force: false, expiresInSeconds: 3600 });
        }
        catch (enqueueErr) {
            console.error(`[InboxAttachment] Failed to enqueue CV parsing for ${attachment.id}:`, enqueueErr);
            // Don't fail the upload - file is saved, user can retry parsing later
            jobInfo = null;
        }
    }
    res.status(200).json({
        attachment,
        job_id: jobInfo?.jobId ?? null,
        status: jobInfo?.status ?? null,
    });
}));
router.delete('/attachments/:attachmentId', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const deleted = await (0, inboxAttachmentService_1.deleteAttachment)(req.params.attachmentId);
    res.json(deleted);
}));
// Download attachment: return signed URL redirect so the file is served directly
// from Supabase, not proxied through Railway (avoids egress charges).
router.get('/:messageId/attachments/:attachmentId/download', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const attachment = await (0, inboxAttachmentService_1.getAttachmentById)(req.params.attachmentId);
    if (!attachment || !attachment.storage_path) {
        return res.status(404).json({ error: 'Attachment not found' });
    }
    const { supabaseAdminClient } = require('../config/database');
    const db = supabaseAdminClient();
    const bucket = attachment.storage_bucket || 'documents';
    const { data, error } = await db.storage.from(bucket).createSignedUrl(attachment.storage_path, 300);
    if (error || !data?.signedUrl) {
        return res.status(500).json({ error: 'Failed to generate download URL' });
    }
    // 302 redirect — browser downloads directly from Supabase, zero Railway egress
    return res.redirect(302, data.signedUrl);
}));
// Trigger parsing job for an attachment
router.post('/attachments/:attachmentId/process', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const { attachmentId } = req.params;
    // Validate attachmentId is a valid UUID
    if (!attachmentId || attachmentId === 'undefined' || attachmentId === 'null') {
        console.error(`[AttachmentProcess] Invalid attachmentId received: ${attachmentId}`);
        return res.status(400).json({
            error: 'Invalid attachment ID',
            message: 'Attachment ID must be a valid UUID'
        });
    }
    const force = String(req.query?.force ?? '').toLowerCase() === 'true' || String(req.query?.force ?? '') === '1';
    console.log(`[AttachmentProcess] Starting for attachmentId=${attachmentId}`);
    const parsingJobs = new parsingJobsService_1.ParsingJobsService();
    let jobRow = null;
    try {
        // 1) Get attachment and generate signed URL
        console.log(`[AttachmentProcess] Fetching attachment ${attachmentId}...`);
        const attachment = await (0, inboxAttachmentService_1.getAttachmentById)(attachmentId);
        console.log(`[AttachmentProcess] Got attachment, creating job...`);
        const fileHash = attachment?.sha256 ?? null;
        // 2) Idempotency: if same attachment+hash already extracted, reuse job (unless forced)
        if (!force && fileHash) {
            console.log(`[AttachmentProcess] Checking for existing job with hash...`);
            const existing = await parsingJobs.findLatestExtractedForAttachment(attachmentId, fileHash);
            if (existing) {
                console.log(`[AttachmentProcess] Found existing job: ${existing.id}`);
                return res.json({ job_id: existing.id, status: 'extracted', reused: true });
            }
        }
        // 3) Create parsing job row
        console.log(`[AttachmentProcess] Creating new parsing job...`);
        const createdJobRow = await parsingJobs.createJob({ attachmentId, fileHash });
        jobRow = createdJobRow;
        console.log(`[AttachmentProcess] Created job: ${createdJobRow.id}`);
        // 4) Enqueue BullMQ job
        console.log(`[AttachmentProcess] Enqueueing to BullMQ...`);
        await queue_1.cvParsingQueue.add('parse', {
            jobId: createdJobRow.id,
            attachmentId,
            fileHash,
            force,
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 200,
            removeOnFail: 200,
        });
        console.log(`[AttachmentProcess] Successfully queued job`);
        res.status(202).json({ job_id: createdJobRow.id, status: 'queued' });
    }
    catch (err) {
        // If we created the DB job but couldn't enqueue (e.g. Redis down), mark it failed
        // so the UI doesn't remain stuck on "Queued" forever.
        if (jobRow?.id) {
            try {
                await parsingJobs.setStatus(jobRow.id, 'failed', {
                    result_json: {
                        error: 'QUEUE_ENQUEUE_FAILED',
                        message: err instanceof Error ? err.message : String(err),
                    },
                });
            }
            catch {
                // Best-effort only; original error still handled by asyncHandler.
            }
        }
        console.error(`[AttachmentProcess] Error:`, err instanceof Error ? err.message : String(err), err);
        throw err; // Let asyncHandler deal with it
    }
}));
// Retry parsing job for an attachment (re-enqueue)
router.post('/attachments/:attachmentId/retry', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const { attachmentId } = req.params;
    const jobInfo = await (0, inboxAttachmentService_1.enqueueCvParsingJobForAttachment)(attachmentId, {
        force: true,
        expiresInSeconds: 3600,
    });
    res.status(202).json({ job_id: jobInfo.jobId, status: jobInfo.status });
}));
exports.default = router;
