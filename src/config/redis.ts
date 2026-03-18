import IORedis from 'ioredis';
import { createLogger } from '../utils/errorHandling';

const logger = createLogger('Redis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Parse URL into explicit components — avoids IORedis URL-parsing edge cases
// and ensures TLS + credentials are passed correctly for Upstash / managed Redis.
let parsedHost = 'localhost';
let parsedPort = 6379;
let parsedPassword: string | undefined;
let parsedUsername: string | undefined;
let isTLS = false;

try {
  const u = new URL(redisUrl);
  parsedHost = u.hostname;
  parsedPort = u.port ? Number(u.port) : (u.protocol === 'rediss:' ? 6380 : 6379);
  parsedPassword = u.password ? decodeURIComponent(u.password) : undefined;
  parsedUsername = u.username ? decodeURIComponent(u.username) : undefined;
  isTLS = u.protocol === 'rediss:';
} catch (e) {
  logger.warn('Failed to parse REDIS_URL — falling back to URL string', { message: (e as any)?.message });
}

logger.info('Redis connection configuration', {
  host: parsedHost,
  port: parsedPort,
  tls: isTLS,
  hasPassword: !!parsedPassword,
});

export const redis = new IORedis({
  host: parsedHost,
  port: parsedPort,
  username: parsedUsername,
  password: parsedPassword,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 15_000,
  family: 4,           // force IPv4 — Railway containers may otherwise try IPv6
  lazyConnect: true,   // don't connect at module load; connect on first command
  // Give up after 5 retries (~30 s) to avoid hammering a blocked port
  retryStrategy: (times) => (times >= 5 ? null : Math.min(times * 2_000, 10_000)),
  ...(isTLS ? { tls: { rejectUnauthorized: false } } : {}),
});

redis.on('connect', () => logger.info('Redis socket connected'));
redis.on('ready', () => logger.info('Redis client ready'));
redis.on('error', (e) => logger.error('Redis client error', { message: (e as any)?.message }));
redis.on('close', () => logger.warn('Redis connection closed'));
