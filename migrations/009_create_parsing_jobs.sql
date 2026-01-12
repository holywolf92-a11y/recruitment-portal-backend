-- Create parsing_jobs table for CV parsing pipeline
create extension if not exists pgcrypto;

create table if not exists parsing_jobs (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null,
  file_hash text,
  status text not null default 'queued', -- queued|processing|extracted|failed
  attempts int not null default 0,

  python_request_id text,
  schema_version text default 'v1',

  result_json jsonb,
  error_code text,
  error_message text,

  started_at timestamptz,
  finished_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_parsing_jobs_attachment_id on parsing_jobs(attachment_id);
create index if not exists idx_parsing_jobs_status on parsing_jobs(status);
