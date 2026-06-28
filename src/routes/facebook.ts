import { Router } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { postJobLead, isFacebookConfigured } from '../services/facebookService';

const router = Router();

// ─── GET /api/facebook/config ─────────────────────────────────────────────────
// Tells the frontend whether Facebook posting is set up (so it can show/hide
// the Post to Facebook button without leaking credentials).
router.get('/config', authenticate, (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  return res.json({ configured: isFacebookConfigured() });
});

// ─── POST /api/facebook/post-lead ─────────────────────────────────────────────
// Posts a single job_lead to the configured Facebook Page.
// Body: { leadId: string }
router.post('/post-lead', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
    if (!isFacebookConfigured()) {
      return res.status(503).json({ error: 'Facebook integration not configured — set FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN on the backend.' });
    }

    const { leadId } = req.body as { leadId?: string };
    if (!leadId || typeof leadId !== 'string') {
      return res.status(400).json({ error: 'leadId is required' });
    }

    const result = await postJobLead(leadId);
    return res.json(result);
  } catch (err) {
    console.error('[facebook] post-lead error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to post to Facebook' });
  }
});

export default router;
