import { Router } from 'express';
import multer from 'multer';
// import { authenticate } from '../middleware/auth';
import {
  uploadDocumentController,
  getDocumentController,
  listCandidateDocumentsController,
  getDocumentSignedUrlController,
  deleteDocumentController
} from '../controllers/documentController';

const router = Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/jpg',
      'text/plain',
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, PNG, and TXT files are allowed.'));
    }
  },
});

// All routes require authentication
// router.use(authenticate);

// Upload document
router.post('/', upload.single('file'), uploadDocumentController);

// Get document metadata
router.get('/:id', getDocumentController);

// List all documents for a candidate
router.get('/candidate/:candidateId', listCandidateDocumentsController);

// Get signed URL for document download
router.get('/:id/download', getDocumentSignedUrlController);

// Delete document
router.delete('/:id', deleteDocumentController);

export default router;
