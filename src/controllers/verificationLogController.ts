import { Request, Response } from 'express';
import { documentVerificationLogService } from '../services/documentVerificationLogService';

/**
 * Get verification logs by request_id
 */
export async function getVerificationLogsByRequestId(req: Request, res: Response) {
  try {
    const { requestId } = req.params;

    if (!requestId) {
      return res.status(400).json({
        success: false,
        error: 'request_id is required',
      });
    }

    const logs = await documentVerificationLogService.getLogsByRequestId(requestId);

    return res.json({
      success: true,
      request_id: requestId,
      total_events: logs.length,
      logs,
    });
  } catch (error: any) {
    console.error('[getVerificationLogsByRequestId] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch verification logs',
      message: error.message,
    });
  }
}

/**
 * Get verification logs by document_id
 */
export async function getVerificationLogsByDocumentId(req: Request, res: Response) {
  try {
    const { documentId } = req.params;

    if (!documentId) {
      return res.status(400).json({
        success: false,
        error: 'document_id is required',
      });
    }

    const logs = await documentVerificationLogService.getLogsByDocumentId(documentId);

    return res.json({
      success: true,
      document_id: documentId,
      total_events: logs.length,
      logs,
    });
  } catch (error: any) {
    console.error('[getVerificationLogsByDocumentId] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch verification logs',
      message: error.message,
    });
  }
}

/**
 * Get verification logs by candidate_id
 */
export async function getVerificationLogsByCandidateId(req: Request, res: Response) {
  try {
    const { candidateId } = req.params;

    if (!candidateId) {
      return res.status(400).json({
        success: false,
        error: 'candidate_id is required',
      });
    }

    const logs = await documentVerificationLogService.getLogsByCandidateId(candidateId);

    return res.json({
      success: true,
      candidate_id: candidateId,
      total_events: logs.length,
      logs,
    });
  } catch (error: any) {
    console.error('[getVerificationLogsByCandidateId] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch verification logs',
      message: error.message,
    });
  }
}

/**
 * Get verification timeline view (aggregated view with processing durations)
 */
export async function getVerificationTimeline(req: Request, res: Response) {
  try {
    const { candidateId, documentId, limit = '50' } = req.query;

    const limitNum = parseInt(limit as string, 10);

    // Build query for document_verification_timeline view
    const db = (await import('../config/database')).supabaseAdminClient();
    let query = db
      .from('document_verification_timeline')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limitNum);

    if (candidateId) {
      query = query.eq('candidate_id', candidateId);
    }

    if (documentId) {
      query = query.eq('document_id', documentId);
    }

    const { data: timeline, error } = await query;

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    return res.json({
      success: true,
      total: timeline?.length || 0,
      filters: { candidateId, documentId, limit: limitNum },
      logs: timeline || [], // Test expects 'logs' not 'timeline'
      timeline: timeline || [],
    });
  } catch (error: any) {
    console.error('[getVerificationTimeline] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch verification timeline',
      message: error.message,
    });
  }
}

/**
 * Get verification statistics for a candidate
 */
export async function getVerificationStatsByCandidate(req: Request, res: Response) {
  try {
    const { candidateId } = req.params;

    if (!candidateId) {
      return res.status(400).json({
        success: false,
        error: 'candidate_id is required',
      });
    }

    const db = (await import('../config/database')).supabaseAdminClient();

    // Get document counts by verification status
    const { data: documents, error: docsError } = await db
      .from('candidate_documents')
      .select('id, verification_status, category')
      .eq('candidate_id', candidateId);

    if (docsError) {
      throw new Error(`Database error: ${docsError.message}`);
    }

    // Group by verification status
    const statusCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};

    documents?.forEach((doc) => {
      const status = doc.verification_status || 'unknown';
      const category = doc.category || 'unknown';

      statusCounts[status] = (statusCounts[status] || 0) + 1;
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    });

    // Get recent verification events
    const { data: recentEvents, error: eventsError } = await db
      .from('document_verification_logs')
      .select('id, event_type, created_at, verification_status, reason_code')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (eventsError) {
      throw new Error(`Events error: ${eventsError.message}`);
    }

    return res.json({
      success: true,
      candidate_id: candidateId,
      stats: { // Test expects 'stats' not 'statistics'
        total_documents: documents?.length || 0,
        by_status: statusCounts,
        by_category: categoryCounts,
      },
      statistics: { // Keep both for compatibility
        total_documents: documents?.length || 0,
        by_status: statusCounts,
        by_category: categoryCounts,
      },
      recent_events: recentEvents || [],
    });
  } catch (error: any) {
    console.error('[getVerificationStatsByCandidate] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch verification statistics',
      message: error.message,
    });
  }
}
