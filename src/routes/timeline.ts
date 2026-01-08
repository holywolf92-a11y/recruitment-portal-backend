import { Router } from 'express';
// import { authenticate } from '../middleware/auth';
import {
  createTimelineEventController,
  getCandidateTimelineController,
  getTimelineEventController,
} from '../controllers/timelineController';

const router = Router();

// All routes require authentication
// router.use(authenticate);

// Create timeline event (manual)
router.post('/', createTimelineEventController);

// Get timeline for a candidate
router.get('/candidate/:candidateId', getCandidateTimelineController);

// Get single timeline event
router.get('/:id', getTimelineEventController);

export default router;
