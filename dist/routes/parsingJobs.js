"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const errorHandling_1 = require("../utils/errorHandling");
const parsingJobsService_1 = require("../services/parsingJobsService");
const router = (0, express_1.Router)();
router.get('/:id', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const svc = new parsingJobsService_1.ParsingJobsService();
    const job = await svc.getJob(id);
    if (!job)
        return res.status(404).json({ error: 'JOB_NOT_FOUND' });
    res.json({
        id: job.id,
        attachment_id: job.attachment_id,
        status: job.status,
        attempts: job.attempts,
        schema_version: job.schema_version,
        result: job.result_json ?? null,
        error_code: job.error_code ?? null,
        error_message: job.error_message ?? null,
        started_at: job.started_at ?? null,
        finished_at: job.finished_at ?? null,
        created_at: job.created_at,
        updated_at: job.updated_at,
    });
}));
router.get('/by-attachment/:attachmentId', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const { attachmentId } = req.params;
    const svc = new parsingJobsService_1.ParsingJobsService();
    const job = await svc.findLatestForAttachment(attachmentId);
    if (!job)
        return res.status(404).json({ error: 'JOB_NOT_FOUND' });
    res.json({
        id: job.id,
        attachment_id: job.attachment_id,
        status: job.status,
        attempts: job.attempts,
        schema_version: job.schema_version,
        result: job.result_json ?? null,
        error_code: job.error_code ?? null,
        error_message: job.error_message ?? null,
        started_at: job.started_at ?? null,
        finished_at: job.finished_at ?? null,
        created_at: job.created_at,
        updated_at: job.updated_at,
    });
}));
exports.default = router;
