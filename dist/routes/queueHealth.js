"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const redis_1 = require("../config/redis");
const queue_1 = require("../config/queue");
const router = (0, express_1.Router)();
router.get('/queue', async (_req, res) => {
    try {
        const redisPing = await redis_1.redis.ping();
        const counts = await queue_1.cvParsingQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        const isOk = redisPing === 'PONG';
        return res.status(isOk ? 200 : 503).json({
            ok: isOk,
            redis: { ping: redisPing },
            queue: { name: queue_1.cvParsingQueue.name, counts },
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
