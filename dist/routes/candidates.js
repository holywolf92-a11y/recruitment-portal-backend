"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
// import { authenticate } from '../middleware/auth';
const validation_1 = require("../middleware/validation");
const candidateController_1 = require("../controllers/candidateController");
const router = (0, express_1.Router)();
// Configure multer for photo uploads
const photoUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
        }
    },
});
// All routes require authentication
// router.use(authenticate);
// Create candidate
router.post('/', validation_1.validateCandidate, candidateController_1.createCandidateController);
// List candidates with optional filters
router.get('/', candidateController_1.listCandidatesController);
// Daily stats for Excel-style reports
router.get('/daily-stats', candidateController_1.dailyStatsController);
// Exact KPI stats for Candidates page
router.get('/dashboard-stats', candidateController_1.candidateDashboardStatsController);
// Lightweight metadata for candidate browser navigation and filters
router.get('/browse-metadata', candidateController_1.candidateBrowseMetadataController);
// Export candidates (CSV/Excel)
router.get('/export', candidateController_1.exportCandidatesController);
// Matching governance metrics (must be before /:id wildcard)
router.get('/matching-metrics', candidateController_1.getMatchingMetricsController);
// Bulk operations
router.patch('/bulk/status', candidateController_1.bulkUpdateCandidateStatusController);
// Get single candidate
router.get('/:id', candidateController_1.getCandidateController);
// Get CV download for candidate
router.get('/:id/documents/cv/download', candidateController_1.getCandidateCVDownloadController);
// Upload profile photo for candidate
router.post('/:id/photo', photoUpload.single('photo'), candidateController_1.uploadCandidatePhotoController);
// Update candidate
router.put('/:id', validation_1.validateCandidate, candidateController_1.updateCandidateController);
// Delete candidate (soft delete)
router.delete('/:id', candidateController_1.deleteCandidateController);
// CV Extraction Routes
router.post('/:id/extract', candidateController_1.extractCandidateDataController);
router.put('/:id/extraction', candidateController_1.updateExtractionController);
router.get('/:id/extraction-history', candidateController_1.getExtractionHistoryController);
// Update document flags based on actual documents
router.post('/:id/update-document-flags', candidateController_1.updateDocumentFlagsController);
// Link existing CV from inbox_attachments to candidate_documents (prevents duplicates)
router.post('/:id/link-cv', candidateController_1.linkCandidatesCVController);
// Progressive data completion endpoints
router.get('/:id/missing-fields', candidateController_1.getMissingFieldsController);
router.patch('/:id/fields/:field', candidateController_1.updateCandidateFieldManuallyController);
// Candidate merge
router.post('/:id/merge', candidateController_1.mergeCandidateController);
router.get('/:id/merges', candidateController_1.getCandidateMergeHistoryController);
exports.default = router;
