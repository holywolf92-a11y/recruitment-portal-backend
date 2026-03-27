"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const errorHandling_1 = require("../utils/errorHandling");
const inboxService_1 = require("../services/inboxService");
const inboxAttachmentService_1 = require("../services/inboxAttachmentService");
const queue_1 = require("../config/queue");
const parsingJobsService_1 = require("../services/parsingJobsService");
const router = (0, express_1.Router)();
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
