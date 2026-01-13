"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const promises_1 = __importDefault(require("node:dns/promises"));
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('Redis');
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
    throw new Error('REDIS_URL is required but was not set');
}
let redisHostForDiagnostics;
let redisPortForDiagnostics;
let redisProtocolForDiagnostics;
try {
    const parsed = new URL(redisUrl);
    redisHostForDiagnostics = parsed.hostname;
    redisPortForDiagnostics = parsed.port ? Number(parsed.port) : undefined;
    redisProtocolForDiagnostics = parsed.protocol;
}
catch (e) {
    logger.warn('Failed to parse REDIS_URL for diagnostics', { message: e?.message });
}
const redisFamily = process.env.REDIS_FAMILY ? Number(process.env.REDIS_FAMILY) : 4;
logger.info('Redis connection configuration', {
    host: redisHostForDiagnostics,
    port: redisPortForDiagnostics,
    protocol: redisProtocolForDiagnostics,
    family: redisFamily,
});
if (redisHostForDiagnostics) {
    promises_1.default.lookup(redisHostForDiagnostics, { all: true })
        .then((addresses) => {
        logger.info('Redis DNS lookup results', {
            host: redisHostForDiagnostics,
            addresses: addresses.map((a) => ({ address: a.address, family: a.family })),
        });
    })
        .catch((e) => {
        logger.warn('Redis DNS lookup failed', { host: redisHostForDiagnostics, message: e?.message });
    });
}
exports.redis = new ioredis_1.default(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 10000,
    family: redisFamily,
});
exports.redis.on('connect', () => logger.info('Redis socket connected'));
exports.redis.on('ready', () => logger.info('Redis client ready'));
exports.redis.on('error', (e) => logger.error('Redis client error', e));
exports.redis.on('close', () => logger.warn('Redis connection closed'));
