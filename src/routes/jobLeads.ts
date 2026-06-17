import { Router } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth';
import {
  runSweep,
  listJobLeads,
  listRecruiterCompanies,
  listSearchRuns,
  DEFAULT_POSITION_CATEGORIES,
  DEFAULT_EU_COUNTRIES,
  DEFAULT_GULF_COUNTRIES,
  DEFAULT_OTHER_COUNTRIES,
  type LeadFilters,
  type SweepRequest,
} from '../services/jobLeadsService';
import { supabaseAdminClient } from '../config/database';

const router = Router();

// ─── GET /api/jobs/leads ─────────────────────────────────────────────────────
// Paginated, filterable list for the admin UI.
router.get('/leads', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'worker') {
      return res.status(403).json({ error: 'Admin/worker role required' });
    }

    const filters: LeadFilters = {
      countryCode:      typeof req.query.country === 'string' ? req.query.country.toLowerCase() : undefined,
      positionCategory: typeof req.query.position === 'string' ? req.query.position : undefined,
      source:           req.query.source === 'adzuna' || req.query.source === 'jsearch' ? req.query.source : undefined,
      daysOld:          req.query.daysOld ? Math.max(1, Math.min(365, Number(req.query.daysOld))) : undefined,
      search:           typeof req.query.q === 'string' ? req.query.q : undefined,
      limit:            req.query.limit ? Number(req.query.limit) : undefined,
      offset:           req.query.offset ? Number(req.query.offset) : undefined,
    };

    const result = await listJobLeads(filters);
    return res.json(result);
  } catch (err) {
    console.error('[jobLeads] /leads error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list job leads' });
  }
});

// ─── GET /api/jobs/companies ─────────────────────────────────────────────────
// Rolled-up employer view — the actual "recruiter leads" surface for outreach.
router.get('/companies', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'worker') {
      return res.status(403).json({ error: 'Admin/worker role required' });
    }
    const result = await listRecruiterCompanies({
      countryCode: typeof req.query.country === 'string' ? req.query.country.toLowerCase() : undefined,
      minListings: req.query.minListings ? Number(req.query.minListings) : undefined,
      limit:       req.query.limit ? Number(req.query.limit) : undefined,
      offset:      req.query.offset ? Number(req.query.offset) : undefined,
    });
    return res.json(result);
  } catch (err) {
    console.error('[jobLeads] /companies error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list companies' });
  }
});

// ─── PATCH /api/jobs/companies/:id ──────────────────────────────────────────
// Admin marks a company as contacted (so we don't double-pitch).
router.patch('/companies/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    const db = supabaseAdminClient();
    const update: Record<string, unknown> = {};
    if (typeof req.body?.contacted === 'boolean') {
      update.contacted = req.body.contacted;
      update.contacted_at = req.body.contacted ? new Date().toISOString() : null;
      update.contacted_by = req.body.contacted ? (req.user?.email ?? null) : null;
    }
    if (typeof req.body?.notes === 'string') update.notes = req.body.notes;
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }
    const { data, error } = await db
      .from('recruiter_companies')
      .update(update)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw error;
    return res.json({ company: data });
  } catch (err) {
    console.error('[jobLeads] PATCH /companies error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update company' });
  }
});

// ─── GET /api/jobs/runs ──────────────────────────────────────────────────────
// Recent sweep history (for debugging "why didn't this query return anything").
router.get('/runs', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    const result = await listSearchRuns(req.query.limit ? Number(req.query.limit) : 100);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list runs' });
  }
});

// ─── GET /api/jobs/config ────────────────────────────────────────────────────
// What positions / countries are configured. UI uses this to populate filter dropdowns.
router.get('/config', authenticate, async (_req, res) => {
  return res.json({
    positions: DEFAULT_POSITION_CATEGORIES,
    adzunaCountries: DEFAULT_EU_COUNTRIES,
    jsearchCountries: [...DEFAULT_GULF_COUNTRIES, ...DEFAULT_OTHER_COUNTRIES],
  });
});

// ─── POST /api/jobs/sweep ────────────────────────────────────────────────────
// Manual trigger. Body is optional — defaults run the full configured matrix.
// Returns the summary, including per-query results and any errors.
router.post('/sweep', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    const body = (req.body ?? {}) as SweepRequest;
    const summary = await runSweep(body);
    return res.json({ summary });
  } catch (err) {
    console.error('[jobLeads] /sweep error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Sweep failed' });
  }
});

export default router;
