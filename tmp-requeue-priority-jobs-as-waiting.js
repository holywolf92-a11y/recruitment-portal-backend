require('dotenv').config();

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

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

const jobs = [
  {
    oldQueueJobId: 'repair-iqbal-e9d9c841',
    newQueueJobId: 'repair2-iqbal-e9d9c841',
    data: {
      jobId: '39915ee5-1a3e-4979-b81f-cd597c47cefe',
      attachmentId: 'e9d9c841-cd1a-4735-a2b6-d31174f7b233',
      fileHash: null,
      force: true,
    },
  },
  {
    oldQueueJobId: 'repair-farooq-00299eea',
    newQueueJobId: 'repair2-farooq-00299eea',
    data: {
      jobId: '6a958450-1a6b-4ad7-9e7d-ed41854a76f6',
      attachmentId: '00299eea-6760-4cd9-a08b-ee677b6e0dd2',
      fileHash: null,
      force: true,
    },
  },
];

async function main() {
  const redis = createRedis();
  const queue = new Queue('cv-parsing', { connection: redis });

  try {
    for (const item of jobs) {
      const oldJob = await queue.getJob(item.oldQueueJobId);
      if (oldJob) {
        await oldJob.remove();
      }

      await queue.add('parse', item.data, {
        jobId: item.newQueueJobId,
        lifo: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 200,
        removeOnFail: 200,
      });
    }

    console.log(JSON.stringify({ ok: true, requeued: jobs.map((j) => j.newQueueJobId) }, null, 2));
  } finally {
    await queue.close();
    await redis.quit();
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});