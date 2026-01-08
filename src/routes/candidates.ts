import { Router } from 'express';
// import { authenticate } from '../middleware/auth';
import { validateCandidate } from '../middleware/validation';
import {
  createCandidateController,
  getCandidateController,
  listCandidatesController,
  updateCandidateController,
  deleteCandidateController
} from '../controllers/candidateController';

const router = Router();

// All routes require authentication
// router.use(authenticate);

// Create candidate
router.post('/', validateCandidate, createCandidateController);

// List candidates with optional filters
router.get('/', listCandidatesController);

// Get single candidate
router.get('/:id', getCandidateController);

// Update candidate
router.put('/:id', validateCandidate, updateCandidateController);

// Delete candidate (soft delete)
router.delete('/:id', deleteCandidateController);

export default router;