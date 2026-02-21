"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const errorHandling_1 = require("../utils/errorHandling");
const rateLimit_1 = require("../middleware/rateLimit");
const webhookLogger_1 = require("../middleware/webhookLogger");
const inboxService_1 = require("../services/inboxService");
const whatsappService_1 = require("../services/whatsappService");
const whatsappAIService_1 = require("../services/whatsappAIService");
const errorHandling_2 = require("../utils/errorHandling");
const whatsappInboxService_1 = require("../services/whatsappInboxService");
const queue_1 = require("../config/queue");
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
function extractStatusUpdate(body) {
    try {
        const st = body?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0];
        if (!st?.id || !st?.status)
            return null;
        return { id: st.id, status: st.status, timestamp: st.timestamp };
    }
    catch {
        return null;
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
    // Status updates (delivery/read) do not include `messages[]`
    const statusUpdate = extractStatusUpdate(req.body);
    if (statusUpdate) {
        try {
            await (0, whatsappInboxService_1.updateMessageStatus)(statusUpdate.id, statusUpdate.status);
        }
        catch (err) {
            logger.error('Failed to update WhatsApp message status (fail-open)', {
                err: err instanceof Error ? err.message : String(err),
                id: statusUpdate.id,
                status: statusUpdate.status,
            });
        }
        return res.status(200).json({ status: 'status_update' });
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
        // Fail-open: acknowledge to Meta to avoid retries
        logger.warn('Webhook message missing ID (fail-open)');
        return res.status(200).json({ status: 'missing_message_id' });
    }
    // Manual idempotency check
    const idempotencyKey = `whatsapp_${wamid}`;
    // TODO: Check Redis or database for duplicate wamid
    // For now, proceed (idempotency will be handled by database unique constraint)
    // Create inbox message (legacy inbox manager)
    let inboxMessage = null;
    try {
        inboxMessage = await (0, inboxService_1.createInboxMessage)({
            source: 'whatsapp',
            externalMessageId: messageData.wamid,
            payload: messageData,
            status: 'pending',
            receivedAt: messageData.timestamp ? new Date(parseInt(messageData.timestamp, 10) * 1000).toISOString() : undefined,
        });
    }
    catch (err) {
        // Duplicate is expected on retries; fail-open and acknowledge.
        if (err instanceof errorHandling_2.AppError && err.type === errorHandling_2.ErrorType.DUPLICATE) {
            logger.info('Duplicate inbox message (idempotent)', { wamid: messageData.wamid });
            return res.status(200).json({ status: 'duplicate' });
        }
        logger.error('Failed to create inbox message (fail-open)', { err: err instanceof Error ? err.message : String(err) });
        inboxMessage = null;
    }
    // Record in WhatsApp inbox tables
    const preview = messageData.type === 'text'
        ? messageData.text || ''
        : messageData.type
            ? `[${messageData.type}]`
            : '';
    const receivedAt = messageData.timestamp ? new Date(parseInt(messageData.timestamp, 10) * 1000) : new Date();
    let conversationForReply = null;
    if (messageData.from) {
        try {
            const recorded = await (0, whatsappInboxService_1.recordInboundMessage)({
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
        }
        catch (err) {
            logger.error('Failed to record inbound WhatsApp message (fail-open)', {
                err: err instanceof Error ? err.message : String(err),
                wamid: messageData.wamid,
            });
        }
    }
    else {
        logger.warn('WhatsApp webhook message missing from number (skip storing conversation)', { wamid: messageData.wamid });
    }
    // Handle media asynchronously (webhook must ACK quickly)
    if (messageData.mediaId && inboxMessage?.id && messageData.from) {
        try {
            const mediaJobId = `whatsapp-media:${messageData.wamid}:${messageData.mediaId}`;
            await queue_1.whatsappMediaQueue.add('process', {
                inboxMessageId: inboxMessage.id,
                wamid: messageData.wamid,
                fromPhone: messageData.from,
                mediaId: messageData.mediaId,
                mimeType: messageData.mimeType,
                fileName: messageData.fileName,
                receivedAt: receivedAt.toISOString(),
            }, {
                jobId: mediaJobId,
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: 200,
                removeOnFail: 200,
            });
        }
        catch (err) {
            logger.error('Failed to enqueue WhatsApp media processing (fail-open)', {
                err: err instanceof Error ? err.message : String(err),
                wamid: messageData.wamid,
                mediaId: messageData.mediaId,
            });
        }
    }
    // Generate AI reply for text messages (but not for CV/document uploads)
    // Only when conversation is in AI mode.
    if (conversationForReply?.reply_mode === 'ai' && (0, whatsappAIService_1.shouldReplyWithAI)(messageData)) {
        try {
            const aiReply = await (0, whatsappAIService_1.generateWhatsAppReply)({
                from: messageData.from || '',
                text: messageData.text || '',
            });
            // Send the AI-generated reply
            if (messageData.from && aiReply) {
                const sendRes = await (0, whatsappService_1.sendMessage)(phoneNumberId, accessToken, messageData.from, aiReply);
                const metaMessageId = sendRes?.messages?.[0]?.id ?? null;
                try {
                    await (0, whatsappInboxService_1.recordOutboundMessage)({
                        conversationId: conversationForReply.id,
                        direction: 'ai',
                        fromNumberId: phoneNumberId,
                        toPhoneNumber: messageData.from,
                        body: aiReply,
                        metaMessageId: metaMessageId ?? undefined,
                        status: 'sent',
                        raw: sendRes,
                    });
                }
                catch (err) {
                    logger.error('Failed to store AI outbound message (fail-open)', {
                        err: err instanceof Error ? err.message : String(err),
                    });
                }
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
    res.status(200).json({ status: 'received', id: inboxMessage?.id ?? null });
}));
exports.default = router;
