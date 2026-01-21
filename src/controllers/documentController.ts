import { Request, Response } from 'express';
import {
  uploadDocument,
  getDocumentById,
  listCandidateDocuments,
  getDocumentSignedUrl,
  deleteDocument,
  UploadDocumentData
} from '../services/documentService';
import {
  uploadCandidateDocument,
  getCandidateDocumentById,
  listCandidateDocumentsByCandidate,
  getCandidateDocumentSignedUrl,
  deleteCandidateDocument,
  UploadCandidateDocumentData
} from '../services/candidateDocumentService';
import { DOCUMENT_CATEGORY_DISPLAY_NAMES } from '../config/documentCategories';

/**
 * Upload document with AI verification workflow (NEW)
 * POST /api/candidate-documents
 */
export async function uploadCandidateDocumentController(req: Request, res: Response) {
  const userId = (req as any).user?.id || 'system'; // Get from auth middleware if available

  if (!req.file) {
    // Let this error propagate to global error handler
    throw new Error('No file uploaded');
  }

  const { candidate_id, source } = req.body;

  // Validate candidate_id is provided
  if (!candidate_id) {
    throw new Error('candidate_id is required');
  }

  // Validate candidate_id is a valid UUID format (not null UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(candidate_id)) {
    throw new Error('candidate_id must be a valid UUID');
  }

  // Reject null UUID
  if (candidate_id === '00000000-0000-0000-0000-000000000000') {
    throw new Error('candidate_id cannot be null UUID');
  }

  const uploadData: UploadCandidateDocumentData = {
    candidate_id,
    file_name: req.file.originalname,
    mime_type: req.file.mimetype,
    buffer: req.file.buffer,
    source: source || 'web',
    uploaded_by_user_id: userId,
  };

  const { document, request_id } = await uploadCandidateDocument(uploadData);

  res.status(201).json({
    success: true,
    document: {
      id: document.id,
      candidate_id: document.candidate_id,
      file_name: document.file_name,
      mime_type: document.mime_type,
      verification_status: document.verification_status,
      category: document.category,
      created_at: document.created_at,
    },
    request_id,
    message: 'Document uploaded successfully. AI verification in progress.',
  });
}

/**
 * Get candidate document by ID (NEW)
 * GET /api/candidate-documents/:id
 */
export async function getCandidateDocumentController(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    const document = await getCandidateDocumentById(id);
    
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ document });
  } catch (error: any) {
    console.error('Error fetching candidate document:', error);
    res.status(500).json({ error: 'Failed to fetch document' });
  }
}

/**
 * List documents for a candidate (NEW)
 * GET /api/candidates/:candidateId/documents
 */
export async function listCandidateDocumentsControllerNew(req: Request, res: Response) {
  try {
    const { candidateId } = req.params;
    const { category } = req.query;

    if (!candidateId) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    const documents = await listCandidateDocumentsByCandidate(
      candidateId,
      category as any
    );

    // Group by category for frontend
    const groupedByCategory = documents.reduce((acc: any, doc) => {
      const cat = doc.category || 'other_documents';
      if (!acc[cat]) {
        acc[cat] = {
          category: cat,
          display_name: DOCUMENT_CATEGORY_DISPLAY_NAMES[cat as keyof typeof DOCUMENT_CATEGORY_DISPLAY_NAMES],
          documents: [],
        };
      }
      acc[cat].documents.push(doc);
      return acc;
    }, {});

    res.json({
      documents,
      grouped_by_category: Object.values(groupedByCategory),
      total: documents.length,
    });
  } catch (error: any) {
    console.error('Error listing candidate documents:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
}

/**
 * Get signed URL for document download (NEW)
 * GET /api/candidate-documents/:id/download
 */
export async function getCandidateDocumentDownloadUrlController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const expiresIn = req.query.expiresIn ? parseInt(req.query.expiresIn as string) : 3600;

    if (!id) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    const signedUrl = await getCandidateDocumentSignedUrl(id, expiresIn);
    
    res.json({ signedUrl, expiresIn });
  } catch (error: any) {
    console.error('Error generating signed URL:', error);
    res.status(500).json({ error: error.message || 'Failed to generate signed URL' });
  }
}

/**
 * Delete candidate document (NEW)
 * DELETE /api/candidate-documents/:id
 */
export async function deleteCandidateDocumentController(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    await deleteCandidateDocument(id);
    
    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting candidate document:', error);
    res.status(500).json({ error: error.message || 'Failed to delete document' });
  }
}

// ============================================================================
// LEGACY CONTROLLERS (for old documents table)
// ============================================================================

export async function uploadDocumentController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { candidate_id, doc_type, is_primary } = req.body;

    if (!candidate_id) {
      return res.status(400).json({ error: 'candidate_id is required' });
    }

    if (!doc_type) {
      return res.status(400).json({ error: 'doc_type is required' });
    }

    const uploadData: UploadDocumentData = {
      candidate_id,
      doc_type,
      file_name: req.file.originalname,
      mime_type: req.file.mimetype,
      buffer: req.file.buffer,
      is_primary: is_primary === 'true' || is_primary === true,
    };

    const document = await uploadDocument(uploadData, userId);

    res.status(201).json({ document });
  } catch (error: any) {
    console.error('Error uploading document:', error);
    res.status(400).json({ error: error.message || 'Failed to upload document' });
  }
}

export async function getDocumentController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    const document = await getDocumentById(id, userId);
    res.json({ document });
  } catch (error: any) {
    console.error('Error fetching document:', error);
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Document not found' });
    } else {
      res.status(500).json({ error: 'Failed to fetch document' });
    }
  }
}

export async function listCandidateDocumentsController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { candidateId } = req.params;

    if (!candidateId) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    const documents = await listCandidateDocuments(candidateId, userId);
    res.json({ documents });
  } catch (error: any) {
    console.error('Error listing documents:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
}

export async function getDocumentSignedUrlController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;
    const expiresIn = req.query.expiresIn ? parseInt(req.query.expiresIn as string) : 3600;

    if (!id) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    const signedUrl = await getDocumentSignedUrl(id, userId, expiresIn);
    res.json({ signedUrl });
  } catch (error: any) {
    console.error('Error generating signed URL:', error);
    res.status(500).json({ error: 'Failed to generate signed URL' });
  }
}

export async function deleteDocumentController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    await deleteDocument(id, userId);
    res.json({ message: 'Document deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting document:', error);
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Document not found' });
    } else {
      res.status(500).json({ error: 'Failed to delete document' });
    }
  }
}
