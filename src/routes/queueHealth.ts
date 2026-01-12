import { Router } from 'express';
import { redis } from '../config/redis';
import { cvParsingQueue } from '../config/queue';

const router = Router();

router.get('/queue', async (_req, res) => {
  try {
    const redisPing = await redis.ping();
    const counts = await cvParsingQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    const isOk = redisPing === 'PONG';

    return res.status(isOk ? 200 : 503).json({
      ok: isOk,
      redis: { ping: redisPing },
      queue: { name: cvParsingQueue.name, counts },
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
