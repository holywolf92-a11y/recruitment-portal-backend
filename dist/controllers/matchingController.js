"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchCandidatesController = matchCandidatesController;
exports.saveMatchesController = saveMatchesController;
exports.getJobMatchesController = getJobMatchesController;
exports.deleteMatchController = deleteMatchController;
const matchingService_1 = require("../services/matchingService");
async function matchCandidatesController(req, res) {
    try {
        const userId = 'test-user-id';
        const params = req.body;
        if (!params.job_order_id) {
            return res.status(400).json({ error: 'job_order_id is required' });
        }
        const matches = await (0, matchingService_1.matchCandidatesForJob)(params, userId);
        res.json({
            matches,
            count: matches.length,
        });
    }
    catch (error) {
        console.error('Error matching candidates:', error);
        if (error.message?.includes('not found')) {
            res.status(404).json({ error: error.message });
        }
        else {
            res.status(500).json({ error: error.message || 'Failed to match candidates' });
        }
    }
}
async function saveMatchesController(req, res) {
    try {
        const userId = 'test-user-id';
        const { job_order_id, candidate_ids, scores } = req.body;
        if (!job_order_id) {
            return res.status(400).json({ error: 'job_order_id is required' });
        }
        if (!candidate_ids || !Array.isArray(candidate_ids)) {
            return res.status(400).json({ error: 'candidate_ids array is required' });
        }
        if (!scores || !Array.isArray(scores) || scores.length !== candidate_ids.length) {
            return res.status(400).json({ error: 'scores array must match candidate_ids length' });
        }
        const matches = await (0, matchingService_1.saveCandidateMatches)(job_order_id, candidate_ids, scores, userId);
        res.status(201).json({ matches });
    }
    catch (error) {
        console.error('Error saving matches:', error);
        res.status(400).json({ error: error.message || 'Failed to save matches' });
    }
}
async function getJobMatchesController(req, res) {
    try {
        const userId = 'test-user-id';
        const { jobOrderId } = req.params;
        if (!jobOrderId) {
            return res.status(400).json({ error: 'Job order ID is required' });
        }
        const matches = await (0, matchingService_1.getJobMatches)(jobOrderId, userId);
        res.json({ matches });
    }
    catch (error) {
        console.error('Error fetching matches:', error);
        res.status(500).json({ error: 'Failed to fetch matches' });
    }
}
async function deleteMatchController(req, res) {
    try {
        const userId = 'test-user-id';
        const { matchId } = req.params;
        if (!matchId) {
            return res.status(400).json({ error: 'Match ID is required' });
        }
        await (0, matchingService_1.deleteCandidateMatch)(matchId, userId);
        res.json({ message: 'Match deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting match:', error);
        res.status(500).json({ error: 'Failed to delete match' });
    }
}
