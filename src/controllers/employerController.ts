import { Request, Response } from 'express';
import {
  createEmployer,
  getEmployerById,
  listEmployers,
  updateEmployer,
  deleteEmployer,
  CreateEmployerData,
  EmployerFilters,
} from '../services/employerService';

export async function createEmployerController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const employerData: CreateEmployerData = req.body;

    if (!employerData.company_name) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    const employer = await createEmployer(employerData, userId);
    res.status(201).json({ employer });
  } catch (error: any) {
    console.error('Error creating employer:', error);
    if (error.message?.includes('already exists')) {
      res.status(409).json({ error: error.message });
    } else {
      res.status(400).json({ error: error.message || 'Failed to create employer' });
    }
  }
}

export async function getEmployerController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Employer ID is required' });
    }

    const employer = await getEmployerById(id, userId);
    res.json({ employer });
  } catch (error: any) {
    console.error('Error fetching employer:', error);
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Employer not found' });
    } else {
      res.status(500).json({ error: 'Failed to fetch employer' });
    }
  }
}

export async function listEmployersController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';

    const filters: EmployerFilters = {
      search: req.query.search as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    };

    const result = await listEmployers(filters, userId);
    res.json(result);
  } catch (error: any) {
    console.error('Error listing employers:', error);
    res.status(500).json({ error: 'Failed to fetch employers' });
  }
}

export async function updateEmployerController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Employer ID is required' });
    }

    const updateData: Partial<CreateEmployerData> = req.body;

    const employer = await updateEmployer(id, updateData, userId);
    res.json({ employer });
  } catch (error: any) {
    console.error('Error updating employer:', error);
    if (error.message?.includes('already exists')) {
      res.status(409).json({ error: error.message });
    } else if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Employer not found' });
    } else {
      res.status(400).json({ error: error.message || 'Failed to update employer' });
    }
  }
}

export async function deleteEmployerController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Employer ID is required' });
    }

    await deleteEmployer(id, userId);
    res.json({ message: 'Employer deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting employer:', error);
    if (error.message?.includes('Cannot delete employer')) {
      res.status(409).json({ error: error.message });
    } else if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Employer not found' });
    } else {
      res.status(500).json({ error: 'Failed to delete employer' });
    }
  }
}
