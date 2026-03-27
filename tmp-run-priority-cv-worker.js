require('dotenv').config();

const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const { startCvParserWorker } = require('./dist/workers/cvParserWorker');

const targetQueueJobIds = [
  'repair-iqbal-e9d9c841',
  'repair-farooq-00299eea',
];

function createRedis() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const url = new URL(redisUrl);
  return new IORedis({
    host: url.hostname,
    port: url.port ? Number(url.port) : (url.protocol === 'rediss:' ? 6380 : 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    family: 4,
    ...(url.protocol === 'rediss:' ? { tls: { rejectUnauthorized: false } } : {}),
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const redis = createRedis();
  const queue = new Queue('cv-parsing', { connection: redis });
  const worker = startCvParserWorker();

  console.log('[priority-worker] started extra local cv parser worker');

  try {
    const startedAt = Date.now();

    while (true) {
      const snapshots = [];
      let allFinished = true;

      for (const id of targetQueueJobIds) {
        const job = await queue.getJob(id);
        if (!job) {
          snapshots.push({ id, state: 'missing' });
          allFinished = false;
          continue;
        }

        const state = await job.getState();
        snapshots.push({
          id,
          state,
          processedOn: job.processedOn || null,
          finishedOn: job.finishedOn || null,
          failedReason: job.failedReason || null,
        });

        if (!['completed', 'failed'].includes(state)) {
          allFinished = false;
        }
      }

      console.log(JSON.stringify({ elapsedSec: Math.round((Date.now() - startedAt) / 1000), snapshots }, null, 2));

      if (allFinished) {
        break;
      }

      await sleep(10000);
    }
  } finally {
    await worker.close();
    await queue.close();
    await redis.quit();
    console.log('[priority-worker] stopped');
  }
}

main().catch((error) => {
  console.error('[priority-worker] fatal', error);
  process.exit(1);
});