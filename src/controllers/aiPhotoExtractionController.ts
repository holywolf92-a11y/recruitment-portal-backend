import { Request, Response } from 'express';
import { extractProfilePhotoFromPdfUsingAI } from '../services/aiProfilePhotoExtractionService';

function requireTokenIfConfigured(req: Request) {
  const expected = process.env.EXTRACT_PHOTO_TOKEN;
  if (!expected) return;
  const got = (req.headers['x-extract-photo-token'] as string) || '';
  if (!got || got !== expected) {
    const err: any = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
}

/**
 * POST /api/documents/candidates/:candidateId/extract-photo-ai
 * Body: { documentId?: string, maxPages?: number }
 */
export async function extractPhotoFromPdfAiController(req: Request, res: Response) {
  try {
    requireTokenIfConfigured(req);

    const { candidateId } = req.params;
    const { documentId, maxPages } = req.body || {};

    if (!candidateId) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    const result = await extractProfilePhotoFromPdfUsingAI({
      candidateId,
      documentId,
      maxPages: typeof maxPages === 'number' ? maxPages : undefined,
    });

    return res.json({ success: true, ...result });
  } catch (err: any) {
    const status = err?.status || 500;
    return res.status(status).json({
      success: false,
      error: err?.message || 'Failed to extract photo',
    });
  }
}
