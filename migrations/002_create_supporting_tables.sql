-- 002_create_supporting_tables.sql

CREATE TABLE IF NOT EXISTS employers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_code VARCHAR(50) UNIQUE NOT NULL,
  employer_id UUID REFERENCES employers(id)
);

CREATE TABLE IF NOT EXISTS inbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(50) NOT NULL,
  external_message_id VARCHAR(255) UNIQUE NOT NULL,
  payload JSONB,
  received_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inbox_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_message_id UUID REFERENCES inbox_messages(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  storage_bucket VARCHAR(255) NOT NULL,
  storage_path TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  sha256 VARCHAR(64),
  attachment_type VARCHAR(50)
);

-- strict dedupe for CVs: unique sha256 + attachment_type
CREATE UNIQUE INDEX IF NOT EXISTS uq_inboxattachments_sha256_type ON inbox_attachments(sha256, attachment_type) WHERE attachment_type='cv' AND sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS parsing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_attachment_id UUID REFERENCES inbox_attachments(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending',
  output JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
