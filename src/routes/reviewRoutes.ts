import { Router } from 'express';
import {
  submitFeedbackController,
  trackAnalyticsController,
  listFeedbackController,
  getReviewStatsController,
} from '../controllers/reviewController';

const router = Router();

// Public (no auth) — called from the review page
router.post('/feedback', submitFeedbackController);
router.post('/analytics', trackAnalyticsController);

// Admin only — protected by auth middleware at server level if needed
router.get('/admin/feedback', listFeedbackController);
router.get('/admin/stats', getReviewStatsController);

export default router;
