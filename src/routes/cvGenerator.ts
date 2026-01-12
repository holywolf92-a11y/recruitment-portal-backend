import { Router } from 'express';
// import { authenticate } from '../middleware/auth';
import {
  generateBulkCVsController,
  generateSingleCVController,
} from '../controllers/cvGeneratorController';

const router = Router();

// All routes require authentication
// router.use(authenticate);

// Generate bulk CVs
router.post('/bulk', generateBulkCVsController);

// Generate single CV
router.get('/:candidateId', generateSingleCVController);

export default router;
