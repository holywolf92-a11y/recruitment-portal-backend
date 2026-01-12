-- 001_create_core_tables.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- users table (reference to auth.users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'Recruiter',
  phone VARCHAR(50),
  department VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Active',
  last_active TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- candidates table
CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  date_of_birth DATE,
  gender VARCHAR(20),
  marital_status VARCHAR(20),
  address TEXT,
  cnic_normalized TEXT,
  passport_normalized TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_cnic ON candidates(cnic_normalized) WHERE cnic_normalized IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_passport ON candidates(passport_normalized) WHERE passport_normalized IS NOT NULL;

-- documents table
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  doc_type VARCHAR(100) NOT NULL,
  storage_bucket VARCHAR(255) NOT NULL,
  storage_path TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  sha256 VARCHAR(64),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- partial unique index for single primary CV per candidate
CREATE UNIQUE INDEX IF NOT EXISTS uq_primary_cv_per_candidate ON documents(candidate_id) WHERE doc_type='cv' AND is_primary=true;

-- candidate_timeline (append-only)
CREATE TABLE IF NOT EXISTS candidate_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  occurred_at TIMESTAMP DEFAULT NOW(),
  event_category VARCHAR(50) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  actor_user_id UUID,
  metadata JSONB
);

-- triggers will be added in subsequent migration
