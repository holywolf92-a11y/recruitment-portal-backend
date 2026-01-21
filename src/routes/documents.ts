import { Router, Request, Response } from 'express';
import multer from 'multer';
import { createLogger } from '../utils/errorHandling';
import { supabaseAdminClient } from '../config/database';
// import { authenticate } from '../middleware/auth';
import {
  uploadDocumentController,
  getDocumentController,
  listCandidateDocumentsController,
  getDocumentSignedUrlController,
  deleteDocumentController
} from '../controllers/documentController';
import {
  uploadCandidateDocumentController,
  getCandidateDocumentController,
  listCandidateDocumentsControllerNew,
  getCandidateDocumentDownloadUrlController,
  deleteCandidateDocumentController,
  reprocessCandidateDocumentController
} from '../controllers/documentController';

const logger = createLogger('DocumentsRouter');

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

// ============================================================================
// NEW ROUTES - AI Document Verification System
// ============================================================================

// Upload document with AI verification
import { asyncHandler } from '../utils/errorHandling';

// Multer error handler middleware
const handleMulterError = (err: any, req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError) {
    return next(err); // Pass to global error handler
  }
  if (err) {
    return next(err); // Pass other errors (like fileFilter errors)
  }
  next();
};

// Upload endpoint with extended timeout for large files
router.post('/candidate-documents', 
  (req: Request, res: Response, next: any) => {
    // Set timeout to 5 minutes for this specific route
    req.setTimeout(300000, () => {
      if (!res.headersSent) {
        res.status(408).json({ error: 'Upload timeout. Please try again with a smaller file.' });
      }
    });
    next();
  },
  upload.single('file'),
  handleMulterError,
  asyncHandler(uploadCandidateDocumentController)
);

// Get candidate document by ID
router.get('/candidate-documents/:id', getCandidateDocumentController);

// Get signed URL for download
router.get('/candidate-documents/:id/download', getCandidateDocumentDownloadUrlController);

// Delete candidate document
router.delete('/candidate-documents/:id', deleteCandidateDocumentController);

// Reprocess document verification (re-run AI verification with updated logic)
router.post('/candidate-documents/:id/reprocess', reprocessCandidateDocumentController);

// List documents for a candidate (with category filtering)
router.get('/candidates/:candidateId/documents', listCandidateDocumentsControllerNew);

// ============================================================================
// LEGACY ROUTES - Old documents table (kept for backward compatibility)
// ============================================================================

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

/**
 * GET /api/documents/candidates/:candidateId/documents
 * Returns all documents linked to a candidate with download URLs
 */
router.get('/candidates/:candidateId/documents', async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;
    const db = supabaseAdminClient();

    // Get all documents for this candidate
    const { data: documents, error } = await db
      .from('candidate_documents')
      .select(`
        id,
        document_type,
        file_name,
        storage_path,
        received_at,
        source
      `)
      .eq('candidate_id', candidateId)
      .order('received_at', { ascending: false });

    if (error) throw error;

    // Generate download URLs for each document
    const docsWithUrls = await Promise.all(
      (documents || []).map(async (doc) => {
        try {
          const { data } = await db.storage
            .from('documents')
            .createSignedUrl(doc.storage_path, 3600); // 1 hour expiry
          return {
            ...doc,
            downloadUrl: data?.signedUrl || null,
          };
        } catch (err) {
          logger.warn(`Failed to generate signed URL for ${doc.storage_path}`, err);
          return { ...doc, downloadUrl: null };
        }
      })
    );

    res.json({ documents: docsWithUrls });
  } catch (err: any) {
    logger.error('Failed to fetch candidate documents', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

/**
 * GET /api/documents/unmatched
 * Returns unmatched documents pending manual linking
 */
router.get('/unmatched', async (req: Request, res: Response) => {
  try {
    const db = supabaseAdminClient();
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const filterStatus = req.query.status as string; // 'pending', 'needs_review', all if not specified

    let query = db
      .from('unmatched_documents')
      .select(
        `
        id,
        document_type,
        file_name,
        storage_path,
        received_at,
        source,
        extracted_metadata,
        needs_manual_review,
        review_reasons
      `,
        { count: 'exact' }
      )
      .order('received_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filterStatus === 'needs_review') {
      query = query.eq('needs_manual_review', true);
    } else if (filterStatus === 'pending') {
      query = query.eq('needs_manual_review', false);
    }

    const { data: documents, error, count } = await query;

    if (error) throw error;

    // Generate download URLs
    const docsWithUrls = await Promise.all(
      (documents || []).map(async (doc) => {
        try {
          const { data } = await db.storage
            .from('documents')
            .createSignedUrl(doc.storage_path, 3600);
          return {
            ...doc,
            downloadUrl: data?.signedUrl || null,
          };
        } catch (err) {
          logger.warn(`Failed to generate signed URL for ${doc.storage_path}`, err);
          return { ...doc, downloadUrl: null };
        }
      })
    );

    res.json({
      documents: docsWithUrls,
      total: count || 0,
      limit,
      offset,
    });
  } catch (err: any) {
    logger.error('Failed to fetch unmatched documents', err);
    res.status(500).json({ error: 'Failed to fetch unmatched documents' });
  }
});

/**
 * POST /api/documents/unmatched/:documentId/link
 * Manually link an unmatched document to a candidate
 */
router.post('/unmatched/:documentId/link', async (req: Request, res: Response) => {
  try {
    const { documentId } = req.params;
    const { candidateId } = req.body;

    if (!candidateId) {
      return res.status(400).json({ error: 'candidateId is required' });
    }

    const db = supabaseAdminClient();

    // Get the unmatched document
    const { data: doc, error: docError } = await db
      .from('unmatched_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Verify candidate exists
    const { data: candidate, error: candidateError } = await db
      .from('candidates')
      .select('id')
      .eq('id', candidateId)
      .single();

    if (candidateError || !candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    // Move document to candidate folder
    const newPath = `candidates/${candidateId}/documents/${doc.document_type}/${doc.file_name}`;
    
    try {
      // Copy file to new location
      const { data: fileData } = await db.storage
        .from('documents')
        .download(doc.storage_path);
      
      if (fileData) {
        await db.storage
          .from('documents')
          .upload(newPath, fileData, { upsert: false });
      }
    } catch (moveErr) {
      logger.warn(`Could not move file, continuing with reference update`, moveErr);
    }

    // Create candidate_documents entry
    const { error: linkError } = await db
      .from('candidate_documents')
      .insert({
        candidate_id: candidateId,
        document_type: doc.document_type,
        file_name: doc.file_name,
        storage_path: newPath,
        source: doc.source,
        received_at: doc.received_at,
      });

    if (linkError) throw linkError;

    // Delete from unmatched
    const { error: deleteError } = await db
      .from('unmatched_documents')
      .delete()
      .eq('id', documentId);

    if (deleteError) throw deleteError;

    res.json({ success: true, message: 'Document linked to candidate' });
  } catch (err: any) {
    logger.error('Failed to link document', err);
    res.status(500).json({ error: 'Failed to link document' });
  }
});

/**
 * GET /api/documents/checklist/:candidateId
 * Returns document checklist status for a candidate
 */
router.get('/checklist/:candidateId', async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;
    const db = supabaseAdminClient();

    const { data: candidate, error } = await db
      .from('candidates')
      .select(`
        id,
        passport_received,
        passport_received_at,
        cnic_received,
        cnic_received_at,
        degree_received,
        degree_received_at,
        medical_received,
        medical_received_at,
        visa_received,
        visa_received_at
      `)
      .eq('id', candidateId)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    res.json({
      checklist: {
        passport: {
          received: candidate?.passport_received || false,
          receivedAt: candidate?.passport_received_at,
        },
        cnic: {
          received: candidate?.cnic_received || false,
          receivedAt: candidate?.cnic_received_at,
        },
        degree: {
          received: candidate?.degree_received || false,
          receivedAt: candidate?.degree_received_at,
        },
        medical: {
          received: candidate?.medical_received || false,
          receivedAt: candidate?.medical_received_at,
        },
        visa: {
          received: candidate?.visa_received || false,
          receivedAt: candidate?.visa_received_at,
        },
      },
    });
  } catch (err: any) {
    logger.error('Failed to fetch document checklist', err);
    res.status(500).json({ error: 'Failed to fetch checklist' });
  }
});

export default router;
