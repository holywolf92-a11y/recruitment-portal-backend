"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const reviewController_1 = require("../controllers/reviewController");
const router = (0, express_1.Router)();
// Public (no auth) — called from the review page
router.post('/feedback', reviewController_1.submitFeedbackController);
router.post('/analytics', reviewController_1.trackAnalyticsController);
// Admin only — protected by auth middleware at server level if needed
router.get('/admin/feedback', reviewController_1.listFeedbackController);
router.get('/admin/stats', reviewController_1.getReviewStatsController);
exports.default = router;
