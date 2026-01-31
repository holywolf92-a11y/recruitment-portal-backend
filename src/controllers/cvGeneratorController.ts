import { Request, Response } from 'express';
import { generateBulkCVs, generateSingleCV, generateCV, BulkCVRequest, CVGenerationOptions } from '../services/cvGeneratorService';
import { asyncHandler } from '../utils/errorHandling';

/**
 * Generate a single CV for a candidate
 * GET /api/cv-generator/:candidateId?format=employer-safe
 */
export const generateSingleCVController = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || 'system';
  const { candidateId } = req.params;
  const format = (req.query.format as 'standard' | 'employer-safe' | 'internal') || 'employer-safe';
  const forceRegenerate = req.query.force === 'true';

  if (!candidateId) {
    return res.status(400).json({ error: 'Candidate ID is required' });
  }

  if (!['standard', 'employer-safe', 'internal'].includes(format)) {
    return res.status(400).json({ error: 'Invalid format. Must be "standard", "employer-safe", or "internal"' });
  }

  const result = await generateCV({
    candidateId,
    format: format as 'employer-safe' | 'internal' | 'standard',
    forceRegenerate,
    userId,
  });

  res.json({
    cv_url: result.cv_url,
    cached: result.cached,
    version_hash: result.version_hash,
    file_size: result.file_size,
  });
});

/**
 * Download CV for a candidate (redirects to signed URL)
 * GET /api/cv-generator/:candidateId/download?format=employer-safe&force=true
 */
export const downloadCVController = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || 'system';
  const { candidateId } = req.params;
  const format = (req.query.format as 'standard' | 'employer-safe' | 'internal') || 'employer-safe';
  const forceRegenerate = req.query.force === 'true';

  if (!candidateId) {
    return res.status(400).json({ error: 'Candidate ID is required' });
  }

  if (!['standard', 'employer-safe', 'internal'].includes(format)) {
    return res.status(400).json({ error: 'Invalid format. Must be "standard", "employer-safe", or "internal"' });
  }

  const result = await generateCV({
    candidateId,
    format: format as 'employer-safe' | 'internal' | 'standard',
    forceRegenerate,
    userId,
  });

  return res.redirect(302, result.cv_url);
});

/**
 * Generate CVs for multiple candidates (bulk operation)
 * POST /api/cv-generator/bulk
 */
export const generateBulkCVsController = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || 'system';
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
});

/**
 * Get CV generation status for a candidate
 * GET /api/cv-generator/:candidateId/status
 */
export const getCVStatusController = asyncHandler(async (req: Request, res: Response) => {
  const { candidateId } = req.params;
  const format = (req.query.format as 'standard' | 'employer-safe' | 'internal') || 'employer-safe';

  if (!candidateId) {
    return res.status(400).json({ error: 'Candidate ID is required' });
  }

  // Import supabase client
  const { supabaseAdminClient } = await import('../config/database');
  const db = supabaseAdminClient();

  // Check if CV exists in cache
  const { data: cached, error } = await db
    .from('generated_cvs')
    .select('version_hash, generated_at, file_size, access_count')
    .eq('candidate_id', candidateId)
    .eq('format', format)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!cached) {
    return res.json({
      exists: false,
      cached: false,
    });
  }

  // Note: To check if cached CV is still valid, we'd need to calculate current version hash
  // For now, return the cached CV status
  res.json({
    exists: true,
    cached: true,
    version_hash: cached.version_hash,
    generated_at: cached.generated_at,
    file_size: cached.file_size,
    access_count: cached.access_count,
  });
});
