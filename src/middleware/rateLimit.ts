import { RateLimitRequestHandler, rateLimit } from 'express-rate-limit';
import { Request } from 'express';
import { createLogger } from '../utils/errorHandling';

const logger = createLogger('RateLimitMiddleware');

// Extend Express Request to include rateLimit property
interface RateLimitRequest extends Request {
  rateLimit?: {
    limit: number;
    current: number;
    remaining: number;
    resetTime?: Date;
  };
}

export function createWebhookRateLimiter(name: string, windowMinutes: number, maxRequests: number): RateLimitRequestHandler {
  const limiter = rateLimit({
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
      const rateLimitReq = req as RateLimitRequest;
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

export const whatsappLimiter = createWebhookRateLimiter('whatsapp', 1, 120); // 120 req/min
export const gmailLimiter = createWebhookRateLimiter('gmail', 1, 50); // 50 req/min

export const aiExtractionLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 requests / 5 min per IP
  message: 'Too many AI photo extraction requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('AI extraction rate limit exceeded', {
      path: req.path,
      ip: req.ip,
      method: req.method,
    });
    const rateLimitReq = req as RateLimitRequest;
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: rateLimitReq.rateLimit?.resetTime,
    });
  },
  keyGenerator: (req) => req.ip || 'unknown',
});
