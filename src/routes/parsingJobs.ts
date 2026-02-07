import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandling';
import { ParsingJobsService } from '../services/parsingJobsService';

const router = Router();

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const svc = new ParsingJobsService();
    const job = await svc.getJob(id);
    if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });

    res.json({
      id: job.id,
      attachment_id: job.attachment_id,
      status: job.status,
      attempts: job.attempts,
      schema_version: job.schema_version,
      result: job.result_json ?? null,
      error_code: job.error_code ?? null,
      error_message: job.error_message ?? null,
      started_at: job.started_at ?? null,
      finished_at: job.finished_at ?? null,
      created_at: job.created_at,
      updated_at: job.updated_at,
    });
  })
);

router.get(
  '/by-attachment/:attachmentId',
  asyncHandler(async (req: Request, res: Response) => {
    const { attachmentId } = req.params;
    const svc = new ParsingJobsService();
    const job = await svc.findLatestForAttachment(attachmentId);
    if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });

    res.json({
      id: job.id,
      attachment_id: job.attachment_id,
      status: job.status,
      attempts: job.attempts,
      schema_version: job.schema_version,
      result: job.result_json ?? null,
      error_code: job.error_code ?? null,
      error_message: job.error_message ?? null,
      started_at: job.started_at ?? null,
      finished_at: job.finished_at ?? null,
      created_at: job.created_at,
      updated_at: job.updated_at,
    });
  })
);

export default router;
