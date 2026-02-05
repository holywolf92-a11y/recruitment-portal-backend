"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const employeeLogsController_1 = require("../controllers/employeeLogsController");
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_1.authenticate);
// ============ EMPLOYEE LOG ROUTES ============
// Create a new daily log
router.post('/logs', employeeLogsController_1.createEmployeeLogController);
// Get current employee's logs
router.get('/logs', employeeLogsController_1.getEmployeeLogsController);
// Get specific log by ID
router.get('/logs/:id', employeeLogsController_1.getEmployeeLogController);
// Update an employee log
router.put('/logs/:id', employeeLogsController_1.updateEmployeeLogController);
// Delete an employee log (admin only)
router.delete('/logs/:id', employeeLogsController_1.deleteEmployeeLogController);
// ============ TEAM LOGS ROUTES (Manager/Admin) ============
// Get team logs with filters
router.get('/team/logs', employeeLogsController_1.getTeamLogsController);
// Get employee daily summary for reporting
router.get('/team/summary', employeeLogsController_1.getEmployeeDailySummaryController);
// ============ CANDIDATE ACTIVITY ROUTES ============
// Get all logs for a specific candidate
router.get('/candidate/:candidateId/activity', employeeLogsController_1.getCandidateEmployeeActivityController);
// ============ TASK TYPE ROUTES ============
// Get all task types
router.get('/task-types', employeeLogsController_1.getTaskTypesController);
// Create a new task type (admin only)
router.post('/task-types', employeeLogsController_1.createTaskTypeController);
exports.default = router;
