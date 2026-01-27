-- Migration 023: Add indexes for candidate search and filtering
-- These indexes optimize server-side search, date filtering, and sorting for Excel Browser

-- Index on name for search (case-insensitive search uses ilike which benefits from this)
CREATE INDEX IF NOT EXISTS idx_candidates_name ON candidates(name);

-- Index on passport_normalized for search
CREATE INDEX IF NOT EXISTS idx_candidates_passport_normalized ON candidates(passport_normalized) WHERE passport_normalized IS NOT NULL;

-- Index on cnic_normalized for search
CREATE INDEX IF NOT EXISTS idx_candidates_cnic_normalized ON candidates(cnic_normalized) WHERE cnic_normalized IS NOT NULL;

-- Index on created_at for date range filtering (Date Applied filter)
CREATE INDEX IF NOT EXISTS idx_candidates_created_at ON candidates(created_at DESC);

-- Composite index for common filter combinations (position + date)
CREATE INDEX IF NOT EXISTS idx_candidates_position_created_at ON candidates(position, created_at DESC) WHERE position IS NOT NULL;

-- Index on status for filtering
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status) WHERE status IS NOT NULL;

-- Index on country_of_interest for filtering
CREATE INDEX IF NOT EXISTS idx_candidates_country_of_interest ON candidates(country_of_interest) WHERE country_of_interest IS NOT NULL;

-- Index on email for search (if not already exists)
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email) WHERE email IS NOT NULL;

-- Index on phone for search
CREATE INDEX IF NOT EXISTS idx_candidates_phone ON candidates(phone) WHERE phone IS NOT NULL;

COMMENT ON INDEX idx_candidates_name IS 'Optimizes name search in Excel Browser global search';
COMMENT ON INDEX idx_candidates_passport_normalized IS 'Optimizes passport search in Excel Browser global search';
COMMENT ON INDEX idx_candidates_cnic_normalized IS 'Optimizes CNIC search in Excel Browser global search';
COMMENT ON INDEX idx_candidates_created_at IS 'Optimizes Date Applied filter (from/to date range)';
COMMENT ON INDEX idx_candidates_position_created_at IS 'Optimizes folder filtering by position with date sorting';
COMMENT ON INDEX idx_candidates_status IS 'Optimizes status filtering';
COMMENT ON INDEX idx_candidates_country_of_interest IS 'Optimizes country filtering';
COMMENT ON INDEX idx_candidates_email IS 'Optimizes email search in Excel Browser global search';
COMMENT ON INDEX idx_candidates_phone IS 'Optimizes phone search in Excel Browser global search';
