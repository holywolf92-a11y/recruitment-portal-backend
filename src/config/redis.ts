import IORedis from 'ioredis';
import dns from 'node:dns/promises';
import { createLogger } from '../utils/errorHandling';

const logger = createLogger('Redis');

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL is required but was not set');
}

let redisHostForDiagnostics: string | undefined;
let redisPortForDiagnostics: number | undefined;
let redisProtocolForDiagnostics: string | undefined;

try {
  const parsed = new URL(redisUrl);
  redisHostForDiagnostics = parsed.hostname;
  redisPortForDiagnostics = parsed.port ? Number(parsed.port) : undefined;
  redisProtocolForDiagnostics = parsed.protocol;
} catch (e) {
  logger.warn('Failed to parse REDIS_URL for diagnostics', { message: (e as any)?.message });
}

const redisFamily = process.env.REDIS_FAMILY ? Number(process.env.REDIS_FAMILY) : 4;

logger.info('Redis connection configuration', {
  host: redisHostForDiagnostics,
  port: redisPortForDiagnostics,
  protocol: redisProtocolForDiagnostics,
  family: redisFamily,
});

if (redisHostForDiagnostics) {
  dns.lookup(redisHostForDiagnostics, { all: true })
    .then((addresses) => {
      logger.info('Redis DNS lookup results', {
        host: redisHostForDiagnostics,
        addresses: addresses.map((a) => ({ address: a.address, family: a.family })),
      });
    })
    .catch((e) => {
      logger.warn('Redis DNS lookup failed', { host: redisHostForDiagnostics, message: (e as any)?.message });
    });
}

export const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  connectTimeout: 10_000,
  family: redisFamily,
});

redis.on('connect', () => logger.info('Redis socket connected'));
redis.on('ready', () => logger.info('Redis client ready'));
redis.on('error', (e) => logger.error('Redis client error', e));
redis.on('close', () => logger.warn('Redis connection closed'));
