-- 006_create_rls_policies_users.sql

-- Users table: only user himself or admin/manager can read/update; only admin can insert
CREATE POLICY users_select_self_or_admin ON users FOR SELECT USING (auth.uid() = id OR auth.role() = 'admin');
CREATE POLICY users_update_self_or_admin ON users FOR UPDATE USING (auth.uid() = id OR auth.role() = 'admin');
CREATE POLICY users_insert_admin_only ON users FOR INSERT WITH CHECK (auth.role() = 'admin');

-- NOTE: Replace auth.uid() and auth.role() with the actual functions/claims in your Postgres/Supabase setup.
