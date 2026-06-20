// External job-board API providers — Adzuna (Europe) and JSearch (Gulf / global).
// Each provider exports a `search(...)` function returning a normalised JobLead[]
// so the orchestrating sweep service doesn't need to care which source it came from.

export type NormalizedJobLead = {
  source: 'adzuna' | 'jsearch';
  sourceUrl: string;
  sourceJobId: string | null;
  title: string;
  employerName: string | null;
  countryCode: string;       // ISO 2-letter
  countryName: string | null;
  city: string | null;
  positionCategory: string;  // the search slug we issued, e.g. 'welder'
  publisher: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  descriptionSnippet: string | null;
  postedAt: string | null;   // ISO timestamp
  raw: unknown;
};

const ADZUNA_BASE = 'https://api.adzuna.com/v1/api/jobs';
const JSEARCH_BASE = 'https://jsearch.p.rapidapi.com/search';
const JSEARCH_HOST = 'jsearch.p.rapidapi.com';

// ─── Adzuna ──────────────────────────────────────────────────────────────────

const ADZUNA_COUNTRY_NAMES: Record<string, string> = {
  at: 'Austria', au: 'Australia', be: 'Belgium', br: 'Brazil', ca: 'Canada',
  ch: 'Switzerland', de: 'Germany', es: 'Spain', fr: 'France', gb: 'United Kingdom',
  in: 'India', it: 'Italy', mx: 'Mexico', nl: 'Netherlands', nz: 'New Zealand',
  pl: 'Poland', ru: 'Russia', sg: 'Singapore', us: 'United States', za: 'South Africa',
};

export const ADZUNA_SUPPORTED_COUNTRIES = Object.keys(ADZUNA_COUNTRY_NAMES);

export async function searchAdzuna(args: {
  query: string;
  positionCategory: string;
  countryCode: string;          // must be one of ADZUNA_SUPPORTED_COUNTRIES
  resultsPerPage?: number;
  maxDaysOld?: number;
}): Promise<NormalizedJobLead[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error('Adzuna credentials missing (ADZUNA_APP_ID / ADZUNA_APP_KEY)');
  if (!ADZUNA_SUPPORTED_COUNTRIES.includes(args.countryCode)) {
    throw new Error(`Adzuna does not support country: ${args.countryCode}`);
  }

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(args.resultsPerPage ?? 20),
    what: args.query,
    sort_by: 'date',
    max_days_old: String(args.maxDaysOld ?? 30),
  });

  const url = `${ADZUNA_BASE}/${args.countryCode}/search/1?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Adzuna ${res.status}: ${body.slice(0, 240)}`);
  }
  const data = (await res.json()) as { results?: AdzunaResult[] };
  const results = data.results ?? [];
  return results.map((r) => normaliseAdzuna(r, args));
}

type AdzunaResult = {
  id?: string | number;
  title?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  description?: string;
  created?: string;
};

function normaliseAdzuna(r: AdzunaResult, args: { countryCode: string; positionCategory: string }): NormalizedJobLead {
  const city = r.location?.area?.[r.location.area.length - 1] ?? r.location?.display_name ?? null;
  return {
    source: 'adzuna',
    sourceUrl: String(r.redirect_url ?? '').trim(),
    sourceJobId: r.id != null ? String(r.id) : null,
    title: String(r.title ?? '').trim().slice(0, 500),
    employerName: r.company?.display_name?.trim() ?? null,
    countryCode: args.countryCode,
    countryName: ADZUNA_COUNTRY_NAMES[args.countryCode] ?? null,
    city: city ? String(city).trim().slice(0, 200) : null,
    positionCategory: args.positionCategory,
    publisher: 'Adzuna',
    salaryMin: typeof r.salary_min === 'number' ? r.salary_min : null,
    salaryMax: typeof r.salary_max === 'number' ? r.salary_max : null,
    salaryCurrency: r.salary_currency ?? null,
    descriptionSnippet: r.description ? String(r.description).trim().slice(0, 600) : null,
    postedAt: r.created ?? null,
    raw: r,
  };
}

// ─── JSearch (RapidAPI) ──────────────────────────────────────────────────────
// Aggregates LinkedIn, Indeed, Glassdoor, ZipRecruiter and others.
// Country codes are full ISO 2-letter — works for Gulf (ae, sa, qa, kw, om, bh, tr, etc.).

const JSEARCH_COUNTRY_NAMES: Record<string, string> = {
  ae: 'UAE', sa: 'Saudi Arabia', qa: 'Qatar', kw: 'Kuwait', om: 'Oman', bh: 'Bahrain',
  tr: 'Turkey', jo: 'Jordan', iq: 'Iraq',
  de: 'Germany', gb: 'United Kingdom', pl: 'Poland', us: 'United States',
};

// TODO(linkedin-phase2): if JSearch publisher='LinkedIn' coverage stays thin
// after this enhancement, add a dedicated searchLinkedIn() backed by
// https://rapidapi.com/fantastic-jobs-fantastic-jobs-default/api/linkedin-job-search-api
// — env LINKEDIN_RAPIDAPI_KEY, endpoint /active-jb-24h, gated by
// FEATURE_LINKEDIN_PROVIDER=true. Not needed today.

export async function searchJSearch(args: {
  query: string;
  positionCategory: string;
  countryCode: string;
  datePosted?: 'all' | 'today' | '3days' | 'week' | 'month';
  // Multi-page knobs. Each `num_pages` request burns one billed API call but
  // returns up to ~10 jobs/page (so 3 pages ≈ 30 results in one call). `page`
  // lets the caller paginate beyond that — used by the sweep loop to fan out.
  numPages?: number; // 1-20, JSearch hard caps server-side
  page?: number;     // 1-based
}): Promise<NormalizedJobLead[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error('RAPIDAPI_KEY env var missing');

  const params = new URLSearchParams({
    query: args.query,
    country: args.countryCode,
    page:        String(Math.max(1, args.page ?? 1)),
    num_pages:   String(Math.min(20, Math.max(1, args.numPages ?? 1))),
    date_posted: args.datePosted ?? 'month',
  });

  const url = `${JSEARCH_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': JSEARCH_HOST },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`JSearch ${res.status}: ${body.slice(0, 240)}`);
  }
  const data = (await res.json()) as { data?: JSearchResult[]; status?: string };
  const results = data.data ?? [];
  return results.map((r) => normaliseJSearch(r, args));
}

type JSearchResult = {
  job_id?: string;
  job_title?: string;
  job_apply_link?: string;
  employer_name?: string;
  job_city?: string;
  job_country?: string;
  job_publisher?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_currency?: string;
  job_description?: string;
  job_posted_at_datetime_utc?: string;
};

function normaliseJSearch(r: JSearchResult, args: { countryCode: string; positionCategory: string }): NormalizedJobLead {
  return {
    source: 'jsearch',
    sourceUrl: String(r.job_apply_link ?? '').trim(),
    sourceJobId: r.job_id ?? null,
    title: String(r.job_title ?? '').trim().slice(0, 500),
    employerName: r.employer_name?.trim() ?? null,
    countryCode: args.countryCode,
    countryName: JSEARCH_COUNTRY_NAMES[args.countryCode] ?? r.job_country ?? null,
    city: r.job_city ? String(r.job_city).trim().slice(0, 200) : null,
    positionCategory: args.positionCategory,
    publisher: r.job_publisher ?? null,
    salaryMin: typeof r.job_min_salary === 'number' ? r.job_min_salary : null,
    salaryMax: typeof r.job_max_salary === 'number' ? r.job_max_salary : null,
    salaryCurrency: r.job_salary_currency ?? null,
    descriptionSnippet: r.job_description ? String(r.job_description).trim().slice(0, 600) : null,
    postedAt: r.job_posted_at_datetime_utc ?? null,
    raw: r,
  };
}
