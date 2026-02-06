-- 029_create_rls_policies_employee_logs.sql
-- RLS policies for employee_logs and task_types tables

-- Enable RLS on both tables
ALTER TABLE task_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_logs ENABLE ROW LEVEL SECURITY;

-- task_types policies
-- Everyone can read active task types
DROP POLICY IF EXISTS task_types_select_active ON task_types;
CREATE POLICY task_types_select_active ON task_types FOR SELECT USING (is_active = true);

-- Only admin can insert/update/delete task types
DROP POLICY IF EXISTS task_types_insert_admin_only ON task_types;
CREATE POLICY task_types_insert_admin_only ON task_types FOR INSERT WITH CHECK (auth.role() = 'admin');
DROP POLICY IF EXISTS task_types_update_admin_only ON task_types;
CREATE POLICY task_types_update_admin_only ON task_types FOR UPDATE USING (auth.role() = 'admin');
DROP POLICY IF EXISTS task_types_delete_admin_only ON task_types;
CREATE POLICY task_types_delete_admin_only ON task_types FOR DELETE USING (auth.role() = 'admin');

-- employee_logs policies
-- Employees can insert their own logs
DROP POLICY IF EXISTS employee_logs_insert ON employee_logs;
CREATE POLICY employee_logs_insert ON employee_logs FOR INSERT WITH CHECK (
  auth.uid() = employee_id
);

-- Employees can select their own logs
DROP POLICY IF EXISTS employee_logs_select_own ON employee_logs;
CREATE POLICY employee_logs_select_own ON employee_logs FOR SELECT USING (
  auth.uid() = employee_id
);

-- Managers and admins can select all logs for team members
DROP POLICY IF EXISTS employee_logs_select_manager_admin ON employee_logs;
CREATE POLICY employee_logs_select_manager_admin ON employee_logs FOR SELECT USING (
  auth.role() = 'manager' OR auth.role() = 'admin'
);

-- Employees can update their own logs (same day only - enforced at backend)
DROP POLICY IF EXISTS employee_logs_update_own ON employee_logs;
CREATE POLICY employee_logs_update_own ON employee_logs FOR UPDATE USING (
  auth.uid() = employee_id AND auth.uid() = created_by
);

-- Admins can update any log for review/approval
DROP POLICY IF EXISTS employee_logs_update_admin ON employee_logs;
CREATE POLICY employee_logs_update_admin ON employee_logs FOR UPDATE USING (
  auth.role() = 'admin'
);

-- Soft delete: employees cannot delete, only admins can (flagging instead of deleting is preferred)
DROP POLICY IF EXISTS employee_logs_delete_admin_only ON employee_logs;
CREATE POLICY employee_logs_delete_admin_only ON employee_logs FOR DELETE USING (
  auth.role() = 'admin'
);

