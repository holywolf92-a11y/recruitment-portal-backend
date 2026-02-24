-- P1: Add DB-side lookup indexes for hot query paths in CandidateMatcher.
--
-- 1. candidates.phone  — used by Priority-4 E.164 phone lookup (eq filter).
--    Already stored in E.164 format so a plain btree index is sufficient.
--
-- 2. candidates.name (lower-case expression) — used by the batched name-matching
--    query.  Speeds up the in-process filter that ILIKE-scans 1,000s of names.
--    (The actual fuzzy filter runs in Node, but the DB only returns non-null/non-deleted
--    rows so this partial index trimms the scan.)
--
-- Both are partial indexes (exclude NULL / Deleted) to stay lean.

-- Index 1: phone — exact E.164 lookup
CREATE INDEX IF NOT EXISTS candidates_phone_idx
  ON candidates (phone)
  WHERE phone IS NOT NULL AND status IS DISTINCT FROM 'Deleted';

-- Index 2: lower(name) — supports the batched name-based soft-signal query
CREATE INDEX IF NOT EXISTS candidates_name_lower_idx
  ON candidates (lower(name))
  WHERE name IS NOT NULL AND status IS DISTINCT FROM 'Deleted';

-- Index 3: date_of_birth — speeds up the name+DOB in-memory scan
--   (DB returns fewer rows when date_of_birth is not null)
CREATE INDEX IF NOT EXISTS candidates_dob_idx
  ON candidates (date_of_birth)
  WHERE date_of_birth IS NOT NULL AND status IS DISTINCT FROM 'Deleted';
