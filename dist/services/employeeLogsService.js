"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmployeeLog = createEmployeeLog;
exports.getEmployeeLog = getEmployeeLog;
exports.getEmployeeLogs = getEmployeeLogs;
exports.getEmployeeLogsForCandidate = getEmployeeLogsForCandidate;
exports.updateEmployeeLog = updateEmployeeLog;
exports.deleteEmployeeLog = deleteEmployeeLog;
exports.flagEmployeeLog = flagEmployeeLog;
exports.getTeamLogs = getTeamLogs;
exports.getEmployeeDailySummary = getEmployeeDailySummary;
exports.getTaskTypes = getTaskTypes;
exports.getTaskType = getTaskType;
exports.createTaskType = createTaskType;
exports.updateTaskType = updateTaskType;
const database_1 = require("../config/database");
// ============ EMPLOYEE LOG FUNCTIONS ============
/**
 * Create a new employee log
 */
async function createEmployeeLog(data) {
    const db = (0, database_1.supabaseAdminClient)();
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
async function getEmployeeLog(logId, employeeId) {
    const db = (0, database_1.supabaseAdminClient)();
    let query = db.from('employee_logs').select(`
    *,
    employee:users!employee_id(name),
    task_type:task_types(name),
    candidate:candidates(name)
    `);
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
async function getEmployeeLogs(employeeId, filters) {
    const db = (0, database_1.supabaseAdminClient)();
    let query = db.from('employee_logs').select(`
    *,
    employee:users!employee_id(name),
    task_type:task_types(name),
    candidate:candidates(name)
    `, { count: 'exact' });
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
    const mappedData = (data || []).map((log) => ({
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
async function getEmployeeLogsForCandidate(candidateId, filters) {
    const db = (0, database_1.supabaseAdminClient)();
    let query = db.from('employee_logs').select(`
    *,
    employee:users!employee_id(name),
    task_type:task_types(name)
    `, { count: 'exact' });
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
    const mappedData = (data || []).map((log) => ({
        ...log,
        employee_name: log.employee?.name,
        task_type: log.task_type?.name,
    }));
    return { data: mappedData, count: count || 0 };
}
/**
 * Update an employee log
 */
async function updateEmployeeLog(logId, updates) {
    const db = (0, database_1.supabaseAdminClient)();
    const updateData = {
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
async function deleteEmployeeLog(logId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { error } = await db.from('employee_logs').delete().eq('id', logId);
    if (error) {
        throw new Error(`Failed to delete employee log: ${error.message}`);
    }
}
/**
 * Flag a log for review
 */
async function flagEmployeeLog(logId, reason) {
    const db = (0, database_1.supabaseAdminClient)();
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
async function getTeamLogs(userId, filters, userRole) {
    const db = (0, database_1.supabaseAdminClient)();
    let query = db.from('employee_logs').select(`
    *,
    employee:users!employee_id(name, department),
    task_type:task_types(name),
    candidate:candidates(name)
    `, { count: 'exact' });
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
    const mappedData = (data || []).map((log) => ({
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
async function getEmployeeDailySummary(userId, filters, userRole) {
    const db = (0, database_1.supabaseAdminClient)();
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
async function getTaskTypes(includeInactive = false) {
    const db = (0, database_1.supabaseAdminClient)();
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
async function getTaskType(taskTypeId) {
    const db = (0, database_1.supabaseAdminClient)();
    const { data, error } = await db.from('task_types').select('*').eq('id', taskTypeId).single();
    if (error && error.code !== 'PGRST116') {
        throw new Error(`Failed to fetch task type: ${error.message}`);
    }
    return data || null;
}
/**
 * Create a new task type
 */
async function createTaskType(data) {
    const db = (0, database_1.supabaseAdminClient)();
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
async function updateTaskType(taskTypeId, updates) {
    const db = (0, database_1.supabaseAdminClient)();
    const updateData = {
        ...updates,
        updated_at: new Date().toISOString(),
    };
    const { data, error } = await db.from('task_types').update(updateData).eq('id', taskTypeId).select().single();
    if (error) {
        throw new Error(`Failed to update task type: ${error.message}`);
    }
    return data;
}
