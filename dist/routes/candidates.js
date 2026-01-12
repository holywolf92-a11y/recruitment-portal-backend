"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
// import { authenticate } from '../middleware/auth';
const validation_1 = require("../middleware/validation");
const candidateController_1 = require("../controllers/candidateController");
const router = (0, express_1.Router)();
// All routes require authentication
// router.use(authenticate);
// Create candidate
router.post('/', validation_1.validateCandidate, candidateController_1.createCandidateController);
// List candidates with optional filters
router.get('/', candidateController_1.listCandidatesController);
// Get single candidate
router.get('/:id', candidateController_1.getCandidateController);
// Update candidate
router.put('/:id', validation_1.validateCandidate, candidateController_1.updateCandidateController);
// Delete candidate (soft delete)
router.delete('/:id', candidateController_1.deleteCandidateController);
exports.default = router;
