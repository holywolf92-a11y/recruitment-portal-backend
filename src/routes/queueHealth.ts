import { Router } from 'express';
import {
  cvParsingQueue,
  documentVerificationQueue,
  whatsappMediaQueue,
  whatsappAttachmentVerificationQueue,
} from '../config/queue';

const router = Router();

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
    return await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  } catch {
    return EMPTY_COUNTS;
  }
}

router.get('/queue', async (_req, res) => {
  try {
    const redisPing = await pingRedis();
    const [cvCounts, docCounts, waMediaCounts, waVerifyCounts] = await Promise.all([
      safeJobCounts(cvParsingQueue),
      safeJobCounts(documentVerificationQueue),
      safeJobCounts(whatsappMediaQueue),
      safeJobCounts(whatsappAttachmentVerificationQueue),
    ]);
    const isOk = redisPing.ok;

    return res.status(isOk ? 200 : 503).json({
      ok: isOk,
      redis: { ping: isOk ? 'PONG' : 'FAILED', method: redisPing.method },
      queue: { name: cvParsingQueue.name, counts: cvCounts },
      queues: [
        { name: cvParsingQueue.name, counts: cvCounts },
        { name: documentVerificationQueue.name, counts: docCounts },
        { name: whatsappMediaQueue.name, counts: waMediaCounts },
        { name: whatsappAttachmentVerificationQueue.name, counts: waVerifyCounts },
      ],
      workerExpected: Boolean(process.env.REDIS_URL && process.env.PYTHON_CV_PARSER_URL && process.env.PYTHON_HMAC_SECRET),
    });
  } catch (e: any) {
    return res.status(503).json({
      ok: false,
      error: e?.message ?? 'queue health failed',
    });
  }
});

export default router;
