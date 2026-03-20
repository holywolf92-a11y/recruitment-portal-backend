import { Router, Response } from 'express';
import { asyncHandler } from '../utils/errorHandling';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import {
  ensureHumanModeForSending,
  isWithin24HourWindow,
  listConversations,
  listMessages,
  markConversationRead,
  returnConversationToAI,
  takeOverConversation,
  recordOutboundMessage,
  recordTemplateMessage,
  getConversation,
} from '../services/whatsappInboxService';
import { sendMessage, sendTemplateMessage } from '../services/whatsappService';

const router = Router();

router.use(authenticate);
router.use(requireRole('admin', 'manager', 'recruiter'));

router.get(
  '/conversations',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : undefined;
    const result = await listConversations({ limit, offset });
    res.json(result);
  })
);

router.get(
  '/conversations/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const conversation = await getConversation(req.params.id);
    res.json(conversation);
  })
);

router.get(
  '/conversations/:id/messages',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const result = await listMessages(req.params.id, { limit });
    res.json(result);
  })
);

router.post(
  '/conversations/:id/mark-read',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const updated = await markConversationRead(req.params.id);
    res.json(updated);
  })
);

router.post(
  '/conversations/:id/takeover',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const updated = await takeOverConversation(req.params.id, req.user!.id);
    res.json(updated);
  })
);

router.post(
  '/conversations/:id/return-to-ai',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const updated = await returnConversationToAI(req.params.id);
    res.json(updated);
  })
);

router.post(
  '/conversations/:id/send-text',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      return res.status(500).json({ error: 'WhatsApp credentials not configured' });
    }

    const { text } = req.body ?? {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }

    const conversation = await getConversation(req.params.id);
    await ensureHumanModeForSending(conversation.id, req.user!.id);

    const withinWindow = await isWithin24HourWindow(conversation.id);
    if (!withinWindow) {
      return res.status(400).json({ error: '24h_window_expired', require_template: true });
    }

    const sendRes = await sendMessage(phoneNumberId, accessToken, conversation.phone_number, text);
    const metaMessageId = sendRes?.messages?.[0]?.id ?? null;

    const stored = await recordOutboundMessage({
      conversationId: conversation.id,
      direction: 'outbound',
      fromNumberId: phoneNumberId,
      toPhoneNumber: conversation.phone_number,
      body: text,
      metaMessageId: metaMessageId ?? undefined,
      status: 'sent',
      raw: sendRes,
      sentByUserId: req.user!.id,
    });

    res.status(201).json({ ok: true, message: stored.message });
  })
);

router.post(
  '/conversations/:id/send-template',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      return res.status(500).json({ error: 'WhatsApp credentials not configured' });
    }

    const { templateName, language, components } = req.body ?? {};
    if (!templateName || typeof templateName !== 'string') {
      return res.status(400).json({ error: 'templateName is required' });
    }
    const languageCode = typeof language === 'string' && language.trim() ? language : 'en_US';

    const conversation = await getConversation(req.params.id);
    await ensureHumanModeForSending(conversation.id, req.user!.id);

    const sendRes = await sendTemplateMessage(phoneNumberId, accessToken, conversation.phone_number, {
      name: templateName,
      language: languageCode,
      components: Array.isArray(components) ? components : undefined,
    });

    const metaMessageId = sendRes?.messages?.[0]?.id ?? null;

    const stored = await recordTemplateMessage({
      conversationId: conversation.id,
      fromNumberId: phoneNumberId,
      toPhoneNumber: conversation.phone_number,
      templateName,
      language: languageCode,
      metaMessageId: metaMessageId ?? undefined,
      status: 'sent',
      raw: sendRes,
      sentByUserId: req.user!.id,
    });

    res.status(201).json({ ok: true, message: stored.message });
  })
);

export default router;
