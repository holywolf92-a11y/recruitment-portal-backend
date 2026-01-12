import { Router } from 'express';
// import { authenticate } from '../middleware/auth';
import {
  matchCandidatesController,
  saveMatchesController,
  getJobMatchesController,
  deleteMatchController,
} from '../controllers/matchingController';

const router = Router();

// All routes require authentication
// router.use(authenticate);

// Match candidates for a job order
router.post('/match', matchCandidatesController);

// Save candidate matches
router.post('/save', saveMatchesController);

// Get matches for a job order
router.get('/job/:jobOrderId', getJobMatchesController);

// Delete a match
router.delete('/:matchId', deleteMatchController);

export default router;
