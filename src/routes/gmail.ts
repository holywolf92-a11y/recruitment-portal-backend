import { Router, Request, Response } from 'express';
import { asyncHandler, createLogger } from '../utils/errorHandling';
import { gmailLimiter } from '../middleware/rateLimit';
import { webhookLoggingMiddleware, webhookErrorMonitor } from '../middleware/webhookLogger';
import { createInboxMessage } from '../services/inboxService';
import { createAttachment } from '../services/inboxAttachmentService';
import { listMessages, getMessage, getAttachment, GMAIL_CV_QUERY } from '../services/gmailService';

const router = Router();
const logger = createLogger('GmailRoute');

// Apply logging and error monitoring
router.use(webhookLoggingMiddleware('gmail'));
router.use(webhookErrorMonitor('gmail'));

router.post(
  '/',
  gmailLimiter,
  asyncHandler(async (req: Request, res: Response) => {
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
  })
);

async function processGmailNotification(emailAddress: string, historyId: string) {
  try {
    // List recent messages with attachments
    const { messages } = await listMessages(GMAIL_CV_QUERY, 5);
    if (!messages || messages.length === 0) {
      logger.info('No new Gmail messages with attachments');
      return;
    }

    for (const msg of messages) {
      if (!msg.id) continue;

      const fullMessage = await getMessage(msg.id);
      if (!fullMessage.attachments || fullMessage.attachments.length === 0) continue;

      // Create inbox message
      const externalId = `gmail_${fullMessage.id}`;
      const inboxMessage = await createInboxMessage({
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

      if (!inboxMessage) continue;

      // Download and store attachments
      for (const attachment of fullMessage.attachments) {
        if (!attachment.id) continue;
        try {
          const buffer = await getAttachment(fullMessage.id, attachment.id);
          const storagePath = `gmail/${fullMessage.id}/${attachment.filename}`;

          await createAttachment({
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
        } catch (err) {
          logger.error('Failed to download attachment', err, { filename: attachment.filename });
        }
      }
    }
  } catch (err) {
    logger.error('Failed to process Gmail notification', err);
  }
}

export default router;
