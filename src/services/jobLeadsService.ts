// Orchestrates per-sweep work for the recruiter-leads pipeline.
// - Iterates a configurable (provider, position, country) matrix
// - Calls each provider, dedups on source_url, upserts into job_leads
// - Aggregates employer rows into recruiter_companies
// - Writes a job_search_runs audit row per (provider, position, country)

import { supabaseAdminClient } from '../config/database';
import {
  searchAdzuna, searchJSearch, ADZUNA_SUPPORTED_COUNTRIES, type NormalizedJobLead,
} from './jobLeadsProviders';

// Default sweep matrix — what runs when an admin clicks "Run Sweep" with no
// custom params. Edit position list / country list to broaden once stable.
export const DEFAULT_POSITION_CATEGORIES: ReadonlyArray<{ slug: string; query: string }> = [
  { slug: 'welder',                query: 'welder' },
  { slug: 'construction_labourer', query: 'construction labourer' },
  { slug: 'cnc_operator',          query: 'CNC operator' },
  { slug: 'safety_officer',        query: 'safety officer' },
  { slug: 'electrician',           query: 'electrician' },
  { slug: 'plumber',               query: 'plumber' },
  { slug: 'mason',                 query: 'mason' },
  { slug: 'driver',                query: 'heavy vehicle driver' },
  { slug: 'forklift_operator',     query: 'forklift operator' },
  { slug: 'hvac_technician',       query: 'HVAC technician' },
];

export const DEFAULT_GULF_COUNTRIES = ['ae', 'sa', 'qa', 'kw', 'om', 'bh'] as const;
export const DEFAULT_EU_COUNTRIES   = ['gb', 'de', 'pl'] as const;
export const DEFAULT_OTHER_COUNTRIES = ['tr'] as const;

export type SweepRequest = {
  positions?: ReadonlyArray<{ slug: string; query: string }>;
  // Per-provider country lists. Adzuna is EU-only by support; JSearch handles Gulf + global.
  adzunaCountries?: ReadonlyArray<string>;
  jsearchCountries?: ReadonlyArray<string>;
  // Safety cap so an accidental huge matrix doesn't burn the JSearch free tier.
  maxQueries?: number;
};

export type SweepSummary = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalQueries: number;
  totalRawHits: number;
  totalLeadsUpserted: number;
  totalNewLeads: number;
  perRun: Array<{
    source: 'adzuna' | 'jsearch';
    position: string;
    country: string;
    rawHits: number;
    newLeads: number;
    status: 'ok' | 'error';
    error?: string;
  }>;
};

const DEFAULT_MAX_QUERIES = 80;

export async function runSweep(req: SweepRequest = {}): Promise<SweepSummary> {
  const startedAt = new Date();
  const positions = req.positions ?? DEFAULT_POSITION_CATEGORIES;
  const adzunaCountries = req.adzunaCountries ?? DEFAULT_EU_COUNTRIES;
  const jsearchCountries = req.jsearchCountries ?? [...DEFAULT_GULF_COUNTRIES, ...DEFAULT_OTHER_COUNTRIES];
  const maxQueries = req.maxQueries ?? DEFAULT_MAX_QUERIES;

  // Build the matrix, capped.
  type Task = { source: 'adzuna' | 'jsearch'; position: { slug: string; query: string }; country: string };
  const tasks: Task[] = [];
  for (const p of positions) {
    for (const c of adzunaCountries) {
      if (!ADZUNA_SUPPORTED_COUNTRIES.includes(c)) continue;
      tasks.push({ source: 'adzuna', position: p, country: c });
    }
    for (const c of jsearchCountries) {
      tasks.push({ source: 'jsearch', position: p, country: c });
    }
  }
  const planned = tasks.slice(0, maxQueries);

  const summary: SweepSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    durationMs: 0,
    totalQueries: planned.length,
    totalRawHits: 0,
    totalLeadsUpserted: 0,
    totalNewLeads: 0,
    perRun: [],
  };

  // Run sequentially with a tiny delay — keeps us friendly to the free tiers and
  // avoids surprise 429s when running the full 60-ish matrix.
  for (const t of planned) {
    const runStart = Date.now();
    let leads: NormalizedJobLead[] = [];
    let error: string | undefined;
    try {
      if (t.source === 'adzuna') {
        leads = await searchAdzuna({ query: t.position.query, positionCategory: t.position.slug, countryCode: t.country });
      } else {
        const q = `${t.position.query} jobs in ${humanCountry(t.country)}`;
        leads = await searchJSearch({ query: q, positionCategory: t.position.slug, countryCode: t.country });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    let newLeads = 0;
    if (!error && leads.length) {
      try {
        newLeads = await upsertLeads(leads);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }

    summary.perRun.push({
      source: t.source,
      position: t.position.slug,
      country: t.country,
      rawHits: leads.length,
      newLeads,
      status: error ? 'error' : 'ok',
      error,
    });
    summary.totalRawHits += leads.length;
    summary.totalLeadsUpserted += leads.length;
    summary.totalNewLeads += newLeads;

    await logSearchRun({
      source: t.source,
      positionCategory: t.position.slug,
      countryCode: t.country,
      queryText: t.position.query,
      resultsCount: leads.length,
      newLeadsCount: newLeads,
      status: error ? 'error' : 'ok',
      errorMessage: error,
      durationMs: Date.now() - runStart,
    });

    await sleep(250); // be polite — well under any rate cap
  }

  // After all leads are in, refresh the recruiter_companies aggregate.
  try {
    await refreshRecruiterCompanies();
  } catch (err) {
    // Aggregate refresh is non-fatal — the leads are still useful.
    console.error('[jobLeadsService] refreshRecruiterCompanies failed:', err);
  }

  const finishedAt = new Date();
  summary.finishedAt = finishedAt.toISOString();
  summary.durationMs = finishedAt.getTime() - startedAt.getTime();
  return summary;
}

// ─── persistence ────────────────────────────────────────────────────────────

async function upsertLeads(leads: NormalizedJobLead[]): Promise<number> {
  const db = supabaseAdminClient();
  // Drop any leads with no URL (can't dedup → would create dupes every run).
  const valid = leads.filter((l) => l.sourceUrl && l.sourceUrl.startsWith('http'));
  if (!valid.length) return 0;

  // Find which ones are already in the table so we can count "new" accurately.
  const urls = valid.map((l) => l.sourceUrl);
  const { data: existing } = await db
    .from('job_leads')
    .select('source_url')
    .in('source_url', urls);
  const existingUrls = new Set((existing ?? []).map((r: { source_url: string }) => r.source_url));

  const rows = valid.map((l) => ({
    source:              l.source,
    source_url:          l.sourceUrl,
    source_job_id:       l.sourceJobId,
    title:               l.title,
    employer_name:       l.employerName,
    employer_normalized: l.employerName ? l.employerName.trim().toLowerCase() : null,
    country_code:        l.countryCode,
    country_name:        l.countryName,
    city:                l.city,
    position_category:   l.positionCategory,
    publisher:           l.publisher,
    salary_min:          l.salaryMin,
    salary_max:          l.salaryMax,
    salary_currency:     l.salaryCurrency,
    description_snippet: l.descriptionSnippet,
    posted_at:           l.postedAt,
    last_seen_at:        new Date().toISOString(),
    raw:                 l.raw,
  }));

  const { error } = await db.from('job_leads').upsert(rows, { onConflict: 'source_url' });
  if (error) throw error;

  return rows.length - existingUrls.size; // net new
}

async function logSearchRun(args: {
  source: 'adzuna' | 'jsearch';
  positionCategory: string;
  countryCode: string;
  queryText: string;
  resultsCount: number;
  newLeadsCount: number;
  status: 'ok' | 'error';
  errorMessage?: string;
  durationMs: number;
}): Promise<void> {
  const db = supabaseAdminClient();
  await db.from('job_search_runs').insert({
    source: args.source,
    position_category: args.positionCategory,
    country_code: args.countryCode,
    query_text: args.queryText,
    results_count: args.resultsCount,
    new_leads_count: args.newLeadsCount,
    status: args.status,
    error_message: args.errorMessage ?? null,
    duration_ms: args.durationMs,
  });
}

// Recomputes the recruiter_companies aggregate from job_leads.
// We rebuild rather than incrementally update — simpler, and the table is small.
async function refreshRecruiterCompanies(): Promise<void> {
  const db = supabaseAdminClient();

  // Pull every lead's grouping fields. For Falisha-scale (thousands at most),
  // this is fine; if it gets bigger we can move to a SQL view.
  const { data, error } = await db
    .from('job_leads')
    .select('employer_name, employer_normalized, country_code, position_category, publisher, found_at')
    .not('employer_normalized', 'is', null);
  if (error) throw error;

  type LeadRow = {
    employer_name: string;
    employer_normalized: string;
    country_code: string | null;
    position_category: string;
    publisher: string | null;
    found_at: string;
  };

  const grouped = new Map<string, {
    name: string;
    countries: Set<string>;
    positions: Set<string>;
    publishers: Set<string>;
    countryCounts: Map<string, number>;
    listings: number;
    firstSeen: string;
    lastSeen: string;
  }>();

  for (const row of (data ?? []) as LeadRow[]) {
    const key = row.employer_normalized;
    let g = grouped.get(key);
    if (!g) {
      g = { name: row.employer_name, countries: new Set(), positions: new Set(),
            publishers: new Set(), countryCounts: new Map(), listings: 0,
            firstSeen: row.found_at, lastSeen: row.found_at };
      grouped.set(key, g);
    }
    g.listings += 1;
    if (row.country_code) {
      g.countries.add(row.country_code);
      g.countryCounts.set(row.country_code, (g.countryCounts.get(row.country_code) ?? 0) + 1);
    }
    g.positions.add(row.position_category);
    if (row.publisher) g.publishers.add(row.publisher);
    if (row.found_at < g.firstSeen) g.firstSeen = row.found_at;
    if (row.found_at > g.lastSeen)  g.lastSeen = row.found_at;
  }

  const rows = Array.from(grouped.entries()).map(([key, g]) => {
    let primary: string | null = null;
    let max = 0;
    for (const [cc, n] of g.countryCounts) if (n > max) { max = n; primary = cc; }
    return {
      name: g.name,
      name_normalized: key,
      primary_country: primary,
      countries_seen: Array.from(g.countries),
      positions_seen: Array.from(g.positions),
      publishers_seen: Array.from(g.publishers),
      total_listings: g.listings,
      first_seen_at: g.firstSeen,
      last_seen_at: g.lastSeen,
    };
  });

  if (!rows.length) return;

  // Upsert in batches; on conflict update the rolled-up fields but PRESERVE the
  // contacted / contacted_at / contacted_by / notes columns (set by admins).
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error: upErr } = await db
      .from('recruiter_companies')
      .upsert(batch, { onConflict: 'name_normalized' });
    if (upErr) throw upErr;
  }
}

// ─── read side (for admin UI) ───────────────────────────────────────────────

export type LeadFilters = {
  countryCode?: string;
  positionCategory?: string;
  source?: 'adzuna' | 'jsearch';
  daysOld?: number;          // posted_at within this many days
  search?: string;           // employer name or title
  limit?: number;
  offset?: number;
};

export async function listJobLeads(filters: LeadFilters = {}) {
  const db = supabaseAdminClient();
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  let q = db
    .from('job_leads')
    .select(
      'id, source, source_url, title, employer_name, country_code, country_name, city, position_category, publisher, salary_min, salary_max, salary_currency, posted_at, found_at',
      { count: 'exact' },
    )
    .order('posted_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (filters.countryCode)      q = q.eq('country_code', filters.countryCode);
  if (filters.positionCategory) q = q.eq('position_category', filters.positionCategory);
  if (filters.source)           q = q.eq('source', filters.source);
  if (filters.daysOld) {
    const since = new Date(Date.now() - filters.daysOld * 24 * 60 * 60 * 1000).toISOString();
    q = q.gte('posted_at', since);
  }
  if (filters.search) {
    const term = filters.search.trim();
    if (term) {
      const safe = term.replace(/[%,()]/g, ' ');
      q = q.or(`employer_name.ilike.%${safe}%,title.ilike.%${safe}%`);
    }
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return { leads: data ?? [], total: count ?? 0, limit, offset };
}

export async function listRecruiterCompanies(filters: { countryCode?: string; minListings?: number; limit?: number; offset?: number } = {}) {
  const db = supabaseAdminClient();
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  let q = db
    .from('recruiter_companies')
    .select('*', { count: 'exact' })
    .order('total_listings', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.countryCode) q = q.eq('primary_country', filters.countryCode);
  if (filters.minListings) q = q.gte('total_listings', filters.minListings);

  const { data, error, count } = await q;
  if (error) throw error;
  return { companies: data ?? [], total: count ?? 0, limit, offset };
}

export async function listSearchRuns(limit = 100) {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('job_search_runs')
    .select('*')
    .order('ran_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return { runs: data ?? [] };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function humanCountry(code: string): string {
  const map: Record<string, string> = {
    ae: 'UAE', sa: 'Saudi Arabia', qa: 'Qatar', kw: 'Kuwait', om: 'Oman', bh: 'Bahrain',
    tr: 'Turkey', jo: 'Jordan', iq: 'Iraq',
    de: 'Germany', gb: 'United Kingdom', pl: 'Poland', us: 'United States',
  };
  return map[code] ?? code.toUpperCase();
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
