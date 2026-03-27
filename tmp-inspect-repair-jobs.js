require('dotenv').config();
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const url = new URL(redisUrl);
const redis = new IORedis({
  host: url.hostname,
  port: url.port ? Number(url.port) : (url.protocol === 'rediss:' ? 6380 : 6379),
  username: url.username || undefined,
  password: url.password || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  family: 4,
  ...(url.protocol === 'rediss:' ? { tls: { rejectUnauthorized: false } } : {}),
});

const queueJobIds = ['repair-iqbal-e9d9c841', 'repair-farooq-00299eea'];

async function main() {
  const queue = new Queue('cv-parsing', { connection: redis });
  const results = [];
  for (const queueJobId of queueJobIds) {
    const job = await queue.getJob(queueJobId);
    if (!job) {
      results.push({ queueJobId, found: false });
      continue;
    }
    const state = await job.getState();
    results.push({
      queueJobId,
      found: true,
      state,
      data: job.data,
      failedReason: job.failedReason || null,
      returnvalue: job.returnvalue || null,
      stacktrace: job.stacktrace || [],
      processedOn: job.processedOn || null,
      finishedOn: job.finishedOn || null,
    });
  }
  console.log(JSON.stringify(results, null, 2));
  await queue.close();
  await redis.quit();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await redis.quit();
  } catch {}
  process.exit(1);
});
