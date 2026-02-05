"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmployeeLogController = createEmployeeLogController;
exports.getEmployeeLogsController = getEmployeeLogsController;
exports.getEmployeeLogController = getEmployeeLogController;
exports.updateEmployeeLogController = updateEmployeeLogController;
exports.deleteEmployeeLogController = deleteEmployeeLogController;
exports.getTeamLogsController = getTeamLogsController;
exports.getEmployeeDailySummaryController = getEmployeeDailySummaryController;
exports.getCandidateEmployeeActivityController = getCandidateEmployeeActivityController;
exports.getTaskTypesController = getTaskTypesController;
exports.createTaskTypeController = createTaskTypeController;
const employeeLogsService_1 = require("../services/employeeLogsService");
// ============ EMPLOYEE LOG HANDLERS ============
async function createEmployeeLogController(req, res) {
    try {
        const employeeId = req.user?.id;
        if (!employeeId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }
        const logData = {
            ...req.body,
            employee_id: employeeId,
            created_by: employeeId,
        };
        // Validate required fields
        if (!logData.candidate_id) {
            return res.status(400).json({ error: 'candidate_id is required' });
        }
        if (!logData.task_type_id) {
            return res.status(400).json({ error: 'task_type_id is required' });
        }
        if (!logData.description || logData.description.trim() === '') {
            return res.status(400).json({ error: 'description is required' });
        }
        // Default log_date to today
        if (!logData.log_date) {
            logData.log_date = new Date().toISOString().split('T')[0];
        }
        const log = await (0, employeeLogsService_1.createEmployeeLog)(logData);
        res.status(201).json({ success: true, data: log });
    }
    catch (error) {
        console.error('Error creating employee log:', error);
        res.status(400).json({ error: error.message || 'Failed to create employee log' });
    }
}
async function getEmployeeLogsController(req, res) {
    try {
        const employeeId = req.user?.id;
        if (!employeeId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            candidateId: req.query.candidateId,
            taskTypeId: req.query.taskTypeId,
            status: req.query.status,
            limit: req.query.limit ? parseInt(req.query.limit) : 50,
            offset: req.query.offset ? parseInt(req.query.offset) : 0,
        };
        const result = await (0, employeeLogsService_1.getEmployeeLogs)(employeeId, filters);
        res.json(result);
    }
    catch (error) {
        console.error('Error fetching employee logs:', error);
        res.status(500).json({ error: 'Failed to fetch employee logs' });
    }
}
async function getEmployeeLogController(req, res) {
    try {
        const { id } = req.params;
        const employeeId = req.user?.id;
        if (!id) {
            return res.status(400).json({ error: 'Log ID is required' });
        }
        const log = await (0, employeeLogsService_1.getEmployeeLog)(id, employeeId);
        if (!log) {
            return res.status(404).json({ error: 'Log not found' });
        }
        res.json({ success: true, data: log });
    }
    catch (error) {
        console.error('Error fetching employee log:', error);
        res.status(500).json({ error: 'Failed to fetch employee log' });
    }
}
async function updateEmployeeLogController(req, res) {
    try {
        const { id } = req.params;
        const employeeId = req.user?.id;
        if (!id) {
            return res.status(400).json({ error: 'Log ID is required' });
        }
        if (!employeeId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }
        // Get existing log to check permissions and date
        const existingLog = await (0, employeeLogsService_1.getEmployeeLog)(id, employeeId);
        if (!existingLog) {
            return res.status(404).json({ error: 'Log not found' });
        }
        // Check if employee can edit (only same-day edits allowed)
        const logDate = new Date(existingLog.log_date);
        const today = new Date();
        const isSameDay = logDate.getFullYear() === today.getFullYear() &&
            logDate.getMonth() === today.getMonth() &&
            logDate.getDate() === today.getDate();
        if (!isSameDay && existingLog.employee_id !== employeeId) {
            return res.status(403).json({
                error: 'Can only edit logs from today. Please contact your manager to modify past logs.',
            });
        }
        const updatedLog = await (0, employeeLogsService_1.updateEmployeeLog)(id, req.body);
        res.json({ success: true, data: updatedLog });
    }
    catch (error) {
        console.error('Error updating employee log:', error);
        res.status(400).json({ error: error.message || 'Failed to update employee log' });
    }
}
async function deleteEmployeeLogController(req, res) {
    try {
        const { id } = req.params;
        const employeeId = req.user?.id;
        const userRole = req.user?.role;
        if (!id) {
            return res.status(400).json({ error: 'Log ID is required' });
        }
        // Only admins can delete; prefer soft delete via flagging
        if (userRole !== 'admin') {
            return res.status(403).json({
                error: 'Only admins can delete logs. Consider flagging the log instead.',
            });
        }
        const result = await (0, employeeLogsService_1.deleteEmployeeLog)(id);
        res.json({ success: true, message: 'Log deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting employee log:', error);
        res.status(500).json({ error: error.message || 'Failed to delete employee log' });
    }
}
// ============ TEAM LOGS HANDLERS (Manager/Admin) ============
async function getTeamLogsController(req, res) {
    try {
        const userRole = req.user?.role;
        const userId = req.user?.id;
        if (!userRole || (userRole !== 'manager' && userRole !== 'admin')) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            employeeId: req.query.employeeId,
            candidateId: req.query.candidateId,
            taskTypeId: req.query.taskTypeId,
            status: req.query.status,
            limit: req.query.limit ? parseInt(req.query.limit) : 100,
            offset: req.query.offset ? parseInt(req.query.offset) : 0,
        };
        const result = await (0, employeeLogsService_1.getTeamLogs)(userId, filters, userRole);
        res.json(result);
    }
    catch (error) {
        console.error('Error fetching team logs:', error);
        res.status(500).json({ error: 'Failed to fetch team logs' });
    }
}
async function getEmployeeDailySummaryController(req, res) {
    try {
        const userRole = req.user?.role;
        const userId = req.user?.id;
        if (!userRole || (userRole !== 'manager' && userRole !== 'admin')) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            employeeId: req.query.employeeId,
        };
        const result = await (0, employeeLogsService_1.getEmployeeDailySummary)(userId, filters, userRole);
        res.json(result);
    }
    catch (error) {
        console.error('Error fetching employee daily summary:', error);
        res.status(500).json({ error: 'Failed to fetch employee daily summary' });
    }
}
// ============ CANDIDATE ACTIVITY HANDLERS ============
async function getCandidateEmployeeActivityController(req, res) {
    try {
        const { candidateId } = req.params;
        if (!candidateId) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const filters = {
            limit: req.query.limit ? parseInt(req.query.limit) : 100,
            offset: req.query.offset ? parseInt(req.query.offset) : 0,
        };
        const result = await (0, employeeLogsService_1.getEmployeeLogsForCandidate)(candidateId, filters);
        res.json(result);
    }
    catch (error) {
        console.error('Error fetching candidate employee activity:', error);
        res.status(500).json({ error: 'Failed to fetch candidate employee activity' });
    }
}
// ============ TASK TYPE HANDLERS ============
async function getTaskTypesController(req, res) {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const taskTypes = await (0, employeeLogsService_1.getTaskTypes)(includeInactive);
        res.json({ success: true, data: taskTypes });
    }
    catch (error) {
        console.error('Error fetching task types:', error);
        res.status(500).json({ error: 'Failed to fetch task types' });
    }
}
async function createTaskTypeController(req, res) {
    try {
        const userRole = req.user?.role;
        if (userRole !== 'admin') {
            return res.status(403).json({ error: 'Only admins can create task types' });
        }
        const { name, description } = req.body;
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Task type name is required' });
        }
        const taskType = await (0, employeeLogsService_1.createTaskType)({ name, description });
        res.status(201).json({ success: true, data: taskType });
    }
    catch (error) {
        console.error('Error creating task type:', error);
        res.status(400).json({ error: error.message || 'Failed to create task type' });
    }
}
