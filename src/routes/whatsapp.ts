import { Router, Request, Response, NextFunction } from 'express';
import { asyncHandler, createLogger } from '../utils/errorHandling';
import { idempotencyMiddleware } from '../middleware/idempotency';
import { whatsappLimiter } from '../middleware/rateLimit';
import { webhookLoggingMiddleware, webhookErrorMonitor } from '../middleware/webhookLogger';
import { createInboxMessage } from '../services/inboxService';
import { createAttachment } from '../services/inboxAttachmentService';
import {
  extractMessageData,
  fetchMediaMetadata,
  downloadMedia,
  validateWebhookSignature,
  validateWebhookToken
} from '../services/whatsappService';

const router = Router();
const logger = createLogger('WhatsAppRoute');

// Apply logging and error monitoring
router.use(webhookLoggingMiddleware('whatsapp'));
router.use(webhookErrorMonitor('whatsapp'));

function getWamid(body: any): string | undefined {
  try {
    return body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
  } catch {
    return undefined;
  }
}

function verifySignature(req: Request, res: Response, next: NextFunction) {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const rawBody = (req as any).rawBody as string | undefined;

  const ok = validateWebhookSignature(rawBody, signature, appSecret);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  next();
}

router.get(
  '/',
  (req: Request, res: Response) => {
    const mode = req.query['hub.mode'] as string | undefined;
    const challenge = req.query['hub.challenge'] as string | undefined;
    const token = req.query['hub.verify_token'] as string | undefined;

    const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;
    if (mode === 'subscribe' && validateWebhookToken(token, verifyToken)) {
      return res.status(200).send(challenge || '');
    }
    return res.status(403).send('Forbidden');
  }
);

router.post(
  '/',
  whatsappLimiter,
  verifySignature,
  idempotencyMiddleware({
    resourceType: 'whatsapp',
    keyFromRequest: (req: Request) => {
      const wamid = getWamid(req.body);
      return wamid ? `whatsapp_${wamid}` : undefined;
    },
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      return res.status(500).json({ error: 'WhatsApp credentials not configured' });
    }

    const messageData = extractMessageData(req.body);
    if (!messageData) {
      return res.status(200).json({ status: 'no_message' });
    }

    // Create inbox message
    const inboxMessage = await createInboxMessage({
      source: 'whatsapp',
      externalMessageId: messageData.wamid,
      payload: messageData,
      status: 'pending',
      receivedAt: messageData.timestamp ? new Date(parseInt(messageData.timestamp, 10) * 1000).toISOString() : undefined,
    });

    // Handle media if present
    if (messageData.mediaId) {
      const meta = await fetchMediaMetadata(messageData.mediaId, accessToken);
      if (meta?.url) {
        const buffer = await downloadMedia(meta.url, accessToken);
        const fileName = meta?.file_name || meta?.id || `${messageData.mediaId}.bin`;
        const storagePath = `whatsapp/${messageData.wamid}/${fileName}`;
        await createAttachment({
          inboxMessageId: inboxMessage.id,
          fileBuffer: buffer,
          fileName,
          mimeType: meta?.mime_type,
          attachmentType: 'cv',
          storageBucket: 'inbox',
          storagePath,
          candidateId: undefined,
        });
      }
    }

    res.status(200).json({ status: 'received', id: inboxMessage.id });
  })
);

export default router;
