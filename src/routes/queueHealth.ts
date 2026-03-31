import { Router } from 'express';
import {
  cvParsingQueue,
  documentVerificationQueue,
  whatsappMediaQueue,
  whatsappAttachmentVerificationQueue,
} from '../config/queue';

const router = Router();

const QUEUE_HEALTH_CACHE_TTL_MS = Number(process.env.QUEUE_HEALTH_CACHE_TTL_MS || 60000);
let queueHealthCache: { expiresAt: number; payload: any; statusCode: number } | null = null;

/** Ping Redis via Upstash REST (HTTPS/443) — avoids TCP port 6380 which may be blocked. */
async function pingRedis(): Promise<{ ok: boolean; method: string }> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (restUrl && restToken) {
    try {
      const res = await fetch(`${restUrl}/ping`, {
        headers: { Authorization: `Bearer ${restToken}` },
        signal: AbortSignal.timeout(5_000),
      });
      const data = await res.json() as { result?: string };
      return { ok: data.result === 'PONG', method: 'rest' };
    } catch {
      return { ok: false, method: 'rest' };
    }
  }
  return { ok: false, method: 'none' };
}

const EMPTY_COUNTS = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
async function safeJobCounts(q: typeof cvParsingQueue) {
  try {
    // Race against a 3 s timeout so the health endpoint doesn't hang on Redis TCP issues
    return await Promise.race([
      q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      new Promise<typeof EMPTY_COUNTS>((resolve) => setTimeout(() => resolve(EMPTY_COUNTS), 3_000)),
    ]);
  } catch {
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
      safeJobCounts(cvParsingQueue),
      safeJobCounts(documentVerificationQueue),
      safeJobCounts(whatsappMediaQueue),
      safeJobCounts(whatsappAttachmentVerificationQueue),
    ]);
    const isOk = redisPing.ok;

    const payload = {
      ok: isOk,
      cached: false,
      redis: { ping: isOk ? 'PONG' : 'FAILED', method: redisPing.method },
      queue: { name: cvParsingQueue.name, counts: cvCounts },
      queues: [
        { name: cvParsingQueue.name, counts: cvCounts },
        { name: documentVerificationQueue.name, counts: docCounts },
        { name: whatsappMediaQueue.name, counts: waMediaCounts },
        { name: whatsappAttachmentVerificationQueue.name, counts: waVerifyCounts },
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
  } catch (e: any) {
    return res.status(503).json({
      ok: false,
      error: e?.message ?? 'queue health failed',
    });
  }
});

export default router;
