import { Router } from 'express';
// import { authenticate } from '../middleware/auth';
import {
  generateBulkCVsController,
  generateSingleCVController,
  getCVStatusController,
} from '../controllers/cvGeneratorController';

const router = Router();

// All routes require authentication
// router.use(authenticate);

// Generate single CV
// GET /api/cv-generator/:candidateId?format=employer-safe&force=true
router.get('/:candidateId', generateSingleCVController);

// Get CV generation status
// GET /api/cv-generator/:candidateId/status?format=employer-safe
router.get('/:candidateId/status', getCVStatusController);

// Generate bulk CVs
// POST /api/cv-generator/bulk
router.post('/bulk', generateBulkCVsController);

export default router;
