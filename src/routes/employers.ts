import { Router } from 'express';
// import { authenticate } from '../middleware/auth';
import {
  createEmployerController,
  getEmployerController,
  listEmployersController,
  updateEmployerController,
  deleteEmployerController,
} from '../controllers/employerController';

const router = Router();

// All routes require authentication
// router.use(authenticate);

// Create employer
router.post('/', createEmployerController);

// List employers with optional filters
router.get('/', listEmployersController);

// Get single employer
router.get('/:id', getEmployerController);

// Update employer
router.put('/:id', updateEmployerController);

// Delete employer
router.delete('/:id', deleteEmployerController);

export default router;
