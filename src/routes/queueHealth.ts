import { Router } from 'express';
import { redis } from '../config/redis';
import {
  cvParsingQueue,
  documentVerificationQueue,
  whatsappMediaQueue,
  whatsappAttachmentVerificationQueue,
} from '../config/queue';

const router = Router();

router.get('/queue', async (_req, res) => {
  try {
    const redisPing = await redis.ping();
    const [cvCounts, docCounts, waMediaCounts, waVerifyCounts] = await Promise.all([
      cvParsingQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      documentVerificationQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      whatsappMediaQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      whatsappAttachmentVerificationQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
    ]);
    const isOk = redisPing === 'PONG';

    return res.status(isOk ? 200 : 503).json({
      ok: isOk,
      redis: { ping: redisPing },
      // Backward compatible (older checks only look at this)
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
