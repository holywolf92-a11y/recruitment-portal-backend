"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const redis_1 = require("../config/redis");
const queue_1 = require("../config/queue");
const router = (0, express_1.Router)();
router.get('/queue', async (_req, res) => {
    try {
        const redisPing = await redis_1.redis.ping();
        const [cvCounts, docCounts, waMediaCounts, waVerifyCounts] = await Promise.all([
            queue_1.cvParsingQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
            queue_1.documentVerificationQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
            queue_1.whatsappMediaQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
            queue_1.whatsappAttachmentVerificationQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
        ]);
        const isOk = redisPing === 'PONG';
        return res.status(isOk ? 200 : 503).json({
            ok: isOk,
            redis: { ping: redisPing },
            // Backward compatible (older checks only look at this)
            queue: { name: queue_1.cvParsingQueue.name, counts: cvCounts },
            queues: [
                { name: queue_1.cvParsingQueue.name, counts: cvCounts },
                { name: queue_1.documentVerificationQueue.name, counts: docCounts },
                { name: queue_1.whatsappMediaQueue.name, counts: waMediaCounts },
                { name: queue_1.whatsappAttachmentVerificationQueue.name, counts: waVerifyCounts },
            ],
            workerExpected: Boolean(process.env.REDIS_URL && process.env.PYTHON_CV_PARSER_URL && process.env.PYTHON_HMAC_SECRET),
        });
    }
    catch (e) {
        return res.status(503).json({
            ok: false,
            error: e?.message ?? 'queue health failed',
        });
    }
});
exports.default = router;
