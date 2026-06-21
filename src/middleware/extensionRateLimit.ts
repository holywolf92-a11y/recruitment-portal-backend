// Per-token rate limit for the Chrome-extension ingest endpoint. 60 req/min is
// generous enough to bulk-select 50 CVs at once but tight enough to kill a
// runaway script. Keyed on req.user.id (set by authenticate()) so users
// behind a shared NAT don't share quota.

import rateLimit from 'express-rate-limit';
import type { AuthRequest } from './auth';

export const extensionRateLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute sliding window (default for memory store is fixed, fine for single-instance)
  max: 60,                    // 60 requests per minute per user
  standardHeaders: true,
  legacyHeaders: false,
  // Custom key — fall back to IP only if somehow we don't have a user (defense
  // in depth; if authenticate() let an unauthenticated request through, we
  // still want a sane limit instead of leaking ALL IPs into one bucket).
  keyGenerator: (req) => {
    const userId = (req as AuthRequest).user?.id;
    return userId ? `user:${userId}` : `ip:${req.ip}`;
  },
  message: { error: 'rate_limited', message: 'Too many requests — try again in a minute.' },
});
