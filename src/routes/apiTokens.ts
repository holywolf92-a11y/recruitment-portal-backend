// Personal-access-token management — list, issue, revoke. Each user manages
// their own tokens; no cross-user admin view (intentionally — minimise blast
// radius). Mounted at /api/auth/tokens; uses the existing authenticate()
// middleware so only logged-in users can mint their own.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { issueToken, listTokensForUser, revokeToken } from '../services/apiTokenService';

const router = Router();
router.use(authenticate);

// Stops a compromised session from spamming token creation. 10/min per user
// is generous for human use; bulk-minting tokens is not a legit pattern.
const mintLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? req.ip ?? 'anon',
  message: { error: 'rate_limited', message: 'Too many token requests — try again in a minute.' },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── GET /api/auth/tokens ─────────────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const tokens = await listTokensForUser(req.user.id);
    return res.json({ tokens });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list tokens' });
  }
});

// ── POST /api/auth/tokens ────────────────────────────────────────────────────
// Returns the plaintext token EXACTLY ONCE in the response. Subsequent GETs
// only return the prefix.
router.post('/', mintLimiter, async (req: AuthRequest, res) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!rawName || rawName.length > 80) {
    return res.status(400).json({ error: 'name required (1-80 chars)' });
  }
  try {
    const { plaintext, row } = await issueToken({ userId: req.user.id, name: rawName });
    return res.status(201).json({ token: plaintext, row });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to issue token' });
  }
});

// ── DELETE /api/auth/tokens/:id ──────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  if (!UUID_RE.test(String(req.params.id))) {
    return res.status(400).json({ error: 'invalid id — must be a UUID' });
  }
  try {
    await revokeToken({ id: String(req.params.id), userId: req.user.id });
    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to revoke token' });
  }
});

export default router;
