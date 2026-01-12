import { Request, Response } from 'express';
import {
  createTimelineEvent,
  getCandidateTimeline,
  getTimelineEvent,
  CreateTimelineEventData,
} from '../services/timelineService';

export async function createTimelineEventController(req: Request, res: Response) {
  try {
    const userId = 'test-user-id';

    const eventData: CreateTimelineEventData = {
      ...req.body,
      actor_user_id: req.body.actor_user_id || userId,
    };

    // Validate required fields
    if (!eventData.candidate_id) {
      return res.status(400).json({ error: 'candidate_id is required' });
    }
    if (!eventData.event_category) {
      return res.status(400).json({ error: 'event_category is required' });
    }
    if (!eventData.event_type) {
      return res.status(400).json({ error: 'event_type is required' });
    }

    const event = await createTimelineEvent(eventData);
    res.status(201).json({ event });
  } catch (error: any) {
    console.error('Error creating timeline event:', error);
    res.status(400).json({ error: error.message || 'Failed to create timeline event' });
  }
}

export async function getCandidateTimelineController(req: Request, res: Response) {
  try {
    const { candidateId } = req.params;

    if (!candidateId) {
      return res.status(400).json({ error: 'Candidate ID is required' });
    }

    const options = {
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      category: req.query.category as string,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
    };

    const result = await getCandidateTimeline(candidateId, options);
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching timeline:', error);
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
}

export async function getTimelineEventController(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Event ID is required' });
    }

    const event = await getTimelineEvent(id);
    res.json({ event });
  } catch (error: any) {
    console.error('Error fetching timeline event:', error);
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Timeline event not found' });
    } else {
      res.status(500).json({ error: 'Failed to fetch timeline event' });
    }
  }
}
