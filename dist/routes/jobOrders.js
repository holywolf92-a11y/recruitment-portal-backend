"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
// import { authenticate } from '../middleware/auth';
const jobOrderController_1 = require("../controllers/jobOrderController");
const router = (0, express_1.Router)();
// All routes require authentication
// router.use(authenticate);
// Generate next job code
router.get('/generate-code', jobOrderController_1.generateJobCodeController);
// Create job order
router.post('/', jobOrderController_1.createJobOrderController);
// List job orders with optional filters
router.get('/', jobOrderController_1.listJobOrdersController);
// Get single job order
router.get('/:id', jobOrderController_1.getJobOrderController);
// Update job order
router.put('/:id', jobOrderController_1.updateJobOrderController);
// Delete job order
router.delete('/:id', jobOrderController_1.deleteJobOrderController);
exports.default = router;
