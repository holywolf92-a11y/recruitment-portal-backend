import { Request, Response } from 'express';
import {
  createEmployeeLog,
  getEmployeeLog,
  getEmployeeLogs,
  getTeamLogs,
  updateEmployeeLog,
  deleteEmployeeLog,
  getTaskTypes,
  createTaskType,
  getEmployeeLogsForCandidate,
  getEmployeeDailySummary,
  CreateEmployeeLogData,
} from '../services/employeeLogsService';

// Type definition for authenticated request
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role?: string;
    email?: string;
  };
}

// ============ EMPLOYEE LOG HANDLERS ============

export async function createEmployeeLogController(req: AuthenticatedRequest, res: Response) {
  try {
    const employeeId = req.user?.id;
    if (!employeeId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const logData: CreateEmployeeLogData = {
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

    const log = await createEmployeeLog(logData);
    res.status(201).json({ success: true, data: log });
  } catch (error: any) {
    console.error('Error creating employee log:', error);
    res.status(400).json({ error: error.message || 'Failed to create employee log' });
  }
}

export async function getEmployeeLogsController(req: AuthenticatedRequest, res: Response) {
  try {
    const employeeId = req.user?.id;
    if (!employeeId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const filters = {
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      candidateId: req.query.candidateId as string,
      taskTypeId: req.query.taskTypeId as string,
      status: req.query.status as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };

    const result = await getEmployeeLogs(employeeId, filters);
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching employee logs:', error);
    res.status(500).json({ error: 'Failed to fetch employee logs' });
  }
}

export async function getEmployeeLogController(req: AuthenticatedRequest, res: Response) {
  try {
    const { id } = req.params;
    const employeeId = req.user?.id;

    if (!id) {
      return res.status(400).json({ error: 'Log ID is required' });
    }

    const log = await getEmployeeLog(id, employeeId);
    if (!log) {
      return res.status(404).json({ error: 'Log not found' });
    }

    res.json({ success: true, data: log });
  } catch (error: any) {
    console.error('Error fetching employee log:', error);
    res.status(500).json({ error: 'Failed to fetch employee log' });
  }
}

export async function updateEmployeeLogController(req: AuthenticatedRequest, res: Response) {
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
    const existingLog = await getEmployeeLog(id, employeeId);
    if (!existingLog) {
      return res.status(404).json({ error: 'Log not found' });
    }

    // Check if employee can edit (only same-day edits allowed)
    const logDate = new Date(existingLog.log_date);
    const today = new Date();
    const isSameDay =
      logDate.getFullYear() === today.getFullYear() &&
      logDate.getMonth() === today.getMonth() &&
      logDate.getDate() === today.getDate();

    if (!isSameDay && existingLog.employee_id !== employeeId) {
      return res.status(403).json({
        error: 'Can only edit logs from today. Please contact your manager to modify past logs.',
      });
    }

    const updatedLog = await updateEmployeeLog(id, req.body);
    res.json({ success: true, data: updatedLog });
  } catch (error: any) {
    console.error('Error updating employee log:', error);
    res.status(400).json({ error: error.message || 'Failed to update employee log' });
  }
}

export async function deleteEmployeeLogController(req: AuthenticatedRequest, res: Response) {
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

    const result = await deleteEmployeeLog(id);
    res.json({ success: true, message: 'Log deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting employee log:', error);
    res.status(500).json({ error: error.message || 'Failed to delete employee log' });
  }
}

// ============ TEAM LOGS HANDLERS (Manager/Admin) ============

export async function getTeamLogsController(req: AuthenticatedRequest, res: Response) {
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
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      employeeId: req.query.employeeId as string,
      candidateId: req.query.candidateId as string,
      taskTypeId: req.query.taskTypeId as string,
      status: req.query.status as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };

    const result = await getTeamLogs(userId, filters, userRole);
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching team logs:', error);
    res.status(500).json({ error: 'Failed to fetch team logs' });
  }
}

export async function getEmployeeDailySummaryController(req: AuthenticatedRequest, res: Response) {
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
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      employeeId: req.query.employeeId as string,
    };

    const result = await getEmployeeDailySummary(userId, filters, userRole);
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching employee daily summary:', error);
    res.status(500).json({ error: 'Failed to fetch employee daily summary' });
  }
}

// ============ CANDIDATE ACTIVITY HANDLERS ============

export async function getCandidateEmployeeActivityController(req: AuthenticatedRequest, res: Response) {
  try {
    const { candidateId } = req.params;

    if (!candidateId) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    const filters = {
      limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };

    const result = await getEmployeeLogsForCandidate(candidateId, filters);
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching candidate employee activity:', error);
    res.status(500).json({ error: 'Failed to fetch candidate employee activity' });
  }
}

// ============ TASK TYPE HANDLERS ============

export async function getTaskTypesController(req: AuthenticatedRequest, res: Response) {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const taskTypes = await getTaskTypes(includeInactive);
    res.json({ success: true, data: taskTypes });
  } catch (error: any) {
    console.error('Error fetching task types:', error);
    res.status(500).json({ error: 'Failed to fetch task types' });
  }
}

export async function createTaskTypeController(req: AuthenticatedRequest, res: Response) {
  try {
    const userRole = req.user?.role;

    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create task types' });
    }

    const { name, description } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Task type name is required' });
    }

    const taskType = await createTaskType({ name, description });
    res.status(201).json({ success: true, data: taskType });
  } catch (error: any) {
    console.error('Error creating task type:', error);
    res.status(400).json({ error: error.message || 'Failed to create task type' });
  }
}
