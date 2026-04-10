"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const queue_1 = require("../config/queue");
const router = (0, express_1.Router)();
const QUEUE_HEALTH_CACHE_TTL_MS = Number(process.env.QUEUE_HEALTH_CACHE_TTL_MS || 60000);
let queueHealthCache = null;
/** Ping Redis via Upstash REST (HTTPS/443) — avoids TCP port 6380 which may be blocked. */
async function pingRedis() {
    const restUrl = process.env.UPSTASH_REDIS_REST_URL;
    const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (restUrl && restToken) {
        try {
            const res = await fetch(`${restUrl}/ping`, {
                headers: { Authorization: `Bearer ${restToken}` },
                signal: AbortSignal.timeout(5000),
            });
            const data = await res.json();
            return { ok: data.result === 'PONG', method: 'rest' };
        }
        catch {
            return { ok: false, method: 'rest' };
        }
    }
    return { ok: false, method: 'none' };
}
const EMPTY_COUNTS = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
async function safeJobCounts(q) {
    try {
        // Race against a 3 s timeout so the health endpoint doesn't hang on Redis TCP issues
        return await Promise.race([
            q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
            new Promise((resolve) => setTimeout(() => resolve(EMPTY_COUNTS), 3000)),
        ]);
    }
    catch {
        return EMPTY_COUNTS;
    }
}
router.get('/queue', async (_req, res) => {
    // When BullMQ workers are disabled, skip all Redis/Queue interaction entirely.
    // Calling safeJobCounts() would instantiate 4 BullMQ Queue objects, each opening
    // 2 persistent IORedis connections (8 total) that send PING keepalives every ~5 s
    // => ~138K+ commands/day on Upstash for nothing.
    if (process.env.RUN_WORKER !== 'true') {
        return res.status(200).json({
            ok: true,
            cached: false,
            redis: { ping: 'SKIPPED', method: 'none' },
            queue: { name: 'cv-parsing', counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 } },
            queues: [],
            workerMode: false,
            message: 'BullMQ workers disabled — Redis not connected',
        });
    }
    try {
        if (queueHealthCache && queueHealthCache.expiresAt > Date.now()) {
            return res.status(queueHealthCache.statusCode).json({
                ...queueHealthCache.payload,
                cached: true,
            });
        }
        const redisPing = await pingRedis();
        const [cvCounts, docCounts, waMediaCounts, waVerifyCounts] = await Promise.all([
            safeJobCounts(queue_1.cvParsingQueue),
            safeJobCounts(queue_1.documentVerificationQueue),
            safeJobCounts(queue_1.whatsappMediaQueue),
            safeJobCounts(queue_1.whatsappAttachmentVerificationQueue),
        ]);
        const isOk = redisPing.ok;
        const payload = {
            ok: isOk,
            cached: false,
            redis: { ping: isOk ? 'PONG' : 'FAILED', method: redisPing.method },
            queue: { name: queue_1.cvParsingQueue.name, counts: cvCounts },
            queues: [
                { name: queue_1.cvParsingQueue.name, counts: cvCounts },
                { name: queue_1.documentVerificationQueue.name, counts: docCounts },
                { name: queue_1.whatsappMediaQueue.name, counts: waMediaCounts },
                { name: queue_1.whatsappAttachmentVerificationQueue.name, counts: waVerifyCounts },
            ],
            workerExpected: Boolean(process.env.REDIS_URL && process.env.PYTHON_CV_PARSER_URL && process.env.PYTHON_HMAC_SECRET),
        };
        const statusCode = isOk ? 200 : 503;
        queueHealthCache = {
            expiresAt: Date.now() + QUEUE_HEALTH_CACHE_TTL_MS,
            payload,
            statusCode,
        };
        return res.status(statusCode).json(payload);
    }
    catch (e) {
        return res.status(503).json({
            ok: false,
            error: e?.message ?? 'queue health failed',
        });
    }
});
exports.default = router;
