"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const errorHandling_1 = require("../utils/errorHandling");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const whatsappInboxService_1 = require("../services/whatsappInboxService");
const whatsappService_1 = require("../services/whatsappService");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use((0, rbac_1.requireRole)('admin', 'manager', 'recruiter'));
router.get('/conversations', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : undefined;
    const result = await (0, whatsappInboxService_1.listConversations)({ limit, offset });
    res.json(result);
}));
router.get('/conversations/:id', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const conversation = await (0, whatsappInboxService_1.getConversation)(req.params.id);
    res.json(conversation);
}));
router.get('/conversations/:id/messages', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const result = await (0, whatsappInboxService_1.listMessages)(req.params.id, { limit });
    res.json(result);
}));
router.post('/conversations/:id/mark-read', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const updated = await (0, whatsappInboxService_1.markConversationRead)(req.params.id);
    res.json(updated);
}));
router.post('/conversations/:id/takeover', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const updated = await (0, whatsappInboxService_1.takeOverConversation)(req.params.id, req.user.id);
    res.json(updated);
}));
router.post('/conversations/:id/return-to-ai', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const updated = await (0, whatsappInboxService_1.returnConversationToAI)(req.params.id);
    res.json(updated);
}));
router.post('/conversations/:id/send-text', (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!accessToken || !phoneNumberId) {
        return res.status(500).json({ error: 'WhatsApp credentials not configured' });
    }
    const { text } = req.body ?? {};
    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
    }
    const conversation = await (0, whatsappInboxService_1.getConversation)(req.params.id);
    await (0, whatsappInboxService_1.ensureHumanModeForSending)(conversation.id, req.user.id);
    const withinWindow = await (0, whatsappInboxService_1.isWithin24HourWindow)(conversation.id);
    if (!withinWindow) {
        return res.status(400).json({ error: '24h_window_expired', require_template: true });
    }
    const sendRes = await (0, whatsappService_1.sendMessage)(phoneNumberId, accessToken, conversation.phone_number, text);
    const metaMessageId = sendRes?.messages?.[0]?.id ?? null;
    const stored = await (0, whatsappInboxService_1.recordOutboundMessage)({
        conversationId: conversation.id,
        direction: 'outbound',
        fromNumberId: phoneNumberId,
        toPhoneNumber: conversation.phone_number,
        body: text,
        metaMessageId: metaMessageId ?? undefined,
        status: 'sent',
        raw: sendRes,
        sentByUserId: req.user.id,
    });
    res.status(201).json({ ok: true, message: stored.message });
}));
router.post('/conversations/:id/send-template', (0, errorHandling_1.asyncHandler)(async (req, res) => {
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
    const conversation = await (0, whatsappInboxService_1.getConversation)(req.params.id);
    await (0, whatsappInboxService_1.ensureHumanModeForSending)(conversation.id, req.user.id);
    const sendRes = await (0, whatsappService_1.sendTemplateMessage)(phoneNumberId, accessToken, conversation.phone_number, {
        name: templateName,
        language: languageCode,
        components: Array.isArray(components) ? components : undefined,
    });
    const metaMessageId = sendRes?.messages?.[0]?.id ?? null;
    const stored = await (0, whatsappInboxService_1.recordTemplateMessage)({
        conversationId: conversation.id,
        fromNumberId: phoneNumberId,
        toPhoneNumber: conversation.phone_number,
        templateName,
        language: languageCode,
        metaMessageId: metaMessageId ?? undefined,
        status: 'sent',
        raw: sendRes,
        sentByUserId: req.user.id,
    });
    res.status(201).json({ ok: true, message: stored.message });
}));
exports.default = router;
