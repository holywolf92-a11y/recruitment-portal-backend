import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandling';
import {
  createInboxMessage,
  deleteInboxMessage,
  getInboxMessageById,
  listInboxMessages,
  updateInboxMessage
} from '../services/inboxService';
import {
  createAttachment,
  deleteAttachment,
  listAttachmentsForMessage,
  getAttachmentById,
  enqueueCvParsingJobForAttachment,
} from '../services/inboxAttachmentService';
import { cvParsingQueue } from '../config/queue';
import { ParsingJobsService } from '../services/parsingJobsService';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { source, status, limit, offset } = req.query;
    const parsedLimit = limit ? parseInt(limit as string, 10) : undefined;
    const parsedOffset = offset ? parseInt(offset as string, 10) : undefined;

    const result = await listInboxMessages({
      source: source as string | undefined,
      status: status as string | undefined,
      limit: parsedLimit,
      offset: parsedOffset,
    });

    res.json(result);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const message = await getInboxMessageById(req.params.id);
    res.json(message);
  })
);

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { source, external_message_id, payload, status, received_at } = req.body ?? {};
    const message = await createInboxMessage({
      source,
      externalMessageId: external_message_id,
      payload,
      status,
      receivedAt: received_at,
    });
    res.status(201).json(message);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const updated = await updateInboxMessage(req.params.id, {
      status: req.body?.status,
      payload: req.body?.payload,
    });
    res.json(updated);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await deleteInboxMessage(req.params.id);
    res.json(deleted);
  })
);

router.get(
  '/:id/attachments',
  asyncHandler(async (req: Request, res: Response) => {
    const attachments = await listAttachmentsForMessage(req.params.id);
    res.json(attachments);
  })
);

router.post(
  '/:id/attachments',
  asyncHandler(async (req: Request, res: Response) => {
    const { file_name, mime_type, storage_bucket, storage_path, attachment_type, candidate_id, file_base64 } = req.body ?? {};
    if (!file_base64) {
      return res.status(400).json({ error: 'file_base64 is required' });
    }
    const buffer = Buffer.from(file_base64, 'base64');
    const attachment = await createAttachment({
      inboxMessageId: req.params.id,
      fileBuffer: buffer,
      fileName: file_name,
      mimeType: mime_type,
      attachmentType: attachment_type,
      storageBucket: storage_bucket,
      storagePath: storage_path,
      candidateId: candidate_id,
    });
    
    const shouldEnqueue = attachment?.attachment_kind === 'cv';
    let jobInfo = null;
    
    if (shouldEnqueue) {
      try {
        jobInfo = await enqueueCvParsingJobForAttachment(attachment.id, { force: false, expiresInSeconds: 3600 });
      } catch (enqueueErr) {
        console.error(`[InboxAttachment] Failed to enqueue CV parsing for ${attachment.id}:`, enqueueErr);
        // Don't fail the upload - file is saved, user can retry parsing later
        jobInfo = null;
      }
    }

    res.status(200).json({
      attachment,
      job_id: jobInfo?.jobId ?? null,
      status: jobInfo?.status ?? null,
    });
  })
);

router.delete(
  '/attachments/:attachmentId',
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await deleteAttachment(req.params.attachmentId);
    res.json(deleted);
  })
);

// Download attachment: return signed URL redirect so the file is served directly
// from Supabase, not proxied through Railway (avoids egress charges).
router.get(
  '/:messageId/attachments/:attachmentId/download',
  asyncHandler(async (req: Request, res: Response) => {
    const attachment = await getAttachmentById(req.params.attachmentId);
    if (!attachment || !attachment.storage_path) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    const { supabaseAdminClient } = require('../config/database');
    const db = supabaseAdminClient();
    const bucket = attachment.storage_bucket || 'documents';
    const { data, error } = await db.storage.from(bucket).createSignedUrl(attachment.storage_path, 300);
    if (error || !data?.signedUrl) {
      return res.status(500).json({ error: 'Failed to generate download URL' });
    }
    // 302 redirect — browser downloads directly from Supabase, zero Railway egress
    return res.redirect(302, data.signedUrl);
  })
);

// Trigger parsing job for an attachment
router.post(
  '/attachments/:attachmentId/process',
  asyncHandler(async (req: Request, res: Response) => {
    const { attachmentId } = req.params;
    
    // Validate attachmentId is a valid UUID
    if (!attachmentId || attachmentId === 'undefined' || attachmentId === 'null') {
      console.error(`[AttachmentProcess] Invalid attachmentId received: ${attachmentId}`);
      return res.status(400).json({ 
        error: 'Invalid attachment ID',
        message: 'Attachment ID must be a valid UUID' 
      });
    }
    
    const force = String((req.query as any)?.force ?? '').toLowerCase() === 'true' || String((req.query as any)?.force ?? '') === '1';
    console.log(`[AttachmentProcess] Starting for attachmentId=${attachmentId}`);
    const parsingJobs = new ParsingJobsService();

    let jobRow: { id: string } | null = null;

    try {
      // 1) Get attachment and generate signed URL
      console.log(`[AttachmentProcess] Fetching attachment ${attachmentId}...`);
      const attachment = await getAttachmentById(attachmentId);
      console.log(`[AttachmentProcess] Got attachment, creating job...`);
      const fileHash = attachment?.sha256 ?? null;

      // 2) Idempotency: if same attachment+hash already extracted, reuse job (unless forced)
      if (!force && fileHash) {
        console.log(`[AttachmentProcess] Checking for existing job with hash...`);
        const existing = await parsingJobs.findLatestExtractedForAttachment(attachmentId, fileHash);
        if (existing) {
          console.log(`[AttachmentProcess] Found existing job: ${existing.id}`);
          return res.json({ job_id: existing.id, status: 'extracted', reused: true });
        }
      }

      // 3) Create parsing job row
      console.log(`[AttachmentProcess] Creating new parsing job...`);
      const createdJobRow = await parsingJobs.createJob({ attachmentId, fileHash });
      jobRow = createdJobRow;
      console.log(`[AttachmentProcess] Created job: ${createdJobRow.id}`);

      // 4) Enqueue BullMQ job
      console.log(`[AttachmentProcess] Enqueueing to BullMQ...`);
      await cvParsingQueue.add(
        'parse',
        {
          jobId: createdJobRow.id,
          attachmentId,
          fileHash,
          force,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 200,
          removeOnFail: 200,
        }
      );
      console.log(`[AttachmentProcess] Successfully queued job`);

      res.status(202).json({ job_id: createdJobRow.id, status: 'queued' });
    } catch (err) {
      // If we created the DB job but couldn't enqueue (e.g. Redis down), mark it failed
      // so the UI doesn't remain stuck on "Queued" forever.
      if (jobRow?.id) {
        try {
          await parsingJobs.setStatus(jobRow.id, 'failed', {
            result_json: {
              error: 'QUEUE_ENQUEUE_FAILED',
              message: err instanceof Error ? err.message : String(err),
            },
          });
        } catch {
          // Best-effort only; original error still handled by asyncHandler.
        }
      }
      console.error(`[AttachmentProcess] Error:`, err instanceof Error ? err.message : String(err), err);
      throw err;  // Let asyncHandler deal with it
    }
  })
);

// Retry parsing job for an attachment (re-enqueue)
router.post(
  '/attachments/:attachmentId/retry',
  asyncHandler(async (req: Request, res: Response) => {
    const { attachmentId } = req.params;
    const jobInfo = await enqueueCvParsingJobForAttachment(attachmentId, {
      force: true,
      expiresInSeconds: 3600,
    });
    res.status(202).json({ job_id: jobInfo.jobId, status: jobInfo.status });
  })
);

export default router;
