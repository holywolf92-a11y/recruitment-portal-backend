-- 028_create_employee_logs.sql
-- Employee Task Log & Daily Work Logbook System

-- task_types table (predefined, managed by admin)
CREATE TABLE IF NOT EXISTS task_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default task types
INSERT INTO task_types (name, description, is_active) VALUES
  ('CV screening', 'Screening and review of candidate CV', true),
  ('Candidate call', 'Phone or video call with candidate', true),
  ('Document follow-up', 'Following up on missing or incomplete documents', true),
  ('Passport verification', 'Verifying passport details and authenticity', true),
  ('Medical coordination', 'Coordinating medical tests and health checks', true),
  ('Employer submission', 'Submitting candidate details to employer', true),
  ('Interview scheduling', 'Scheduling interviews with candidates', true),
  ('Visa documentation', 'Preparing and managing visa documentation', true),
  ('Other', 'Other administrative tasks', true)
ON CONFLICT (name) DO NOTHING;

-- employee_logs table (main audit log)
CREATE TABLE IF NOT EXISTS employee_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
  task_type_id UUID NOT NULL REFERENCES task_types(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  time_spent_minutes INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'completed', -- completed, pending, cancelled
  log_date DATE NOT NULL,
  attachment_url TEXT,
  is_flagged BOOLEAN DEFAULT false,
  flag_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_employee_logs_employee_id ON employee_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_logs_candidate_id ON employee_logs(candidate_id);
CREATE INDEX IF NOT EXISTS idx_employee_logs_task_type_id ON employee_logs(task_type_id);
CREATE INDEX IF NOT EXISTS idx_employee_logs_log_date ON employee_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_employee_logs_employee_date ON employee_logs(employee_id, log_date);
CREATE INDEX IF NOT EXISTS idx_employee_logs_candidate_date ON employee_logs(candidate_id, log_date);

-- View for employee productivity summary (optional, for reporting)
CREATE OR REPLACE VIEW employee_daily_summary AS
SELECT
  el.employee_id,
  u.name as employee_name,
  el.log_date,
  COUNT(*) as total_logs,
  COUNT(DISTINCT el.candidate_id) as unique_candidates,
  SUM(el.time_spent_minutes) as total_time_spent
FROM employee_logs el
JOIN users u ON el.employee_id = u.id
GROUP BY el.employee_id, u.name, el.log_date;

-- View for candidate activity timeline
CREATE OR REPLACE VIEW candidate_employee_activity AS
SELECT
  el.id,
  el.candidate_id,
  el.log_date,
  el.description,
  el.time_spent_minutes,
  el.status,
  u.name as employee_name,
  tt.name as task_type,
  el.created_at
FROM employee_logs el
JOIN users u ON el.employee_id = u.id
JOIN task_types tt ON el.task_type_id = tt.id
ORDER BY el.log_date DESC, el.created_at DESC;
