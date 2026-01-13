import { Router } from 'express';
// import { authenticate } from '../middleware/auth';
import { validateCandidate } from '../middleware/validation';
import {
  createCandidateController,
  getCandidateController,
  listCandidatesController,
  updateCandidateController,
  deleteCandidateController,
  bulkUpdateCandidateStatusController,
  extractCandidateDataController,
  updateExtractionController,
  getExtractionHistoryController
} from '../controllers/candidateController';

const router = Router();

// All routes require authentication
// router.use(authenticate);

// Create candidate
router.post('/', validateCandidate, createCandidateController);

// List candidates with optional filters
router.get('/', listCandidatesController);

// Bulk operations
router.patch('/bulk/status', bulkUpdateCandidateStatusController);

// Get single candidate
router.get('/:id', getCandidateController);

// Update candidate
router.put('/:id', validateCandidate, updateCandidateController);

// Delete candidate (soft delete)
router.delete('/:id', deleteCandidateController);

// CV Extraction Routes
router.post('/:id/extract', extractCandidateDataController);
router.put('/:id/extraction', updateExtractionController);
router.get('/:id/extraction-history', getExtractionHistoryController);

export default router;