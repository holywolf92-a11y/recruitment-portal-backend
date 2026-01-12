-- 005_create_rls_policies_standard.sql

-- Example policy: authenticated users can select their own candidates or all if role is manager/admin
-- NOTE: Adapt policies to your Supabase auth claims (e.g., auth.role or custom claims)

-- Allow authenticated selects (placeholder, refine per-table)
CREATE POLICY select_candidates_authenticated ON candidates FOR SELECT USING (auth.role() IS NOT NULL);

-- You should replace auth.role() checks with your actual JWT claims logic
