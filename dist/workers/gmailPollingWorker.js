"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startGmailPolling = startGmailPolling;
const errorHandling_1 = require("../utils/errorHandling");
const inboxService_1 = require("../services/inboxService");
const inboxAttachmentService_1 = require("../services/inboxAttachmentService");
const gmailService_1 = require("../services/gmailService");
const logger = (0, errorHandling_1.createLogger)('GmailPollingWorker');
let isRunning = false;
let lastHistoryId = 0;
async function startGmailPolling(intervalMinutes = 5) {
    logger.info('Starting Gmail polling worker', { intervalMinutes });
    // Run immediately on start
    await pollGmail();
    // Then run every N minutes
    const intervalMs = intervalMinutes * 60 * 1000;
    setInterval(async () => {
        await pollGmail();
    }, intervalMs);
}
async function pollGmail() {
    if (isRunning) {
        logger.debug('Gmail polling already in progress, skipping');
        return;
    }
    isRunning = true;
    const startTime = Date.now();
    try {
        logger.info('Starting Gmail poll');
        // Query for messages with attachments (PDFs, DOCs)
        const messages = await (0, gmailService_1.listMessages)('filename:pdf OR filename:doc OR filename:docx', 10);
        if (!messages || messages.length === 0) {
            logger.info('No new Gmail messages with attachments');
            isRunning = false;
            return;
        }
        logger.info(`Found ${messages.length} messages to process`);
        let successCount = 0;
        let errorCount = 0;
        for (const msg of messages) {
            if (!msg.id)
                continue;
            try {
                const fullMessage = await (0, gmailService_1.getMessage)(msg.id);
                if (!fullMessage.attachments || fullMessage.attachments.length === 0) {
                    continue;
                }
                // Create inbox message with Gmail-specific ID
                const externalId = `gmail_${fullMessage.id}`;
                const inboxMessage = await (0, inboxService_1.createInboxMessage)({
                    source: 'gmail',
                    externalMessageId: externalId,
                    payload: {
                        from: fullMessage.from,
                        subject: fullMessage.subject,
                        internalDate: fullMessage.internalDate,
                        threadId: fullMessage.threadId,
                    },
                    status: 'pending',
                    receivedAt: fullMessage.internalDate,
                }).catch((err) => {
                    // Duplicate message is OK - just skip
                    if (String(err.message).includes('already exists')) {
                        logger.debug('Message already in inbox, skipping', { externalId });
                        return null;
                    }
                    throw err;
                });
                if (!inboxMessage)
                    continue;
                // Download and store each attachment
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
                            // Duplicate attachment is OK - it's the same CV from same email
                            if (String(err.message).includes('Duplicate')) {
                                logger.debug('Attachment already exists, skipping', { filename: attachment.filename });
                                return null;
                            }
                            throw err;
                        });
                        logger.debug('Attachment stored', { filename: attachment.filename, messageId: fullMessage.id });
                    }
                    catch (err) {
                        logger.error('Failed to download/store attachment', err, { filename: attachment.filename, messageId: fullMessage.id });
                        errorCount++;
                    }
                }
                successCount++;
            }
            catch (err) {
                logger.error('Failed to process message', err, { messageId: msg.id });
                errorCount++;
            }
        }
        const duration = Date.now() - startTime;
        logger.info('Gmail poll completed', { successCount, errorCount, durationMs: duration });
    }
    catch (err) {
        logger.error('Gmail polling failed', err);
    }
    finally {
        isRunning = false;
    }
}
