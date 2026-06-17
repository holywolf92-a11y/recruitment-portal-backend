-- Recruiter / job-lead sweep system
-- Tables for storing job listings scraped from external APIs (Adzuna, JSearch).
-- The pipeline runs daily and pushes here. Admins query for recruitment leads
-- (companies and agencies hiring labour we can supply).

-- ─── job_leads ───────────────────────────────────────────────────────────────
-- One row per distinct job posting we've found.
-- Deduped on source_url so a rerun of the sweep updates the same row instead of
-- creating dupes.
CREATE TABLE IF NOT EXISTS job_leads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source              text NOT NULL,                   -- 'adzuna' | 'jsearch'
  source_url          text NOT NULL UNIQUE,            -- dedup key
  source_job_id       text,                            -- provider's own id when available
  title               text NOT NULL,
  employer_name       text,
  employer_normalized text,                            -- lowercased, trimmed, for grouping
  country_code        text,                            -- ISO 2-letter (ae, sa, qa, gb, de, pl, …)
  country_name        text,
  city                text,
  position_category   text NOT NULL,                   -- the search slug we issued (welder, construction_labourer, …)
  publisher           text,                            -- e.g. Indeed, LinkedIn, Naukrigulf
  salary_min          numeric,
  salary_max          numeric,
  salary_currency     text,
  description_snippet text,                            -- short snippet/teaser, not full body
  posted_at           timestamptz,                     -- when the job was posted (provider-supplied)
  found_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  raw                 jsonb                            -- the full normalized record from the provider, for audit
);

CREATE INDEX IF NOT EXISTS job_leads_country_idx          ON job_leads (country_code);
CREATE INDEX IF NOT EXISTS job_leads_position_idx         ON job_leads (position_category);
CREATE INDEX IF NOT EXISTS job_leads_employer_idx         ON job_leads (employer_normalized);
CREATE INDEX IF NOT EXISTS job_leads_source_idx           ON job_leads (source);
CREATE INDEX IF NOT EXISTS job_leads_found_at_desc_idx    ON job_leads (found_at DESC);
CREATE INDEX IF NOT EXISTS job_leads_posted_at_desc_idx   ON job_leads (posted_at DESC NULLS LAST);

-- ─── companies ───────────────────────────────────────────────────────────────
-- Rolled-up view of the unique employers appearing in job_leads.
-- This is what Falisha actually wants to look at — "who is hiring our profile of
-- workers?" Maintained by the sweep service.
CREATE TABLE IF NOT EXISTS recruiter_companies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  name_normalized     text NOT NULL UNIQUE,            -- lowercased, trimmed (dedup key)
  primary_country     text,                            -- ISO 2-letter of the country we see them most in
  countries_seen      text[] NOT NULL DEFAULT '{}',    -- all countries we've seen them post in
  positions_seen      text[] NOT NULL DEFAULT '{}',    -- all position categories they've posted
  publishers_seen     text[] NOT NULL DEFAULT '{}',    -- Indeed/LinkedIn/Naukrigulf/etc.
  total_listings      integer NOT NULL DEFAULT 0,      -- how many job_leads rows reference this employer
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  contacted           boolean NOT NULL DEFAULT false,  -- admin marks once Falisha outreach happens
  contacted_at        timestamptz,
  contacted_by        text,                            -- admin user email
  notes               text
);

CREATE INDEX IF NOT EXISTS recruiter_companies_country_idx    ON recruiter_companies (primary_country);
CREATE INDEX IF NOT EXISTS recruiter_companies_listings_idx   ON recruiter_companies (total_listings DESC);
CREATE INDEX IF NOT EXISTS recruiter_companies_last_seen_idx  ON recruiter_companies (last_seen_at DESC);

-- ─── search_runs ─────────────────────────────────────────────────────────────
-- Audit log of every sweep we run. One row per (provider, position, country).
-- Lets us see history, cost, and debug "why didn't this query return anything".
CREATE TABLE IF NOT EXISTS job_search_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source              text NOT NULL,                   -- 'adzuna' | 'jsearch'
  position_category   text NOT NULL,
  country_code        text NOT NULL,
  query_text          text,                            -- the exact query string sent
  results_count       integer NOT NULL DEFAULT 0,      -- rows returned by provider
  new_leads_count     integer NOT NULL DEFAULT 0,      -- net new job_leads rows inserted
  status              text NOT NULL,                   -- 'ok' | 'error'
  error_message       text,
  duration_ms         integer,
  ran_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_search_runs_ran_at_idx  ON job_search_runs (ran_at DESC);
CREATE INDEX IF NOT EXISTS job_search_runs_source_idx  ON job_search_runs (source, ran_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Service-role-only (backend uses service key, bypasses RLS). No public select.
ALTER TABLE job_leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiter_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_search_runs    ENABLE ROW LEVEL SECURITY;
