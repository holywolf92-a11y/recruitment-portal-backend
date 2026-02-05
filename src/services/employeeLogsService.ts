import { supabaseAdminClient } from '../config/database';

// ============ TYPES ============

export interface EmployeeLog {
  id: string;
  employee_id: string;
  candidate_id: string;
  task_type_id: string;
  description: string;
  time_spent_minutes: number;
  status: string;
  log_date: string;
  attachment_url?: string;
  is_flagged: boolean;
  flag_reason?: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  reviewed_by?: string;
  reviewed_at?: string;
  // Joined fields
  employee_name?: string;
  task_type?: string;
  candidate_name?: string;
}

export interface CreateEmployeeLogData {
  employee_id: string;
  candidate_id: string;
  task_type_id: string;
  description: string;
  time_spent_minutes?: number;
  status?: string;
  log_date?: string;
  attachment_url?: string;
  created_by: string;
}

export interface TaskType {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ============ EMPLOYEE LOG FUNCTIONS ============

/**
 * Create a new employee log
 */
export async function createEmployeeLog(data: CreateEmployeeLogData): Promise<EmployeeLog> {
  const db = supabaseAdminClient();

  const logData = {
    employee_id: data.employee_id,
    candidate_id: data.candidate_id,
    task_type_id: data.task_type_id,
    description: data.description.trim(),
    time_spent_minutes: data.time_spent_minutes || 0,
    status: data.status || 'completed',
    log_date: data.log_date || new Date().toISOString().split('T')[0],
    attachment_url: data.attachment_url || null,
    created_by: data.created_by,
    is_flagged: false,
  };

  const { data: result, error } = await db
    .from('employee_logs')
    .insert([logData])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create employee log: ${error.message}`);
  }

  return result;
}

/**
 * Get a specific employee log by ID
 */
export async function getEmployeeLog(logId: string, employeeId?: string): Promise<EmployeeLog | null> {
  const db = supabaseAdminClient();

  let query = db.from('employee_logs').select(
    `
    *,
    employee:users!employee_id(name),
    task_type:task_types(name),
    candidate:candidates(name)
    `
  );

  if (employeeId) {
    query = query.eq('employee_id', employeeId);
  }

  const { data, error } = await query.eq('id', logId).single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch employee log: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    ...data,
    employee_name: data.employee?.name,
    task_type: data.task_type?.name,
    candidate_name: data.candidate?.name,
  };
}

/**
 * Get employee's logs with filters
 */
export async function getEmployeeLogs(
  employeeId: string,
  filters: {
    startDate?: string;
    endDate?: string;
    candidateId?: string;
    taskTypeId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ data: EmployeeLog[]; count: number }> {
  const db = supabaseAdminClient();

  let query = db.from('employee_logs').select(
    `
    *,
    employee:users!employee_id(name),
    task_type:task_types(name),
    candidate:candidates(name)
    `,
    { count: 'exact' }
  );

  query = query.eq('employee_id', employeeId);

  if (filters.startDate) {
    query = query.gte('log_date', filters.startDate);
  }

  if (filters.endDate) {
    query = query.lte('log_date', filters.endDate);
  }

  if (filters.candidateId) {
    query = query.eq('candidate_id', filters.candidateId);
  }

  if (filters.taskTypeId) {
    query = query.eq('task_type_id', filters.taskTypeId);
  }

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  query = query.order('log_date', { ascending: false }).order('created_at', { ascending: false });

  if (filters.limit) {
    query = query.limit(filters.limit);
  }

  if (filters.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch employee logs: ${error.message}`);
  }

  const mappedData = (data || []).map((log: any) => ({
    ...log,
    employee_name: log.employee?.name,
    task_type: log.task_type?.name,
    candidate_name: log.candidate?.name,
  }));

  return { data: mappedData, count: count || 0 };
}

/**
 * Get logs for a candidate (employee activity timeline)
 */
export async function getEmployeeLogsForCandidate(
  candidateId: string,
  filters: {
    limit?: number;
    offset?: number;
  }
): Promise<{ data: EmployeeLog[]; count: number }> {
  const db = supabaseAdminClient();

  let query = db.from('employee_logs').select(
    `
    *,
    employee:users!employee_id(name),
    task_type:task_types(name)
    `,
    { count: 'exact' }
  );

  query = query.eq('candidate_id', candidateId).order('log_date', { ascending: false }).order('created_at', { ascending: false });

  if (filters.limit) {
    query = query.limit(filters.limit);
  }

  if (filters.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 100) - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch candidate employee logs: ${error.message}`);
  }

  const mappedData = (data || []).map((log: any) => ({
    ...log,
    employee_name: log.employee?.name,
    task_type: log.task_type?.name,
  }));

  return { data: mappedData, count: count || 0 };
}

/**
 * Update an employee log
 */
export async function updateEmployeeLog(logId: string, updates: Partial<EmployeeLog>): Promise<EmployeeLog> {
  const db = supabaseAdminClient();

  const updateData: any = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  // Prevent certain fields from being updated
  delete updateData.id;
  delete updateData.employee_id;
  delete updateData.created_by;
  delete updateData.created_at;

  const { data, error } = await db.from('employee_logs').update(updateData).eq('id', logId).select().single();

  if (error) {
    throw new Error(`Failed to update employee log: ${error.message}`);
  }

  return data;
}

/**
 * Soft delete or flag an employee log
 */
export async function deleteEmployeeLog(logId: string): Promise<void> {
  const db = supabaseAdminClient();

  const { error } = await db.from('employee_logs').delete().eq('id', logId);

  if (error) {
    throw new Error(`Failed to delete employee log: ${error.message}`);
  }
}

/**
 * Flag a log for review
 */
export async function flagEmployeeLog(logId: string, reason: string): Promise<EmployeeLog> {
  const db = supabaseAdminClient();

  const { data, error } = await db
    .from('employee_logs')
    .update({
      is_flagged: true,
      flag_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', logId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to flag employee log: ${error.message}`);
  }

  return data;
}

// ============ TEAM LOGS FUNCTIONS ============

/**
 * Get team logs (for managers/admins)
 */
export async function getTeamLogs(
  userId: string,
  filters: {
    startDate?: string;
    endDate?: string;
    employeeId?: string;
    candidateId?: string;
    taskTypeId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  },
  userRole: string
): Promise<{ data: EmployeeLog[]; count: number }> {
  const db = supabaseAdminClient();

  let query = db.from('employee_logs').select(
    `
    *,
    employee:users!employee_id(name, department),
    task_type:task_types(name),
    candidate:candidates(name)
    `,
    { count: 'exact' }
  );

  // Admins see all, managers see their team only
  if (userRole !== 'admin') {
    // For now, if manager, filter by assigned team
    // This could be expanded based on team structure
  }

  if (filters.startDate) {
    query = query.gte('log_date', filters.startDate);
  }

  if (filters.endDate) {
    query = query.lte('log_date', filters.endDate);
  }

  if (filters.employeeId) {
    query = query.eq('employee_id', filters.employeeId);
  }

  if (filters.candidateId) {
    query = query.eq('candidate_id', filters.candidateId);
  }

  if (filters.taskTypeId) {
    query = query.eq('task_type_id', filters.taskTypeId);
  }

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  query = query.order('log_date', { ascending: false }).order('created_at', { ascending: false });

  if (filters.limit) {
    query = query.limit(filters.limit);
  }

  if (filters.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 100) - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch team logs: ${error.message}`);
  }

  const mappedData = (data || []).map((log: any) => ({
    ...log,
    employee_name: log.employee?.name,
    task_type: log.task_type?.name,
    candidate_name: log.candidate?.name,
  }));

  return { data: mappedData, count: count || 0 };
}

/**
 * Get employee daily summary (for reporting)
 */
export async function getEmployeeDailySummary(
  userId: string,
  filters: {
    startDate?: string;
    endDate?: string;
    employeeId?: string;
  },
  userRole: string
): Promise<any[]> {
  const db = supabaseAdminClient();

  let query = db.from('employee_daily_summary').select('*');

  if (filters.startDate) {
    query = query.gte('log_date', filters.startDate);
  }

  if (filters.endDate) {
    query = query.lte('log_date', filters.endDate);
  }

  if (filters.employeeId) {
    query = query.eq('employee_id', filters.employeeId);
  }

  query = query.order('log_date', { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch employee daily summary: ${error.message}`);
  }

  return data || [];
}

// ============ TASK TYPES FUNCTIONS ============

/**
 * Get all task types
 */
export async function getTaskTypes(includeInactive: boolean = false): Promise<TaskType[]> {
  const db = supabaseAdminClient();

  let query = db.from('task_types').select('*');

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  query = query.order('name', { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch task types: ${error.message}`);
  }

  return data || [];
}

/**
 * Get a specific task type
 */
export async function getTaskType(taskTypeId: string): Promise<TaskType | null> {
  const db = supabaseAdminClient();

  const { data, error } = await db.from('task_types').select('*').eq('id', taskTypeId).single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch task type: ${error.message}`);
  }

  return data || null;
}

/**
 * Create a new task type
 */
export async function createTaskType(data: { name: string; description?: string }): Promise<TaskType> {
  const db = supabaseAdminClient();

  const taskTypeData = {
    name: data.name.trim(),
    description: data.description?.trim() || null,
    is_active: true,
  };

  const { data: result, error } = await db
    .from('task_types')
    .insert([taskTypeData])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create task type: ${error.message}`);
  }

  return result;
}

/**
 * Update a task type
 */
export async function updateTaskType(
  taskTypeId: string,
  updates: Partial<{ name: string; description: string; is_active: boolean }>
): Promise<TaskType> {
  const db = supabaseAdminClient();

  const updateData: any = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db.from('task_types').update(updateData).eq('id', taskTypeId).select().single();

  if (error) {
    throw new Error(`Failed to update task type: ${error.message}`);
  }

  return data;
}
