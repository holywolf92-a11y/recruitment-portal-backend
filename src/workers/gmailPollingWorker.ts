import { createLogger } from '../utils/errorHandling';
import { createInboxMessage } from '../services/inboxService';
import { createAttachment, enqueueCvParsingJobForAttachment } from '../services/inboxAttachmentService';
import { listMessages, getMessage, getAttachment } from '../services/gmailService';

const logger = createLogger('GmailPollingWorker');

let isRunning = false;
let lastHistoryId = 0;

export async function startGmailPolling(intervalMinutes: number = 5) {
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
    const messages = await listMessages('filename:pdf OR filename:doc OR filename:docx', 10);
    if (!messages || messages.length === 0) {
      logger.info('No new Gmail messages with attachments');
      isRunning = false;
      return;
    }

    logger.info(`Found ${messages.length} messages to process`);

    let successCount = 0;
    let errorCount = 0;

    for (const msg of messages) {
      if (!msg.id) continue;

      try {
        const fullMessage = await getMessage(msg.id);
        if (!fullMessage.attachments || fullMessage.attachments.length === 0) {
          continue;
        }

        // Create inbox message with Gmail-specific ID
        const externalId = `gmail_${fullMessage.id}`;
        const inboxMessage = await createInboxMessage({
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

        if (!inboxMessage) continue;

        // Download and store each attachment
        for (const attachment of fullMessage.attachments) {
          if (!attachment.id) continue;

          try {
            const buffer = await getAttachment(fullMessage.id, attachment.id);
            const storagePath = `gmail/${fullMessage.id}/${attachment.filename}`;

            const createdAttachment = await createAttachment({
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

            if (createdAttachment?.id) {
              try {
                await enqueueCvParsingJobForAttachment(createdAttachment.id, {
                  force: false,
                  expiresInSeconds: 3600,
                });
              } catch (enqueueErr) {
                logger.error('Failed to enqueue CV parsing job', enqueueErr, {
                  attachmentId: createdAttachment.id,
                  filename: attachment.filename,
                });
              }
            }

            logger.debug('Attachment stored', { filename: attachment.filename, messageId: fullMessage.id });
          } catch (err) {
            logger.error('Failed to download/store attachment', err, { filename: attachment.filename, messageId: fullMessage.id });
            errorCount++;
          }
        }

        successCount++;
      } catch (err) {
        logger.error('Failed to process message', err, { messageId: msg.id });
        errorCount++;
      }
    }

    const duration = Date.now() - startTime;
    logger.info('Gmail poll completed', { successCount, errorCount, durationMs: duration });
  } catch (err) {
    logger.error('Gmail polling failed', err);
  } finally {
    isRunning = false;
  }
}
