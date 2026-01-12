"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
// import { authenticate } from '../middleware/auth';
const cvGeneratorController_1 = require("../controllers/cvGeneratorController");
const router = (0, express_1.Router)();
// All routes require authentication
// router.use(authenticate);
// Generate bulk CVs
router.post('/bulk', cvGeneratorController_1.generateBulkCVsController);
// Generate single CV
router.get('/:candidateId', cvGeneratorController_1.generateSingleCVController);
exports.default = router;
