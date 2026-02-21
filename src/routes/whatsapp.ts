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
  validateWebhookToken,
  sendMessage
} from '../services/whatsappService';
import { generateWhatsAppReply, shouldReplyWithAI } from '../services/whatsappAIService';
import { AppError, ErrorType } from '../utils/errorHandling';
import {
  recordInboundMessage,
  recordOutboundMessage,
  updateMessageStatus,
} from '../services/whatsappInboxService';

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

function extractStatusUpdate(body: any): { id: string; status: string; timestamp?: string } | null {
  try {
    const st = body?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0];
    if (!st?.id || !st?.status) return null;
    return { id: st.id, status: st.status, timestamp: st.timestamp };
  } catch {
    return null;
  }
}

function verifySignature(req: Request, res: Response, next: NextFunction) {
  // Allow disabling signature validation for testing
  if (process.env.WHATSAPP_SKIP_SIGNATURE_VALIDATION === 'true') {
    logger.warn('Signature validation DISABLED - this should only be used for testing!');
    return next();
  }

  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const rawBody = (req as any).rawBody as string | undefined;

  const ok = validateWebhookSignature(rawBody, signature, appSecret);
  if (!ok) {
    logger.warn('Invalid webhook signature', { hasSignature: !!signature, hasAppSecret: !!appSecret, hasRawBody: !!rawBody });
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
  asyncHandler(async (req: Request, res: Response) => {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      return res.status(500).json({ error: 'WhatsApp credentials not configured' });
    }

    // Status updates (delivery/read) do not include `messages[]`
    const statusUpdate = extractStatusUpdate(req.body);
    if (statusUpdate) {
      try {
        await updateMessageStatus(statusUpdate.id, statusUpdate.status);
      } catch (err) {
        logger.error('Failed to update WhatsApp message status (fail-open)', {
          err: err instanceof Error ? err.message : String(err),
          id: statusUpdate.id,
          status: statusUpdate.status,
        });
      }
      return res.status(200).json({ status: 'status_update' });
    }

    const messageData = extractMessageData(req.body);
    if (!messageData) {
      // No message in webhook (could be status update, etc.) - just acknowledge
      logger.info('Webhook received without message (likely status update)', {
        hasEntry: !!req.body?.entry,
        hasChanges: !!req.body?.entry?.[0]?.changes?.[0],
      });
      return res.status(200).json({ status: 'no_message' });
    }

    // Apply idempotency check only for actual messages
    const wamid = messageData.wamid;
    if (!wamid) {
      // Fail-open: acknowledge to Meta to avoid retries
      logger.warn('Webhook message missing ID (fail-open)');
      return res.status(200).json({ status: 'missing_message_id' });
    }

    // Manual idempotency check
    const idempotencyKey = `whatsapp_${wamid}`;
    // TODO: Check Redis or database for duplicate wamid
    // For now, proceed (idempotency will be handled by database unique constraint)

    // Create inbox message (legacy inbox manager)
    let inboxMessage: any = null;
    try {
      inboxMessage = await createInboxMessage({
        source: 'whatsapp',
        externalMessageId: messageData.wamid,
        payload: messageData,
        status: 'pending',
        receivedAt: messageData.timestamp ? new Date(parseInt(messageData.timestamp, 10) * 1000).toISOString() : undefined,
      });
    } catch (err) {
      // Duplicate is expected on retries; fail-open and acknowledge.
      if (err instanceof AppError && err.type === ErrorType.DUPLICATE) {
        logger.info('Duplicate inbox message (idempotent)', { wamid: messageData.wamid });
        return res.status(200).json({ status: 'duplicate' });
      }
      logger.error('Failed to create inbox message (fail-open)', { err: err instanceof Error ? err.message : String(err) });
      inboxMessage = null;
    }

    // Record in WhatsApp inbox tables
    const preview =
      messageData.type === 'text'
        ? messageData.text || ''
        : messageData.type
          ? `[${messageData.type}]`
          : '';

    const receivedAt = messageData.timestamp ? new Date(parseInt(messageData.timestamp, 10) * 1000) : new Date();

    let conversationForReply: { id: string; phone_number: string; reply_mode: 'ai' | 'human' } | null = null;
    if (messageData.from) {
      try {
        const recorded = await recordInboundMessage({
          phoneNumber: messageData.from,
        toPhoneNumberId: phoneNumberId,
        metaMessageId: messageData.wamid,
        bodyPreview: preview,
        messageType: messageData.type,
        raw: messageData.raw,
        media: messageData.mediaId
          ? { mediaId: messageData.mediaId, mimeType: messageData.mimeType, fileName: messageData.fileName }
          : undefined,
          receivedAt,
        });
        if (recorded.duplicated) {
          logger.info('Duplicate WhatsApp message (idempotent)', { wamid: messageData.wamid });
          return res.status(200).json({ status: 'duplicate' });
        }
        conversationForReply = recorded.conversation;
      } catch (err) {
        logger.error('Failed to record inbound WhatsApp message (fail-open)', {
          err: err instanceof Error ? err.message : String(err),
          wamid: messageData.wamid,
        });
      }
    } else {
      logger.warn('WhatsApp webhook message missing from number (skip storing conversation)', { wamid: messageData.wamid });
    }

    // Handle media if present
    if (messageData.mediaId) {
      const meta = await fetchMediaMetadata(messageData.mediaId, accessToken);
      if (meta?.url) {
        const buffer = await downloadMedia(meta.url, accessToken);
        const fileName = meta?.file_name || meta?.id || `${messageData.mediaId}.bin`;
        const storagePath = `whatsapp/${messageData.wamid}/${fileName}`;
        if (inboxMessage?.id) {
          await createAttachment({
            inboxMessageId: inboxMessage.id,
            fileBuffer: buffer,
            fileName,
            mimeType: meta?.mime_type,
            attachmentType: 'cv',
            storageBucket: 'documents',
            storagePath,
            candidateId: undefined,
          });
        }
      }
    }

    // Generate AI reply for text messages (but not for CV/document uploads)
    // Only when conversation is in AI mode.
    if (conversationForReply?.reply_mode === 'ai' && shouldReplyWithAI(messageData)) {
      try {
        const aiReply = await generateWhatsAppReply({
          from: messageData.from || '',
          text: messageData.text || '',
        });

        // Send the AI-generated reply
        if (messageData.from && aiReply) {
          const sendRes = await sendMessage(phoneNumberId, accessToken, messageData.from, aiReply);
          const metaMessageId = sendRes?.messages?.[0]?.id ?? null;
          try {
            await recordOutboundMessage({
              conversationId: conversationForReply.id,
              direction: 'ai',
              fromNumberId: phoneNumberId,
              toPhoneNumber: messageData.from,
              body: aiReply,
              metaMessageId: metaMessageId ?? undefined,
              status: 'sent',
              raw: sendRes,
            });
          } catch (err) {
            logger.error('Failed to store AI outbound message (fail-open)', {
              err: err instanceof Error ? err.message : String(err),
            });
          }
          logger.info('Sent AI reply', { 
            to: messageData.from, 
            replyLength: aiReply.length 
          });
        }
      } catch (error) {
        // Don't fail the webhook if AI reply fails - just log it
        logger.error('Failed to send AI reply', { 
          error: error instanceof Error ? error.message : 'Unknown error',
          from: messageData.from 
        });
      }
    }

    res.status(200).json({ status: 'received', id: inboxMessage?.id ?? null });
  })
);

export default router;
