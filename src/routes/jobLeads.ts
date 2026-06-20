import { Router } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth';
import {
  runSweep,
  listJobLeads,
  listRecruiterCompanies,
  listSearchRuns,
  listPublishers,
  isSweepInFlight,
  invalidatePublishersCache,
  SweepAlreadyRunningError,
  SweepBudgetExceededError,
  DEFAULT_POSITION_CATEGORIES,
  DEFAULT_EU_COUNTRIES,
  DEFAULT_GULF_COUNTRIES,
  DEFAULT_OTHER_COUNTRIES,
  type LeadFilters,
  type SweepRequest,
} from '../services/jobLeadsService';

// Bounded-int parser that rejects NaN silently instead of letting `Number(...)`
// of a malformed query param propagate as NaN through the filter pipeline.
function clampedInt(v: unknown, min: number, max: number): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
import { supabaseAdminClient } from '../config/database';

const router = Router();

// ─── GET /api/jobs/leads ─────────────────────────────────────────────────────
// Paginated, filterable list for the admin UI.
router.get('/leads', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'worker') {
      return res.status(403).json({ error: 'Admin/worker role required' });
    }

    const filters = parseLeadFilters(req);
    const result = await listJobLeads(filters);
    return res.json(result);
  } catch (err) {
    console.error('[jobLeads] /leads error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list job leads' });
  }
});

function parseLeadFilters(req: AuthRequest): LeadFilters {
  const datePosted = typeof req.query.datePosted === 'string'
    ? (['today', '3days', 'week', 'month', 'all'].includes(req.query.datePosted)
        ? (req.query.datePosted as LeadFilters['datePosted'])
        : undefined)
    : undefined;
  return {
    countryCode:      typeof req.query.country === 'string' ? req.query.country.toLowerCase() : undefined,
    positionCategory: typeof req.query.position === 'string' ? req.query.position : undefined,
    source:           req.query.source === 'adzuna' || req.query.source === 'jsearch' ? req.query.source : undefined,
    daysOld:          clampedInt(req.query.daysOld, 1, 365),
    datePosted,
    publisher:        typeof req.query.publisher === 'string' && req.query.publisher.length <= 80 ? req.query.publisher : undefined,
    search:           typeof req.query.q === 'string' ? req.query.q : undefined,
    limit:            clampedInt(req.query.limit,  1, 10_000),
    offset:           clampedInt(req.query.offset, 0, 1_000_000),
  };
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

// ─── GET /api/jobs/leads/export ─────────────────────────────────────────────
// Buffers up to EXPORT_CAP rows then writes CSV. When the filtered total
// exceeds the cap, sets X-Truncated + X-Truncated-Total response headers so
// the frontend can surface a warning. Caps at 10k rows so a careless click
// can't OOM the Railway worker.
const EXPORT_CAP = 10_000;
router.get('/leads/export', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'worker') {
      return res.status(403).json({ error: 'Admin/worker role required' });
    }
    const filters = parseLeadFilters(req);
    const result = await listJobLeads({ ...filters, limit: EXPORT_CAP, offset: 0 });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="recruiter-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Exported-Rows', String(result.leads.length));
    if (result.total > result.leads.length) {
      res.setHeader('X-Truncated', 'true');
      res.setHeader('X-Truncated-Total', String(result.total));
    }
    // Tell the browser to start the download dialog now — the actual rows
    // follow as they're written.
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const cols = ['title', 'employer_name', 'country_code', 'country_name', 'city',
      'position_category', 'publisher', 'salary_min', 'salary_max', 'salary_currency',
      'source', 'source_url', 'posted_at', 'found_at'];
    res.write(cols.join(',') + '\n');
    for (const r of result.leads as Array<Record<string, unknown>>) {
      res.write(cols.map((c) => csvCell(r[c])).join(',') + '\n');
    }
    res.end();
  } catch (err) {
    console.error('[jobLeads] /leads/export error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'CSV export failed' });
    }
    res.end();
  }
});

// ─── GET /api/jobs/publishers ───────────────────────────────────────────────
// Distinct publisher values — populates the frontend's Publisher dropdown.
// Cached for ~60s in the service; ?fresh=1 bypasses the cache.
router.get('/publishers', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'worker') {
      return res.status(403).json({ error: 'Admin/worker role required' });
    }
    const force = req.query.fresh === '1';
    const publishers = await listPublishers(force);
    return res.json({ publishers });
  } catch (err) {
    console.error('[jobLeads] /publishers error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list publishers' });
  }
});

// ─── GET /api/jobs/sweep/status ─────────────────────────────────────────────
// Lightweight peek for the frontend to know if a sweep is already running
// (so it can grey out the "Run sweep" button across tabs/devices).
router.get('/sweep/status', authenticate, async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  return res.json({ running: isSweepInFlight() });
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
    // Bust the publishers cache so a new sweep that surfaced new publishers
    // shows up in the dropdown right away.
    invalidatePublishersCache();
    return res.json({ summary });
  } catch (err) {
    if (err instanceof SweepAlreadyRunningError) {
      return res.status(409).json({ error: 'sweep_already_running' });
    }
    if (err instanceof SweepBudgetExceededError) {
      return res.status(400).json({ error: 'sweep_budget_exceeded', message: err.message, billed: err.billed, cap: err.cap });
    }
    console.error('[jobLeads] /sweep error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Sweep failed' });
  }
});

export default router;
