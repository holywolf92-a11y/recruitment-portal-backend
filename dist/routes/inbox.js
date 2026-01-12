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
    res.status(201).json(attachment);
}));
router.delete('/attachments/:attachmentId', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const deleted = await (0, inboxAttachmentService_1.deleteAttachment)(req.params.attachmentId);
    res.json(deleted);
}));
// Trigger parsing job for an attachment
router.post('/attachments/:attachmentId/process', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const { attachmentId } = req.params;
    const parsingJobs = new parsingJobsService_1.ParsingJobsService();
    // 1) Get attachment and generate signed URL
    const attachment = await (0, inboxAttachmentService_1.getAttachmentById)(attachmentId);
    const signedUrl = await (0, inboxAttachmentService_1.getAttachmentSignedUrl)(attachmentId, 300);
    const fileHash = attachment?.sha256 ?? null;
    // 2) Idempotency: if same attachment+hash already extracted, reuse job
    if (fileHash) {
        const existing = await parsingJobs.findLatestExtractedForAttachment(attachmentId, fileHash);
        if (existing) {
            return res.json({ job_id: existing.id, status: 'extracted', reused: true });
        }
    }
    // 3) Create parsing job row
    const jobRow = await parsingJobs.createJob({ attachmentId, fileHash });
    // 4) Enqueue BullMQ job
    await queue_1.cvParsingQueue.add('parse', {
        jobId: jobRow.id,
        attachmentId,
        fileUrl: signedUrl,
        fileHash,
    }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 200,
        removeOnFail: 200,
    });
    res.status(202).json({ job_id: jobRow.id, status: 'queued' });
}));
exports.default = router;
