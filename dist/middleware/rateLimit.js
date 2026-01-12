"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gmailLimiter = exports.whatsappLimiter = void 0;
exports.createWebhookRateLimiter = createWebhookRateLimiter;
const express_rate_limit_1 = require("express-rate-limit");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('RateLimitMiddleware');
function createWebhookRateLimiter(name, windowMinutes, maxRequests) {
    const limiter = (0, express_rate_limit_1.rateLimit)({
        windowMs: windowMinutes * 60 * 1000,
        max: maxRequests,
        message: `Too many requests to ${name} webhook, please try again later`,
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => {
            // Don't count webhook verifications (GET requests) towards limit
            return req.method === 'GET';
        },
        handler: (req, res) => {
            logger.warn('Rate limit exceeded', {
                path: req.path,
                ip: req.ip,
                method: req.method,
            });
            const rateLimitReq = req;
            res.status(429).json({
                error: 'Too many requests',
                retryAfter: rateLimitReq.rateLimit?.resetTime,
            });
        },
        keyGenerator: (req) => {
            // Rate limit by IP address
            return req.ip || 'unknown';
        },
    });
    return limiter;
}
exports.whatsappLimiter = createWebhookRateLimiter('whatsapp', 1, 120); // 120 req/min
exports.gmailLimiter = createWebhookRateLimiter('gmail', 1, 50); // 50 req/min
