-- Migration 044: Job Candidate Recommendations
-- Admin manually recommends specific candidates for specific employer job requirements.
-- Each recommendation is strictly scoped to one job_id → one candidate_id.

CREATE TABLE IF NOT EXISTS job_candidate_recommendations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID        NOT NULL REFERENCES employer_leads(id) ON DELETE CASCADE,
  candidate_id      UUID        NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  match_score       INTEGER     NOT NULL DEFAULT 75
                                CHECK (match_score >= 0 AND match_score <= 100),
  employer_status   TEXT        NOT NULL DEFAULT 'unreviewed'
                                CHECK (employer_status IN ('unreviewed', 'shortlisted', 'selected', 'rejected')),
  recommended_by    TEXT,       -- admin user name/id (nullable)
  admin_notes       TEXT,
  recommended_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_jcr_job_id       ON job_candidate_recommendations(job_id);
CREATE INDEX IF NOT EXISTS idx_jcr_candidate_id ON job_candidate_recommendations(candidate_id);
CREATE INDEX IF NOT EXISTS idx_jcr_status       ON job_candidate_recommendations(employer_status);
