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

const targetAttachmentIds = new Set([
  'e9d9c841-cd1a-4735-a2b6-d31174f7b233',
  '00299eea-6760-4cd9-a08b-ee677b6e0dd2',
]);
const targetJobIds = new Set([
  '39915ee5-1a3e-4979-b81f-cd597c47cefe',
  '6a958450-1a6b-4ad7-9e7d-ed41854a76f6',
]);

async function main() {
  const queue = new Queue('cv-parsing', { connection: redis });
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
  const jobs = await queue.getJobs(['waiting', 'active', 'delayed'], 0, 300, true);
  const matches = jobs
    .filter((job) => targetAttachmentIds.has(job.data?.attachmentId) || targetJobIds.has(job.data?.jobId))
    .map((job) => ({
      redisJobId: job.id,
      stateGuess: job.finishedOn ? 'finished' : 'pending',
      name: job.name,
      data: job.data,
    }));

  console.log(JSON.stringify({ counts, matches }, null, 2));

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
