"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const errorHandling_1 = require("../utils/errorHandling");
const rateLimit_1 = require("../middleware/rateLimit");
const webhookLogger_1 = require("../middleware/webhookLogger");
const inboxService_1 = require("../services/inboxService");
const inboxAttachmentService_1 = require("../services/inboxAttachmentService");
const gmailService_1 = require("../services/gmailService");
const router = (0, express_1.Router)();
const logger = (0, errorHandling_1.createLogger)('GmailRoute');
// Apply logging and error monitoring
router.use((0, webhookLogger_1.webhookLoggingMiddleware)('gmail'));
router.use((0, webhookLogger_1.webhookErrorMonitor)('gmail'));
router.post('/', rateLimit_1.gmailLimiter, (0, errorHandling_1.asyncHandler)(async (req, res) => {
    const message = req.body?.message;
    if (!message || !message.data) {
        return res.status(400).json({ error: 'Invalid message format' });
    }
    // Base64 decode the pubsub message
    const data = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
    const emailAddress = data.emailAddress;
    const historyId = data.historyId;
    if (!emailAddress || !historyId) {
        return res.status(400).json({ error: 'Missing emailAddress or historyId' });
    }
    logger.info('Gmail push notification received', { emailAddress, historyId });
    // Acknowledge immediately (Pub/Sub requirement)
    res.status(200).json({ status: 'ack' });
    // Process in background
    processGmailNotification(emailAddress, historyId).catch((err) => {
        logger.error('Failed to process Gmail notification', err);
    });
}));
async function processGmailNotification(emailAddress, historyId) {
    try {
        // List recent messages with attachments
        const { messages } = await (0, gmailService_1.listMessages)(gmailService_1.GMAIL_CV_QUERY, 5);
        if (!messages || messages.length === 0) {
            logger.info('No new Gmail messages with attachments');
            return;
        }
        for (const msg of messages) {
            if (!msg.id)
                continue;
            const fullMessage = await (0, gmailService_1.getMessage)(msg.id);
            if (!fullMessage.attachments || fullMessage.attachments.length === 0)
                continue;
            // Create inbox message
            const externalId = `gmail_${fullMessage.id}`;
            const inboxMessage = await (0, inboxService_1.createInboxMessage)({
                source: 'gmail',
                externalMessageId: externalId,
                payload: {
                    from: fullMessage.from,
                    subject: fullMessage.subject,
                    internalDate: fullMessage.internalDate,
                },
                status: 'pending',
                receivedAt: fullMessage.internalDate,
            }).catch((err) => {
                if (String(err.message).includes('already exists')) {
                    logger.debug('Message already in inbox', { externalId });
                    return null;
                }
                throw err;
            });
            if (!inboxMessage)
                continue;
            // Download and store attachments
            for (const attachment of fullMessage.attachments) {
                if (!attachment.id)
                    continue;
                try {
                    const buffer = await (0, gmailService_1.getAttachment)(fullMessage.id, attachment.id);
                    const storagePath = `gmail/${fullMessage.id}/${attachment.filename}`;
                    await (0, inboxAttachmentService_1.createAttachment)({
                        inboxMessageId: inboxMessage.id,
                        fileBuffer: buffer,
                        fileName: attachment.filename,
                        mimeType: attachment.mimeType,
                        attachmentType: 'cv',
                        storageBucket: 'documents',
                        storagePath,
                        candidateId: undefined,
                    }).catch((err) => {
                        if (String(err.message).includes('Duplicate')) {
                            logger.debug('Attachment already exists', { filename: attachment.filename });
                            return null;
                        }
                        throw err;
                    });
                }
                catch (err) {
                    logger.error('Failed to download attachment', err, { filename: attachment.filename });
                }
            }
        }
    }
    catch (err) {
        logger.error('Failed to process Gmail notification', err);
    }
}
exports.default = router;
