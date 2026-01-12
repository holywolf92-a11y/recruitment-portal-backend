import { Router } from 'express';
// import { authenticate } from '../middleware/auth';
import {
  generateJobCodeController,
  createJobOrderController,
  getJobOrderController,
  listJobOrdersController,
  updateJobOrderController,
  deleteJobOrderController,
} from '../controllers/jobOrderController';

const router = Router();

// All routes require authentication
// router.use(authenticate);

// Generate next job code
router.get('/generate-code', generateJobCodeController);

// Create job order
router.post('/', createJobOrderController);

// List job orders with optional filters
router.get('/', listJobOrdersController);

// Get single job order
router.get('/:id', getJobOrderController);

// Update job order
router.put('/:id', updateJobOrderController);

// Delete job order
router.delete('/:id', deleteJobOrderController);

export default router;
