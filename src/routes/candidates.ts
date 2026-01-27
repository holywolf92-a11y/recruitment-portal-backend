import { Router } from 'express';
import multer from 'multer';
// import { authenticate } from '../middleware/auth';
import { validateCandidate } from '../middleware/validation';
import {
  createCandidateController,
  getCandidateController,
  listCandidatesController,
  dailyStatsController,
  exportCandidatesController,
  updateCandidateController,
  deleteCandidateController,
  bulkUpdateCandidateStatusController,
  extractCandidateDataController,
  updateExtractionController,
  getExtractionHistoryController,
  getCandidateCVDownloadController,
  uploadCandidatePhotoController,
  updateDocumentFlagsController,
  linkCandidatesCVController,
  updateCandidateFieldManuallyController,
  getMissingFieldsController
} from '../controllers/candidateController';

const router = Router();

// Configure multer for photo uploads
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  },
});

// All routes require authentication
// router.use(authenticate);

// Create candidate
router.post('/', validateCandidate, createCandidateController);

// List candidates with optional filters
router.get('/', listCandidatesController);

// Daily stats for Excel-style reports
router.get('/daily-stats', dailyStatsController);

// Export candidates (CSV/Excel)
router.get('/export', exportCandidatesController);

// Bulk operations
router.patch('/bulk/status', bulkUpdateCandidateStatusController);

// Get single candidate
router.get('/:id', getCandidateController);

// Get CV download for candidate
router.get('/:id/documents/cv/download', getCandidateCVDownloadController);

// Upload profile photo for candidate
router.post('/:id/photo', photoUpload.single('photo'), uploadCandidatePhotoController);

// Update candidate
router.put('/:id', validateCandidate, updateCandidateController);

// Delete candidate (soft delete)
router.delete('/:id', deleteCandidateController);

// CV Extraction Routes
router.post('/:id/extract', extractCandidateDataController);
router.put('/:id/extraction', updateExtractionController);
router.get('/:id/extraction-history', getExtractionHistoryController);

// Update document flags based on actual documents
router.post('/:id/update-document-flags', updateDocumentFlagsController);

// Link existing CV from inbox_attachments to candidate_documents (prevents duplicates)
router.post('/:id/link-cv', linkCandidatesCVController);

// Progressive data completion endpoints
router.get('/:id/missing-fields', getMissingFieldsController);
router.patch('/:id/fields/:field', updateCandidateFieldManuallyController);

export default router;