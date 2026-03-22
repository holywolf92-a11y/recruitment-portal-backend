"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('Redis');
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
// Parse URL into explicit components — avoids IORedis URL-parsing edge cases
// and ensures TLS + credentials are passed correctly for Upstash / managed Redis.
let parsedHost = 'localhost';
let parsedPort = 6379;
let parsedPassword;
let parsedUsername;
let isTLS = false;
try {
    const u = new URL(redisUrl);
    parsedHost = u.hostname;
    parsedPort = u.port ? Number(u.port) : (u.protocol === 'rediss:' ? 6380 : 6379);
    parsedPassword = u.password ? decodeURIComponent(u.password) : undefined;
    parsedUsername = u.username ? decodeURIComponent(u.username) : undefined;
    isTLS = u.protocol === 'rediss:';
}
catch (e) {
    logger.warn('Failed to parse REDIS_URL — falling back to URL string', { message: e?.message });
}
logger.info('Redis connection configuration', {
    host: parsedHost,
    port: parsedPort,
    tls: isTLS,
    hasPassword: !!parsedPassword,
});
exports.redis = new ioredis_1.default({
    host: parsedHost,
    port: parsedPort,
    username: parsedUsername,
    password: parsedPassword,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 15000,
    family: 4, // force IPv4 — Railway containers may otherwise try IPv6
    lazyConnect: true, // don't connect at module load; connect on first command
    // Give up after 5 retries (~30 s) to avoid hammering a blocked port
    retryStrategy: (times) => (times >= 5 ? null : Math.min(times * 2000, 10000)),
    ...(isTLS ? { tls: { rejectUnauthorized: false } } : {}),
});
exports.redis.on('connect', () => logger.info('Redis socket connected'));
exports.redis.on('ready', () => logger.info('Redis client ready'));
exports.redis.on('error', (e) => logger.error('Redis client error', { message: e?.message }));
exports.redis.on('close', () => logger.warn('Redis connection closed'));
