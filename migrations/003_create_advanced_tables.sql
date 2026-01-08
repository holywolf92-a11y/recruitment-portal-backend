-- 003_create_advanced_tables.sql

CREATE TABLE IF NOT EXISTS communication_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  channel VARCHAR(50) NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS communication_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES communication_templates(id),
  candidate_id UUID REFERENCES candidates(id),
  sent_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS matching_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  params JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_candidate_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id UUID REFERENCES job_orders(id),
  candidate_id UUID REFERENCES candidates(id),
  score DECIMAL
);

CREATE TABLE IF NOT EXISTS cv_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id),
  version_number INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id),
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID,
  action VARCHAR(255),
  target_table VARCHAR(255),
  target_id UUID,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
