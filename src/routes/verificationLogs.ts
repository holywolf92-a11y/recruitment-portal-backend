import { Router } from 'express';
import {
  getVerificationLogsByRequestId,
  getVerificationLogsByDocumentId,
  getVerificationLogsByCandidateId,
  getVerificationTimeline,
  getVerificationStatsByCandidate,
} from '../controllers/verificationLogController';

const router = Router();

/**
 * Verification Logs API Routes
 * 
 * These endpoints provide access to document verification audit logs
 * for monitoring AI categorization and identity matching workflow
 */

// Get logs by request_id (all events for a single upload request)
router.get('/request/:requestId', getVerificationLogsByRequestId);

// Get logs by document_id (all events for a specific document)
router.get('/document/:documentId', getVerificationLogsByDocumentId);

// Get logs by candidate_id (all verification events for a candidate)
router.get('/candidate/:candidateId', getVerificationLogsByCandidateId);

// Get verification timeline (aggregated view with processing durations)
router.get('/timeline', getVerificationTimeline);

// Get verification statistics for a candidate
router.get('/stats/candidate/:candidateId', getVerificationStatsByCandidate);

export default router;
