import { Request, Response } from 'express';
import {
  createTemplate,
  getTemplateById,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  sendTemplateMessage,
  CreateTemplateData,
  TemplateFilters,
} from '../services/communicationService';

export async function createTemplateController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const templateData: CreateTemplateData = req.body;

    const template = await createTemplate(templateData, userId);
    res.status(201).json({ template });
  } catch (error: any) {
    console.error('Error creating template:', error);
    if (error.message?.includes('already exists')) {
      res.status(409).json({ error: error.message });
    } else {
      res.status(400).json({ error: error.message || 'Failed to create template' });
    }
  }
}

export async function getTemplateController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Template ID is required' });
    }

    const template = await getTemplateById(id, userId);
    res.json({ template });
  } catch (error: any) {
    console.error('Error fetching template:', error);
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Template not found' });
    } else {
      res.status(500).json({ error: 'Failed to fetch template' });
    }
  }
}

export async function listTemplatesController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';

    const filters: TemplateFilters = {
      search: req.query.search as string,
      channel: req.query.channel as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    };

    const result = await listTemplates(filters, userId);
    res.json(result);
  } catch (error: any) {
    console.error('Error listing templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
}

export async function updateTemplateController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Template ID is required' });
    }

    const updateData: Partial<CreateTemplateData> = req.body;

    const template = await updateTemplate(id, updateData, userId);
    res.json({ template });
  } catch (error: any) {
    console.error('Error updating template:', error);
    if (error.message?.includes('already exists')) {
      res.status(409).json({ error: error.message });
    } else if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Template not found' });
    } else {
      res.status(400).json({ error: error.message || 'Failed to update template' });
    }
  }
}

export async function deleteTemplateController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Template ID is required' });
    }

    await deleteTemplate(id, userId);
    res.json({ message: 'Template deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting template:', error);
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Template not found' });
    } else {
      res.status(500).json({ error: 'Failed to delete template' });
    }
  }
}

export async function sendTemplateMessageController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';
    const { templateId, candidateId } = req.params;
    const { variables } = req.body;

    if (!templateId) {
      return res.status(400).json({ error: 'Template ID is required' });
    }

    if (!candidateId) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    const result = await sendTemplateMessage(templateId, candidateId, variables || {}, userId);
    res.json(result);
  } catch (error: any) {
    console.error('Error sending message:', error);
    if (error.message?.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message || 'Failed to send message' });
    }
  }
}
