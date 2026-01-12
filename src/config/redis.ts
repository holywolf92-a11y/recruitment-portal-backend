import IORedis from 'ioredis';

export const redis = new IORedis(process.env.REDIS_URL as string, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
