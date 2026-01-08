import { Request, Response } from 'express';
// import { AuthRequest } from '../middleware/auth';
import {
  createCandidate,
  getCandidateById,
  listCandidates,
  updateCandidate,
  deleteCandidate,
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