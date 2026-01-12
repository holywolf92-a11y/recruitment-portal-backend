"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmployerController = createEmployerController;
exports.getEmployerController = getEmployerController;
exports.listEmployersController = listEmployersController;
exports.updateEmployerController = updateEmployerController;
exports.deleteEmployerController = deleteEmployerController;
const employerService_1 = require("../services/employerService");
async function createEmployerController(req, res) {
    try {
        const userId = 'test-user-id';
        const employerData = req.body;
        if (!employerData.company_name) {
            return res.status(400).json({ error: 'Company name is required' });
        }
        const employer = await (0, employerService_1.createEmployer)(employerData, userId);
        res.status(201).json({ employer });
    }
    catch (error) {
        console.error('Error creating employer:', error);
        if (error.message?.includes('already exists')) {
            res.status(409).json({ error: error.message });
        }
        else {
            res.status(400).json({ error: error.message || 'Failed to create employer' });
        }
    }
}
async function getEmployerController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Employer ID is required' });
        }
        const employer = await (0, employerService_1.getEmployerById)(id, userId);
        res.json({ employer });
    }
    catch (error) {
        console.error('Error fetching employer:', error);
        if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Employer not found' });
        }
        else {
            res.status(500).json({ error: 'Failed to fetch employer' });
        }
    }
}
async function listEmployersController(req, res) {
    try {
        const userId = 'test-user-id';
        const filters = {
            search: req.query.search,
            limit: req.query.limit ? parseInt(req.query.limit) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset) : undefined,
        };
        const result = await (0, employerService_1.listEmployers)(filters, userId);
        res.json(result);
    }
    catch (error) {
        console.error('Error listing employers:', error);
        res.status(500).json({ error: 'Failed to fetch employers' });
    }
}
async function updateEmployerController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Employer ID is required' });
        }
        const updateData = req.body;
        const employer = await (0, employerService_1.updateEmployer)(id, updateData, userId);
        res.json({ employer });
    }
    catch (error) {
        console.error('Error updating employer:', error);
        if (error.message?.includes('already exists')) {
            res.status(409).json({ error: error.message });
        }
        else if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Employer not found' });
        }
        else {
            res.status(400).json({ error: error.message || 'Failed to update employer' });
        }
    }
}
async function deleteEmployerController(req, res) {
    try {
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Employer ID is required' });
        }
        await (0, employerService_1.deleteEmployer)(id, userId);
        res.json({ message: 'Employer deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting employer:', error);
        if (error.message?.includes('Cannot delete employer')) {
            res.status(409).json({ error: error.message });
        }
        else if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Employer not found' });
        }
        else {
            res.status(500).json({ error: 'Failed to delete employer' });
        }
    }
}
