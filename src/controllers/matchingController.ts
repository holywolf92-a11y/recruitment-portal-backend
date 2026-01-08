import { Request, Response } from 'express';
import {
  matchCandidatesForJob,
  saveCandidateMatches,
  getJobMatches,
  deleteCandidateMatch,
  MatchingParams,
} from '../services/matchingService';

export async function matchCandidatesController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const params: MatchingParams = req.body;

    if (!params.job_order_id) {
      return res.status(400).json({ error: 'job_order_id is required' });
    }

    const matches = await matchCandidatesForJob(params, userId);

    res.json({
      matches,
      count: matches.length,
    });
  } catch (error: any) {
    console.error('Error matching candidates:', error);
    if (error.message?.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message || 'Failed to match candidates' });
    }
  }
}

export async function saveMatchesController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { job_order_id, candidate_ids, scores } = req.body;

    if (!job_order_id) {
      return res.status(400).json({ error: 'job_order_id is required' });
    }

    if (!candidate_ids || !Array.isArray(candidate_ids)) {
      return res.status(400).json({ error: 'candidate_ids array is required' });
    }

    if (!scores || !Array.isArray(scores) || scores.length !== candidate_ids.length) {
      return res.status(400).json({ error: 'scores array must match candidate_ids length' });
    }

    const matches = await saveCandidateMatches(job_order_id, candidate_ids, scores, userId);

    res.status(201).json({ matches });
  } catch (error: any) {
    console.error('Error saving matches:', error);
    res.status(400).json({ error: error.message || 'Failed to save matches' });
  }
}

export async function getJobMatchesController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { jobOrderId } = req.params;

    if (!jobOrderId) {
      return res.status(400).json({ error: 'Job order ID is required' });
    }

    const matches = await getJobMatches(jobOrderId, userId);

    res.json({ matches });
  } catch (error: any) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
}

export async function deleteMatchController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { matchId } = req.params;

    if (!matchId) {
      return res.status(400).json({ error: 'Match ID is required' });
    }

    await deleteCandidateMatch(matchId, userId);

    res.json({ message: 'Match deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting match:', error);
    res.status(500).json({ error: 'Failed to delete match' });
  }
}
