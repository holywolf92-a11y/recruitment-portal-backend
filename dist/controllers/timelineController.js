"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTimelineEventController = createTimelineEventController;
exports.getCandidateTimelineController = getCandidateTimelineController;
exports.getTimelineEventController = getTimelineEventController;
const timelineService_1 = require("../services/timelineService");
async function createTimelineEventController(req, res) {
    try {
        const userId = 'test-user-id';
        const eventData = {
            ...req.body,
            actor_user_id: req.body.actor_user_id || userId,
        };
        // Validate required fields
        if (!eventData.candidate_id) {
            return res.status(400).json({ error: 'candidate_id is required' });
        }
        if (!eventData.event_category) {
            return res.status(400).json({ error: 'event_category is required' });
        }
        if (!eventData.event_type) {
            return res.status(400).json({ error: 'event_type is required' });
        }
        const event = await (0, timelineService_1.createTimelineEvent)(eventData);
        res.status(201).json({ event });
    }
    catch (error) {
        console.error('Error creating timeline event:', error);
        res.status(400).json({ error: error.message || 'Failed to create timeline event' });
    }
}
async function getCandidateTimelineController(req, res) {
    try {
        const { candidateId } = req.params;
        if (!candidateId) {
            return res.status(400).json({ error: 'Candidate ID is required' });
        }
        const options = {
            limit: req.query.limit ? parseInt(req.query.limit) : undefined,
            offset: req.query.offset ? parseInt(req.query.offset) : undefined,
            category: req.query.category,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
        };
        const result = await (0, timelineService_1.getCandidateTimeline)(candidateId, options);
        res.json(result);
    }
    catch (error) {
        console.error('Error fetching timeline:', error);
        res.status(500).json({ error: 'Failed to fetch timeline' });
    }
}
async function getTimelineEventController(req, res) {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Event ID is required' });
        }
        const event = await (0, timelineService_1.getTimelineEvent)(id);
        res.json({ event });
    }
    catch (error) {
        console.error('Error fetching timeline event:', error);
        if (error.code === 'PGRST116') {
            res.status(404).json({ error: 'Timeline event not found' });
        }
        else {
            res.status(500).json({ error: 'Failed to fetch timeline event' });
        }
    }
}
