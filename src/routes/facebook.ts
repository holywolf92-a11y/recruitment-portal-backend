import { Router } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { supabaseAdminClient } from '../config/database';

const router = Router();

const POSTING_URL = process.env.POSTING_SERVICE_URL?.replace(/\/$/, '');
const POSTING_KEY = process.env.POSTING_SERVICE_API_KEY || '';

// ─── GET /api/facebook/config ─────────────────────────────────────────────────
router.get('/config', authenticate, async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  if (!POSTING_URL || !POSTING_KEY) return res.json({ configured: false });
  try {
    const r = await fetch(`${POSTING_URL}/falisha/config`, {
      headers: { 'X-Falisha-Key': POSTING_KEY },
    });
    const data = await r.json();
    return res.json(data);
  } catch {
    return res.json({ configured: false });
  }
});

// ─── POST /api/facebook/post-lead ─────────────────────────────────────────────
// Reads the lead from DB, sends data to posting service, updates fb_post_id.
router.post('/post-lead', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
    if (!POSTING_URL || !POSTING_KEY) {
      return res.status(503).json({ error: 'Posting service not configured — set POSTING_SERVICE_URL and POSTING_SERVICE_API_KEY' });
    }

    const { leadId } = req.body as { leadId?: string };
    if (!leadId) return res.status(400).json({ error: 'leadId is required' });

    const db = supabaseAdminClient();
    const { data: lead, error } = await db
      .from('job_leads')
      .select('id, title, employer_name, city, country_name, country_code, salary_min, salary_max, salary_currency, position_category, description_snippet, source_url, fb_post_id')
      .eq('id', leadId)
      .single();

    if (error || !lead) return res.status(404).json({ error: 'Job lead not found' });
    if ((lead as any).fb_post_id) {
      return res.json({ postId: (lead as any).fb_post_id, alreadyPosted: true });
    }

    // Send to posting service
    const postRes = await fetch(`${POSTING_URL}/falisha/post-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Falisha-Key': POSTING_KEY },
      body: JSON.stringify({
        title:                (lead as any).title,
        employer_name:        (lead as any).employer_name,
        city:                 (lead as any).city,
        country_name:         (lead as any).country_name,
        country_code:         (lead as any).country_code,
        salary_min:           (lead as any).salary_min,
        salary_max:           (lead as any).salary_max,
        salary_currency:      (lead as any).salary_currency,
        position_category:    (lead as any).position_category,
        description_snippet:  (lead as any).description_snippet,
        source_url:           (lead as any).source_url,
      }),
    });

    const postData = await postRes.json().catch(() => ({}));
    if (!postRes.ok) {
      return res.status(502).json({ error: (postData as any)?.detail || `Posting service error ${postRes.status}` });
    }

    // Update fb_post_id in DB
    await db
      .from('job_leads')
      .update({ fb_post_id: (postData as any).post_id, fb_posted_at: new Date().toISOString() })
      .eq('id', leadId);

    return res.json({ postId: (postData as any).post_id, alreadyPosted: false });
  } catch (err) {
    console.error('[facebook] post-lead error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to post to Facebook' });
  }
});

export default router;
