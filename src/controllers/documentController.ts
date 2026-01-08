import { Request, Response } from 'express';
import {
  uploadDocument,
  getDocumentById,
  listCandidateDocuments,
  getDocumentSignedUrl,
  deleteDocument,
  UploadDocumentData
} from '../services/documentService';

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
