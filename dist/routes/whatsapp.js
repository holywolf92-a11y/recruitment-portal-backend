"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const errorHandling_1 = require("../utils/errorHandling");
const rateLimit_1 = require("../middleware/rateLimit");
const webhookLogger_1 = require("../middleware/webhookLogger");
const inboxService_1 = require("../services/inboxService");
const inboxAttachmentService_1 = require("../services/inboxAttachmentService");
const whatsappService_1 = require("../services/whatsappService");
const whatsappAIService_1 = require("../services/whatsappAIService");
const router = (0, express_1.Router)();
const logger = (0, errorHandling_1.createLogger)('WhatsAppRoute');
// Apply logging and error monitoring
router.use((0, webhookLogger_1.webhookLoggingMiddleware)('whatsapp'));
router.use((0, webhookLogger_1.webhookErrorMonitor)('whatsapp'));
function getWamid(body) {
    try {
        return body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
    }
    catch {
        return undefined;
    }
}
function verifySignature(req, res, next) {
    // Allow disabling signature validation for testing
    if (process.env.WHATSAPP_SKIP_SIGNATURE_VALIDATION === 'true') {
        logger.warn('Signature validation DISABLED - this should only be used for testing!');
        return next();
    }
    const signature = req.headers['x-hub-signature-256'];
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    const rawBody = req.rawBody;
    const ok = (0, whatsappService_1.validateWebhookSignature)(rawBody, signature, appSecret);
    if (!ok) {
        logger.warn('Invalid webhook signature', { hasSignature: !!signature, hasAppSecret: !!appSecret, hasRawBody: !!rawBody });
        return res.status(401).json({ error: 'Invalid signature' });
    }
    next();
}
router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const challenge = req.query['hub.challenge'];
    const token = req.query['hub.verify_token'];
    const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;
    if (mode === 'subscribe' && (0, whatsappService_1.validateWebhookToken)(token, verifyToken)) {
        return res.status(200).send(challenge || '');
    }
    return res.status(403).send('Forbidden');
});
router.post('/', rateLimit_1.whatsappLimiter, verifySignature, (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!accessToken || !phoneNumberId) {
        return res.status(500).json({ error: 'WhatsApp credentials not configured' });
    }
    const messageData = (0, whatsappService_1.extractMessageData)(req.body);
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
        return res.status(400).json({ error: 'Missing message ID' });
    }
    // Manual idempotency check
    const idempotencyKey = `whatsapp_${wamid}`;
    // TODO: Check Redis or database for duplicate wamid
    // For now, proceed (idempotency will be handled by database unique constraint)
    // Create inbox message
    const inboxMessage = await (0, inboxService_1.createInboxMessage)({
        source: 'whatsapp',
        externalMessageId: messageData.wamid,
        payload: messageData,
        status: 'pending',
        receivedAt: messageData.timestamp ? new Date(parseInt(messageData.timestamp, 10) * 1000).toISOString() : undefined,
    });
    // Handle media if present
    if (messageData.mediaId) {
        const meta = await (0, whatsappService_1.fetchMediaMetadata)(messageData.mediaId, accessToken);
        if (meta?.url) {
            const buffer = await (0, whatsappService_1.downloadMedia)(meta.url, accessToken);
            const fileName = meta?.file_name || meta?.id || `${messageData.mediaId}.bin`;
            const storagePath = `whatsapp/${messageData.wamid}/${fileName}`;
            await (0, inboxAttachmentService_1.createAttachment)({
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
    // Generate AI reply for text messages (but not for CV/document uploads)
    if ((0, whatsappAIService_1.shouldReplyWithAI)(messageData)) {
        try {
            const aiReply = await (0, whatsappAIService_1.generateWhatsAppReply)({
                from: messageData.from || '',
                text: messageData.text || '',
            });
            // Send the AI-generated reply
            if (messageData.from && aiReply) {
                await (0, whatsappService_1.sendMessage)(phoneNumberId, accessToken, messageData.from, aiReply);
                logger.info('Sent AI reply', {
                    to: messageData.from,
                    replyLength: aiReply.length
                });
            }
        }
        catch (error) {
            // Don't fail the webhook if AI reply fails - just log it
            logger.error('Failed to send AI reply', {
                error: error instanceof Error ? error.message : 'Unknown error',
                from: messageData.from
            });
        }
    }
    res.status(200).json({ status: 'received', id: inboxMessage.id });
}));
exports.default = router;
