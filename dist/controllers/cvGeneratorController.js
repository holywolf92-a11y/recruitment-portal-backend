"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateBulkCVsController = generateBulkCVsController;
exports.generateSingleCVController = generateSingleCVController;
const cvGeneratorService_1 = require("../services/cvGeneratorService");
async function generateBulkCVsController(req, res) {
    try {
        const userId = 'test-user-id';
        const request = req.body;
        if (!request.candidate_ids || !Array.isArray(request.candidate_ids) || request.candidate_ids.length === 0) {
            return res.status(400).json({ error: 'candidate_ids array is required and must not be empty' });
        }
        if (request.candidate_ids.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 candidates allowed per bulk request' });
        }
        const results = await (0, cvGeneratorService_1.generateBulkCVs)(request, userId);
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;
        res.json({
            results,
            summary: {
                total: results.length,
                success: successCount,
                failed: failureCount,
            },
        });
    }
    catch (error) {
        console.error('Error generating bulk CVs:', error);
        res.status(500).json({ error: error.message || 'Failed to generate CVs' });
    }
}
async function generateSingleCVController(req, res) {
    try {
        const userId = 'test-user-id';
        const { candidateId } = req.params;
        const format = req.query.format || 'standard';
        if (!candidateId) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        if (!['standard', 'employer-safe'].includes(format)) {
            return res.status(400).json({ error: 'Invalid format. Must be "standard" or "employer-safe"' });
        }
        const result = await (0, cvGeneratorService_1.generateSingleCV)(candidateId, format, userId);
        res.json(result);
    }
    catch (error) {
        console.error('Error generating CV:', error);
        if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Candidate not found' });
        }
        else {
            res.status(500).json({ error: error.message || 'Failed to generate CV' });
        }
    }
}
