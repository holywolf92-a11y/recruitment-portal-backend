import { Router } from 'express';
// import { authenticate } from '../middleware/auth';
import {
  advancedSearchController,
  searchSuggestionsController,
} from '../controllers/searchController';

const router = Router();

// All routes require authentication
// router.use(authenticate);

// Advanced search
router.post('/advanced', advancedSearchController);

// Search suggestions
router.get('/suggestions', searchSuggestionsController);

export default router;
