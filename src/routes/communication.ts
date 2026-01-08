import { Router } from 'express';
// import { authenticate } from '../middleware/auth';
import {
  createTemplateController,
  getTemplateController,
  listTemplatesController,
  updateTemplateController,
  deleteTemplateController,
  sendTemplateMessageController,
} from '../controllers/communicationController';

const router = Router();

// All routes require authentication
// router.use(authenticate);

// Create template
router.post('/', createTemplateController);

// List templates
router.get('/', listTemplatesController);

// Get template
router.get('/:id', getTemplateController);

// Update template
router.put('/:id', updateTemplateController);

// Delete template
router.delete('/:id', deleteTemplateController);

// Send message using template
router.post('/:templateId/send/:candidateId', sendTemplateMessageController);

export default router;
