"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
// import { authenticate } from '../middleware/auth';
const matchingController_1 = require("../controllers/matchingController");
const router = (0, express_1.Router)();
// All routes require authentication
// router.use(authenticate);
// Match candidates for a job order
router.post('/match', matchingController_1.matchCandidatesController);
// Save candidate matches
router.post('/save', matchingController_1.saveMatchesController);
// Get matches for a job order
router.get('/job/:jobOrderId', matchingController_1.getJobMatchesController);
// Delete a match
router.delete('/:matchId', matchingController_1.deleteMatchController);
exports.default = router;
