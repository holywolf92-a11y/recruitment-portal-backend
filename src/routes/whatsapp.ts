import { Router, Request, Response, NextFunction } from 'express';
import { asyncHandler, createLogger } from '../utils/errorHandling';
import { whatsappLimiter } from '../middleware/rateLimit';
import { webhookLoggingMiddleware, webhookErrorMonitor } from '../middleware/webhookLogger';
import { createInboxMessage } from '../services/inboxService';
import { supabaseAdminClient } from '../config/database';
import {
  extractMessageData,
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
import { whatsappMediaQueue } from '../config/queue';
import { handleBotMessageFrom, BotIncoming } from '../services/whatsappBotService';

/** Extract interactive button/list selection from the raw webhook payload. */
function extractInteractiveData(body: any): { id: string; title: string } {
  try {
    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg?.type !== 'interactive') return { id: '', title: '' };
    const ia = msg.interactive;
    if (ia?.type === 'button_reply') {
      return { id: ia.button_reply?.id ?? '', title: ia.button_reply?.title ?? '' };
    }
    if (ia?.type === 'list_reply') {
      return { id: ia.list_reply?.id ?? '', title: ia.list_reply?.title ?? '' };
    }
  } catch { /* ignore */ }
  return { id: '', title: '' };
}

// ── Internal company numbers — skip AI/bot, process docs silently ─────────────
// Format: international without leading '+' (WhatsApp sends 92xxxxxxxxxx for PK)
const INTERNAL_NUMBERS = new Set([
  '923005787762',
  '923005547806',
  '923451897011',
  '923465028305',
]);

function isInternalNumber(phone: string): boolean {
  const normalized = phone.replace(/^\+/, '').trim();
  // Also handle if number is stored as 0xxx (convert to 92xxx Pakistan format)
  const withCountry = normalized.startsWith('0') ? '92' + normalized.slice(1) : normalized;
  return INTERNAL_NUMBERS.has(normalized) || INTERNAL_NUMBERS.has(withCountry);
}

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

    if (messageData.bridgeMetadata) {
      logger.info('Detected Falisha bridge metadata on inbound WhatsApp media', {
        wamid: messageData.wamid,
        forwardedBy: messageData.bridgeMetadata.forwardedByPhone,
        originalSender: messageData.bridgeMetadata.originalSenderPhone,
        bridgeAccountId: messageData.bridgeMetadata.bridgeAccountId,
        originalMessageId: messageData.bridgeMetadata.originalMessageId,
      });
    }

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
      messageData.bridgeMetadata
        ? `[FALISHA_BRIDGE] ${messageData.bridgeMetadata.bridgeLabel || messageData.bridgeMetadata.bridgeAccountId || 'bridge'} <= ${messageData.bridgeMetadata.originalSenderPhone || messageData.bridgeMetadata.originalSender || 'unknown'}`
        : typeof messageData.text === 'string' && messageData.text.trim()
        ? messageData.text.trim()
        : messageData.type
          ? `[${messageData.type}]`
          : '';

    const receivedAt = messageData.timestamp ? new Date(parseInt(messageData.timestamp, 10) * 1000) : new Date();
    const effectiveFrom = messageData.effectiveFrom || messageData.from;

    let conversationForReply: { id: string; phone_number: string; reply_mode: 'ai' | 'human' } | null = null;
    if (effectiveFrom) {
      try {
        const recorded = await recordInboundMessage({
          phoneNumber: effectiveFrom,
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
          effectiveFrom,
        });
      }
    } else {
      logger.warn('WhatsApp webhook message missing effective sender number (skip storing conversation)', { wamid: messageData.wamid });
    }

    // Handle media asynchronously (webhook must ACK quickly)
    if (messageData.mediaId && inboxMessage?.id && effectiveFrom) {
      try {
        const mediaJobId = `whatsapp-media:${messageData.wamid}:${messageData.mediaId}`;
        const isInternal = isInternalNumber(effectiveFrom);
        await whatsappMediaQueue.add(
          'process',
          {
            inboxMessageId: inboxMessage.id,
            wamid: messageData.wamid,
            fromPhone: effectiveFrom,
            mediaId: messageData.mediaId,
            mimeType: messageData.mimeType,
            fileName: messageData.fileName,
            receivedAt: receivedAt.toISOString(),
            source: messageData.bridgeMetadata
              ? 'whatsapp_bridge'
              : isInternal
                ? 'internal_whatsapp_upload'
                : 'whatsapp',
          },
          {
            jobId: mediaJobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 200,
            removeOnFail: 200,
          }
        );
      } catch (err) {
        logger.error('Failed to enqueue WhatsApp media processing (fail-open)', {
          err: err instanceof Error ? err.message : String(err),
          wamid: messageData.wamid,
          mediaId: messageData.mediaId,
        });
      }
    }

    // ── Internal number early exit — no AI, no bot, just process + optional confirm ──
    if (effectiveFrom && isInternalNumber(effectiveFrom)) {
      if (messageData.mediaId) {
        // Attachment already queued above — send confirmation receipt
        const confirmMsg =
          '\u2705 *Document Received*\nYour document has been successfully received and processed.\nThe candidate record has been updated in the system.\n\u2014 Falisha Manpower Automation';
        try {
          await sendMessage(phoneNumberId, accessToken, effectiveFrom, confirmMsg);
          logger.info('Sent internal upload confirmation', { to: effectiveFrom });
        } catch (err) {
          logger.warn('Failed to send internal confirmation (non-fatal)', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        // Text-only from internal number — no reply, mark processed silently
        if (inboxMessage?.id) {
          try {
            const db = supabaseAdminClient();
            await db.from('inbox_messages').update({ status: 'processed' }).eq('id', inboxMessage.id);
          } catch { /* non-fatal */ }
        }
        logger.info('Text-only from internal number — ignored silently', { from: effectiveFrom });
      }
      return res.status(200).json({ status: 'internal_number' });
    }

    // ── WhatsApp Bot intercept (text, interactive buttons/lists, and media in active flows) ──
    // Called BEFORE the AI reply so the bot can handle any message type.
    // Returns true → skip AI reply entirely.
    let botHandledMessage = false;
    if (effectiveFrom && conversationForReply?.reply_mode === 'ai') {
      const { id: interactiveId, title: interactiveTitle } = extractInteractiveData(req.body);
      const rawText = messageData.type === 'interactive'
        ? interactiveTitle
        : (messageData.text ?? '');
      const botIncoming: BotIncoming = {
        type: messageData.type === 'interactive'
          ? 'interactive'
          : messageData.mediaId
            ? 'media'
            : messageData.type === 'text'
              ? 'text'
              : 'other',
        text: rawText.toLowerCase().trim(),
        rawText,
        interactiveId,
        interactiveTitle,
        hasMedia: !!messageData.mediaId,
        mediaType: messageData.type ?? '',
        mediaId: messageData.mediaId ?? '',
        mimeType: messageData.mimeType ?? '',
        fileName: messageData.fileName ?? '',
        inboxMessageId: inboxMessage?.id ?? null,
        conversationId: conversationForReply?.id ?? null,
      };

      try {
        botHandledMessage = await handleBotMessageFrom({
          from: effectiveFrom,
          phoneNumberId,
          accessToken,
          incoming: botIncoming,
        });
        if (botHandledMessage) {
          return res.status(200).json({ status: 'bot_handled' });
        }
      } catch (botErr) {
        logger.error('Bot handler error (fail-open)', {
          err: botErr instanceof Error ? botErr.message : String(botErr),
          from: messageData.from,
        });
        // Fall through to AI reply
      }
    }

    // Generate AI reply for text messages (but not for CV/document uploads)
    // Only when conversation is in AI mode and the bot did not handle the message.
    if (!botHandledMessage && conversationForReply?.reply_mode === 'ai' && shouldReplyWithAI(messageData)) {
      try {
        const aiReply = await generateWhatsAppReply({
          from: effectiveFrom || '',
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

    // Mark text-only (no-media) legacy inbox_messages as processed immediately.
    // Media messages are marked 'processed' by whatsappMediaWorker after download.
    // Without this, every text message stays 'pending' in the legacy table forever.
    if (!messageData.mediaId && inboxMessage?.id) {
      try {
        const db = supabaseAdminClient();
        await db.from('inbox_messages').update({ status: 'processed' }).eq('id', inboxMessage.id);
      } catch (err) {
        // Non-fatal — legacy table cleanup only
        logger.warn('Failed to mark text inbox_message as processed (non-fatal)', {
          inboxMessageId: inboxMessage.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  })
);

export default router;
