import { Request, Response } from 'express';
// Old documentService imports removed - using candidateDocumentService instead
import {
  uploadCandidateDocument,
  getCandidateDocumentById,
  listCandidateDocumentsByCandidate,
  getCandidateDocumentSignedUrl,
  deleteCandidateDocument,
  reprocessDocumentVerification,
  overrideDocumentVerification,
  UploadCandidateDocumentData,
  formatDocumentResponse, // NEW: Helper to format document with rejection details
} from '../services/candidateDocumentService';
import { updateDocumentFlagsController } from './candidateController';
import { asyncHandler } from '../utils/errorHandling';
import { DOCUMENT_CATEGORY_DISPLAY_NAMES } from '../config/documentCategories';
import { splitUpload } from '../services/splitUploadService';

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

  const { candidate_id, source, document_type } = req.body;

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
    document_type: document_type || undefined,
  };

  const { document, request_id } = await uploadCandidateDocument(uploadData);

  // Update candidate document flags after upload
  // This ensures flags (cv_received, passport_received, etc.) are set correctly
  try {
    const mockReq = { params: { id: candidate_id }, body: {} } as any;
    const mockRes = {
      status: (code: number) => ({ 
        json: (data: any) => {
          if (code >= 400) {
            console.error(`[uploadCandidateDocumentController] Flag update failed (${code}):`, data);
          } else {
            console.log(`[uploadCandidateDocumentController] Flags updated successfully for candidate ${candidate_id}`);
          }
        }
      }),
      json: (data: any) => console.log(`[uploadCandidateDocumentController] Flag update response:`, data)
    } as any;
    await updateDocumentFlagsController(mockReq, mockRes);
  } catch (flagError) {
    // Log but don't fail the upload if flag update fails
    console.error('[uploadCandidateDocumentController] Failed to update document flags after upload:', flagError);
  }

  res.status(201).json({
    success: true,
    document: await formatDocumentResponse(document), // Use formatted response with rejection details
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

    // Format document with rejection details for ALL document types
    res.json({ document: await formatDocumentResponse(document) });
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

    // Format all documents with rejection details
    const formattedDocuments = await Promise.all(documents.map(doc => formatDocumentResponse(doc)));

    // Group by category for frontend
    const groupedByCategory = formattedDocuments.reduce((acc: any, doc) => {
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
      documents: formattedDocuments,
      grouped_by_category: Object.values(groupedByCategory),
      total: formattedDocuments.length,
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
    
    // Backward compatibility: frontend expects `download_url`
    res.json({ signedUrl, download_url: signedUrl, expiresIn });
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

/**
 * Reprocess document verification (re-run AI verification)
 * POST /api/candidate-documents/:id/reprocess
 */
export async function reprocessCandidateDocumentController(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    const result = await reprocessDocumentVerification(id);

    res.json({
      success: true,
      message: 'Document verification reprocessing initiated',
      request_id: result.request_id,
    });
  } catch (error: any) {
    console.error('Error reprocessing candidate document:', error);
    res.status(500).json({ error: error.message || 'Failed to reprocess document' });
  }
}

/**
 * Admin override document verification
 * POST /api/candidate-documents/:id/override
 * Requires admin role and password verification
 */
export async function overrideCandidateDocumentController(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { admin_email, admin_password, justification } = req.body;
    const authUser = (req as any).user;

    if (!id) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    if (!admin_email) {
      return res.status(400).json({ error: 'Admin email is required' });
    }

    if (!admin_password) {
      return res.status(400).json({ error: 'Admin password is required' });
    }

    if (!justification || justification.trim().length < 10) {
      return res.status(400).json({ error: 'Justification must be at least 10 characters' });
    }

    // Get admin user info from auth context (if available) or from password verification
    // For now, we'll get it from password verification in the service
    // In production, auth middleware should provide req.user
    const adminUserId = authUser?.id || null; // Will be verified in service via password
    const adminRole = authUser?.role?.toLowerCase() || 'admin'; // Default to admin, will be verified in service

    const document = await overrideDocumentVerification(
      id,
      adminUserId || 'temp', // Will be replaced by actual user ID from password verification
      admin_email,
      admin_password,
      justification.trim(),
      adminRole as 'admin' | 'super_admin'
    );

    res.json({
      success: true,
      document: await formatDocumentResponse(document),
      message: 'Document verification override successful',
    });
  } catch (error: any) {
    console.error('Error overriding candidate document:', error);
    
    // Map AppError to appropriate status codes
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    
    res.status(500).json({ error: error.message || 'Failed to override document verification' });
  }
}

// ============================================================================
// LEGACY CONTROLLERS (for old documents table)
// ============================================================================

// ============================================================================
// OLD CONTROLLERS - REMOVED
// Use the new candidate-documents controllers instead.
// ============================================================================

/**
 * Split-and-categorize upload: preserve original -> parser -> create candidate if none -> one doc per documents[].
 * Body: file (multer), optional candidate_id, optional candidate_data (JSON string), optional use_textract.
 */
export async function splitUploadController(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id || 'system';
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const candidateId = (req.body?.candidate_id as string) || undefined;
    let candidateData: Record<string, unknown> | undefined;
    try {
      const raw = req.body?.candidate_data;
      if (typeof raw === 'string' && raw) candidateData = JSON.parse(raw) as Record<string, unknown>;
      else if (raw && typeof raw === 'object') candidateData = raw as Record<string, unknown>;
    } catch {
      candidateData = undefined;
    }
    const useTextract = req.body?.use_textract !== 'false' && req.body?.use_textract !== false;

    const result = await splitUpload({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      candidateId,
      candidateData,
      useTextract,
      userId,
    });

    return res.status(201).json({
      message: 'Split upload complete',
      uploadId: result.uploadId,
      originalPath: result.originalPath,
      candidateId: result.candidateId,
      engineUsed: result.engineUsed,
      documentCount: result.documentCount,
    });
  } catch (error: any) {
    console.error('Split upload error:', error);
    return res.status(400).json({ error: error.message || 'Split upload failed' });
  }
}
