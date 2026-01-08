import { Request, Response } from 'express';
import { generateBulkCVs, generateSingleCV, BulkCVRequest } from '../services/cvGeneratorService';

export async function generateBulkCVsController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const request: BulkCVRequest = req.body;

    if (!request.candidate_ids || !Array.isArray(request.candidate_ids) || request.candidate_ids.length === 0) {
      return res.status(400).json({ error: 'candidate_ids array is required and must not be empty' });
    }

    if (request.candidate_ids.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 candidates allowed per bulk request' });
    }

    const results = await generateBulkCVs(request, userId);

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.json({
      results,
      summary: {
        total: results.length,
        success: successCount,
        failed: failureCount,
      },
    });
  } catch (error: any) {
    console.error('Error generating bulk CVs:', error);
    res.status(500).json({ error: error.message || 'Failed to generate CVs' });
  }
}

export async function generateSingleCVController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { candidateId } = req.params;
    const format = (req.query.format as 'standard' | 'employer-safe') || 'standard';

    if (!candidateId) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    if (!['standard', 'employer-safe'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Must be "standard" or "employer-safe"' });
    }

    const result = await generateSingleCV(candidateId, format, userId);
    res.json(result);
  } catch (error: any) {
    console.error('Error generating CV:', error);
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Candidate not found' });
    } else {
      res.status(500).json({ error: error.message || 'Failed to generate CV' });
    }
  }
}
