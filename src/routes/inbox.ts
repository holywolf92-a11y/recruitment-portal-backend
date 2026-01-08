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
  listAttachmentsForMessage
} from '../services/inboxAttachmentService';

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
    res.status(201).json(attachment);
  })
);

router.delete(
  '/attachments/:attachmentId',
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await deleteAttachment(req.params.attachmentId);
    res.json(deleted);
  })
);

export default router;
