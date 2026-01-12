"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCandidateController = createCandidateController;
exports.getCandidateController = getCandidateController;
exports.listCandidatesController = listCandidatesController;
exports.updateCandidateController = updateCandidateController;
exports.deleteCandidateController = deleteCandidateController;
// import { AuthRequest } from '../middleware/auth';
const candidateService_1 = require("../services/candidateService");
async function createCandidateController(req, res) {
    try {
        // For now, use a placeholder user ID for testing
        const userId = 'test-user-id';
        const candidateData = req.body;
        // Basic validation
        if (!candidateData.name || candidateData.name.trim().length === 0) {
            return res.status(400).json({ error: 'Candidate name is required' });
        }
        const candidate = await (0, candidateService_1.createCandidate)(candidateData, userId);
        res.status(201).json({ candidate });
    }
    catch (error) {
        console.error('Error creating candidate:', error);
        res.status(400).json({ error: error.message || 'Failed to create candidate' });
    }
}
async function getCandidateController(req, res) {
    try {
        // For now, use a placeholder user ID for testing
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const candidate = await (0, candidateService_1.getCandidateById)(id, userId);
        res.json({ candidate });
    }
    catch (error) {
        console.error('Error fetching candidate:', error);
        if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Candidate not found' });
        }
        else {
            res.status(500).json({ error: 'Failed to fetch candidate' });
        }
    }
}
async function listCandidatesController(req, res) {
    try {
        // For now, use a placeholder user ID for testing
        const userId = 'test-user-id';
        const filters = {
            search: req.query.search,
            status: req.query.status,
            limit: req.query.limit ? parseInt(req.query.limit) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset) : undefined,
        };
        const result = await (0, candidateService_1.listCandidates)(filters, userId);
        res.json(result);
    }
    catch (error) {
        console.error('Error listing candidates:', error);
        res.status(500).json({ error: 'Failed to fetch candidates' });
    }
}
async function updateCandidateController(req, res) {
    try {
        // For now, use a placeholder user ID for testing
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const updateData = req.body;
        // Basic validation
        if (updateData.name !== undefined && (!updateData.name || updateData.name.trim().length === 0)) {
            return res.status(400).json({ error: 'Candidate name cannot be empty' });
        }
        const candidate = await (0, candidateService_1.updateCandidate)(id, updateData, userId);
        res.json({ candidate });
    }
    catch (error) {
        console.error('Error updating candidate:', error);
        if (error.message?.includes('Duplicate candidate found')) {
            res.status(409).json({ error: error.message });
        }
        else if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Candidate not found' });
        }
        else {
            res.status(400).json({ error: error.message || 'Failed to update candidate' });
        }
    }
}
async function deleteCandidateController(req, res) {
    try {
        // For now, use a placeholder user ID for testing
        const userId = 'test-user-id';
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        await (0, candidateService_1.deleteCandidate)(id, userId);
        res.json({ message: 'Candidate deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting candidate:', error);
        if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Candidate not found' });
        }
        else {
            res.status(500).json({ error: 'Failed to delete candidate' });
        }
    }
}
