import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createEmployeeLogController,
  getEmployeeLogsController,
  getEmployeeLogController,
  updateEmployeeLogController,
  deleteEmployeeLogController,
  getTeamLogsController,
  getEmployeeDailySummaryController,
  getCandidateEmployeeActivityController,
  getTaskTypesController,
  createTaskTypeController,
} from '../controllers/employeeLogsController';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ============ EMPLOYEE LOG ROUTES ============
// Create a new daily log
router.post('/logs', createEmployeeLogController);

// Get current employee's logs
router.get('/logs', getEmployeeLogsController);

// Get specific log by ID
router.get('/logs/:id', getEmployeeLogController);

// Update an employee log
router.put('/logs/:id', updateEmployeeLogController);

// Delete an employee log (admin only)
router.delete('/logs/:id', deleteEmployeeLogController);

// ============ TEAM LOGS ROUTES (Manager/Admin) ============
// Get team logs with filters
router.get('/team/logs', getTeamLogsController);

// Get employee daily summary for reporting
router.get('/team/summary', getEmployeeDailySummaryController);

// ============ CANDIDATE ACTIVITY ROUTES ============
// Get all logs for a specific candidate
router.get('/candidate/:candidateId/activity', getCandidateEmployeeActivityController);

// ============ TASK TYPE ROUTES ============
// Get all task types
router.get('/task-types', getTaskTypesController);

// Create a new task type (admin only)
router.post('/task-types', createTaskTypeController);

export default router;
