"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
// import { authenticate } from '../middleware/auth';
const timelineController_1 = require("../controllers/timelineController");
const router = (0, express_1.Router)();
// All routes require authentication
// router.use(authenticate);
// Create timeline event (manual)
router.post('/', timelineController_1.createTimelineEventController);
// Get timeline for a candidate
router.get('/candidate/:candidateId', timelineController_1.getCandidateTimelineController);
// Get single timeline event
router.get('/:id', timelineController_1.getTimelineEventController);
exports.default = router;
