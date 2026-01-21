"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const verificationLogController_1 = require("../controllers/verificationLogController");
const router = (0, express_1.Router)();
/**
 * Verification Logs API Routes
 *
 * These endpoints provide access to document verification audit logs
 * for monitoring AI categorization and identity matching workflow
 */
// Get logs by request_id (all events for a single upload request)
router.get('/request/:requestId', verificationLogController_1.getVerificationLogsByRequestId);
// Get logs by document_id (all events for a specific document)
router.get('/document/:documentId', verificationLogController_1.getVerificationLogsByDocumentId);
// Get logs by candidate_id (all verification events for a candidate)
router.get('/candidate/:candidateId', verificationLogController_1.getVerificationLogsByCandidateId);
// Get verification timeline (aggregated view with processing durations)
router.get('/timeline', verificationLogController_1.getVerificationTimeline);
// Get verification statistics for a candidate
router.get('/stats/candidate/:candidateId', verificationLogController_1.getVerificationStatsByCandidate);
exports.default = router;
