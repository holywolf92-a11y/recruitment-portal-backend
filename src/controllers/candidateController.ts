import { Request, Response } from 'express';
// import { AuthRequest } from '../middleware/auth';
import {
  createCandidate,
  getCandidateById,
  listCandidates,
  updateCandidate,
  deleteCandidate,
  bulkUpdateCandidateStatus,
  CreateCandidateData,
  CandidateFilters
} from '../services/candidateService';

export async function createCandidateController(req: Request, res: Response) {
  try {
    // For now, use a placeholder user ID for testing
    const userId = 'test-user-id';

    const candidateData: CreateCandidateData = req.body;

    // Basic validation
    if (!candidateData.name || candidateData.name.trim().length === 0) {
      return res.status(400).json({ error: 'Candidate name is required' });
    }

    const candidate = await createCandidate(candidateData, userId);

    res.status(201).json({ candidate });
  } catch (error: any) {
    console.error('Error creating candidate:', error);
    res.status(400).json({ error: error.message || 'Failed to create candidate' });
  }
}

export async function getCandidateController(req: Request, res: Response) {
  try {
    // For now, use a placeholder user ID for testing
    const userId = 'test-user-id';

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    const candidate = await getCandidateById(id, userId);
    res.json({ candidate });
  } catch (error: any) {
    console.error('Error fetching candidate:', error);
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Candidate not found' });
    } else {
      res.status(500).json({ error: 'Failed to fetch candidate' });
    }
  }
}

export async function listCandidatesController(req: Request, res: Response) {
  try {
    // For now, use a placeholder user ID for testing
    const userId = 'test-user-id';

    const filters: CandidateFilters = {
      search: req.query.search as string,
      status: req.query.status as string,
      position: req.query.position as string,
      country_of_interest: req.query.country_of_interest as string,
      documents: req.query.documents as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    };

    const result = await listCandidates(filters, userId);
    res.json(result);
  } catch (error: any) {
    console.error('Error listing candidates:', error);
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
}

export async function updateCandidateController(req: Request, res: Response) {
  try {
    // For now, use a placeholder user ID for testing
    const userId = 'test-user-id';

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    const updateData: Partial<CreateCandidateData> = req.body;

    // Basic validation
    if (updateData.name !== undefined && (!updateData.name || updateData.name.trim().length === 0)) {
      return res.status(400).json({ error: 'Candidate name cannot be empty' });
    }

    const candidate = await updateCandidate(id, updateData, userId);
    res.json({ candidate });
  } catch (error: any) {
    console.error('Error updating candidate:', error);
    if (error.message?.includes('Duplicate candidate found')) {
      res.status(409).json({ error: error.message });
    } else if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Candidate not found' });
    } else {
      res.status(400).json({ error: error.message || 'Failed to update candidate' });
    }
  }
}

export async function deleteCandidateController(req: Request, res: Response) {
  try {
    // For now, use a placeholder user ID for testing
    const userId = 'test-user-id';

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    await deleteCandidate(id, userId);
    res.json({ message: 'Candidate deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting candidate:', error);
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Candidate not found' });
    } else {
      res.status(500).json({ error: 'Failed to delete candidate' });
    }
  }
}

// CV Extraction Controllers
export async function extractCandidateDataController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;
    const { cvUrl } = req.body;

    console.log('🔄 CV Extraction endpoint called - ID:', id, 'URL:', cvUrl);

    if (!id) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    if (!cvUrl) {
      return res.status(400).json({ error: 'CV URL is required' });
    }

    // Import extraction service
    const { extractCandidateData } = require('../services/extractionService');
    const result = await extractCandidateData(id, cvUrl, userId);

    res.json(result);
  } catch (error: any) {
    console.error('Error extracting candidate data:', error);
    res.status(500).json({ error: error.message || 'Failed to extract candidate data' });
  }
}

export async function updateExtractionController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;
    const { extractedData, approved, notes } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    const { updateExtraction } = require('../services/extractionService');
    const result = await updateExtraction(id, extractedData, approved, notes, userId);

    res.json(result);
  } catch (error: any) {
    console.error('Error updating extraction:', error);
    res.status(500).json({ error: error.message || 'Failed to update extraction' });
  }
}

export async function getExtractionHistoryController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    const { getExtractionHistory } = require('../services/extractionService');
    const history = await getExtractionHistory(id, userId);

    res.json({ history });
  } catch (error: any) {
    console.error('Error fetching extraction history:', error);
    res.status(500).json({ error: 'Failed to fetch extraction history' });
  }
}

export async function getCandidateCVDownloadController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    const { supabaseAdminClient } = require('../config/database');
    const db = supabaseAdminClient();

    // Try to find CV in candidate_documents table (case-insensitive search)
    const { data: cvDocs } = await db
      .from('candidate_documents')
      .select('*')
      .eq('candidate_id', id)
      .ilike('document_type', 'cv')
      .order('received_at', { ascending: false });

    let cvDoc = cvDocs && cvDocs.length > 0 ? cvDocs[0] : null;

    // If not found, try inbox_attachments table (check both candidate_id and linked_candidate_id)
    if (!cvDoc) {
      const { data: inboxDocs } = await db
        .from('inbox_attachments')
        .select('*')
        .or(`candidate_id.eq.${id},linked_candidate_id.eq.${id}`)
        .or('attachment_kind.ilike.cv,document_type.ilike.cv')
        .order('created_at', { ascending: false });

      if (inboxDocs && inboxDocs.length > 0) {
        cvDoc = {
          storage_path: inboxDocs[0].storage_path,
          file_name: inboxDocs[0].file_name || 'CV.pdf',
          id: inboxDocs[0].id
        };
      }
    }

    if (!cvDoc || !cvDoc.storage_path) {
      return res.status(404).json({ error: 'CV not found for this candidate' });
    }

    // Determine bucket (inbox_attachments uses 'inbox' bucket, candidate_documents uses 'documents')
    const bucket = cvDoc.storage_path?.includes('inbox/') ? 'inbox' : 'documents';

    // Generate signed URL for download
    try {
      const { data, error: urlError } = await db.storage
        .from(bucket)
        .createSignedUrl(cvDoc.storage_path, 300); // 5 minute expiry

      if (urlError || !data?.signedUrl) {
        console.error('Signed URL error:', urlError);
        return res.status(500).json({ error: 'Failed to generate download URL' });
      }

      return res.json({
        download_url: data.signedUrl,
        filename: cvDoc.file_name,
        document_id: cvDoc.id
      });
    } catch (urlGenError: any) {
      console.error('Error generating signed URL:', urlGenError);
      return res.status(500).json({ error: 'Failed to generate download link' });
    }
  } catch (error: any) {
    console.error('Error fetching CV download URL:', error);
    res.status(500).json({ error: 'Failed to fetch CV download URL' });
  }
}

export async function uploadCandidatePhotoController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No photo file uploaded' });
    }

    const { supabaseAdminClient } = require('../config/database');
    const db = supabaseAdminClient();

    // Verify candidate exists
    const { data: candidate, error: candidateError } = await db
      .from('candidates')
      .select('id, name')
      .eq('id', id)
      .single();

    if (candidateError || !candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    // Generate storage path: candidates/{id}/photo/{filename}
    const timestamp = Date.now();
    const ext = req.file.originalname.split('.').pop() || 'jpg';
    const filename = `profile_${timestamp}.${ext}`;
    const storagePath = `candidates/${id}/photo/${filename}`;
    const bucket = 'documents';

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await db.storage
      .from(bucket)
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return res.status(500).json({ error: 'Failed to upload photo to storage' });
    }

    // Update candidate record with photo path
    const { error: updateError } = await db
      .from('candidates')
      .update({
        profile_photo_bucket: bucket,
        profile_photo_path: storagePath,
        photo_received: true,
        photo_received_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to update candidate with photo' });
    }

    // Generate signed URL for display
    const { data: signedUrlData, error: urlError } = await db.storage
      .from(bucket)
      .createSignedUrl(storagePath, 3600); // 1 hour expiry

    if (urlError) {
      console.error('Signed URL error:', urlError);
      // Photo uploaded successfully but URL generation failed
      return res.json({
        message: 'Photo uploaded successfully',
        photo_path: storagePath,
        photo_url: null
      });
    }

    return res.json({
      message: 'Photo uploaded successfully',
      photo_path: storagePath,
      photo_url: signedUrlData.signedUrl
    });
  } catch (error: any) {
    console.error('Error uploading candidate photo:', error);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
}

export async function bulkUpdateCandidateStatusController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';

    const { candidateIds, status } = req.body || {};
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({ error: 'candidateIds must be a non-empty array' });
    }
    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const result = await bulkUpdateCandidateStatus(candidateIds, status, userId);
    return res.json(result);
  } catch (error: any) {
    console.error('Error bulk updating candidate status:', error);
    return res.status(400).json({ error: error.message || 'Failed to bulk update status' });
  }
}