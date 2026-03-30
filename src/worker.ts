import dotenv from 'dotenv';
import { validateEnv } from './config/env';
import { createLogger } from './utils/errorHandling';

dotenv.config();
validateEnv();

const logger = createLogger('WorkerService');

async function main() {
  if (process.env.RUN_WORKER !== 'true') {
    logger.error('Worker service requires RUN_WORKER=true');
    process.exit(1);
  }

  if (!process.env.REDIS_URL) {
    logger.error('Worker service requires REDIS_URL');
    process.exit(1);
  }

  const startedWorkers: string[] = [];

  if (process.env.PYTHON_CV_PARSER_URL && process.env.PYTHON_HMAC_SECRET) {
    const [cvParserModule, whatsappVerifyModule, documentVerifyModule] = await Promise.all([
      import('./workers/cvParserWorker'),
      import('./workers/whatsappAttachmentVerificationWorker'),
      import('./workers/documentVerificationWorker'),
    ]);

    cvParserModule.startCvParserWorker();
    startedWorkers.push('cv-parser');

    whatsappVerifyModule.startWhatsAppAttachmentVerificationWorker();
    startedWorkers.push('whatsapp-attachment-verification');

    documentVerifyModule.startDocumentVerificationWorker();
    startedWorkers.push('document-verification');
  } else {
    logger.warn('Skipping parser-dependent workers (PYTHON_CV_PARSER_URL or PYTHON_HMAC_SECRET missing)');
  }

  const { startDocumentLinkWorker } = await import('./workers/documentLinkWorker');
  startDocumentLinkWorker();
  startedWorkers.push('document-linking');

  if (process.env.WHATSAPP_ACCESS_TOKEN) {
    const { startWhatsAppMediaWorker } = await import('./workers/whatsappMediaWorker');
    startWhatsAppMediaWorker();
    startedWorkers.push('whatsapp-media');
  } else {
    logger.warn('Skipping WhatsApp media worker (WHATSAPP_ACCESS_TOKEN missing)');
  }

  // ── WhatsApp bridge disconnect monitor ───────────────────────────────────
  const { startWhatsAppMonitor } = await import('./workers/whatsappMonitorWorker');
  startWhatsAppMonitor();
  startedWorkers.push('whatsapp-monitor');

  // ── Gmail polling (Account 3: cv.falishaoep@gmail.com) ────────────────────
  if (process.env.RUN_GMAIL_POLLING === 'true') {
    if (process.env.GMAIL_CLIENT_ID && (process.env.GMAIL_REFRESH_TOKEN || process.env.GMAIL3_REFRESH_TOKEN)) {
      const { startGmailPolling } = await import('./workers/gmailPollingWorker');
      startGmailPolling(5).catch((err: any) => logger.error('Failed to start Gmail polling', err));
      startedWorkers.push('gmail-polling');

      // Historical backfill from 2024-01-01 — Account 3 only
      const { startGmailBackfill } = await import('./workers/gmailBackfillWorker');
      const { createOAuth2ClientForAccount3, isAccount3Configured } = await import('./services/gmailService');
      const since2024 = new Date('2024-01-01T00:00:00.000Z');
      if (isAccount3Configured()) {
        startGmailBackfill({ afterDate: since2024, account: 3, authClient: createOAuth2ClientForAccount3(), maxTotal: 50_000 })
          .then(() => logger.info('Gmail account 3 (cv.falishaoep@gmail.com) historical backfill started (2024-present)'))
          .catch((err: any) => logger.warn('Gmail account 3 backfill skipped (may already be running)', { msg: err?.message }));
      } else {
        logger.warn('GMAIL3_REFRESH_TOKEN not set — skipping historical backfill for cv.falishaoep@gmail.com');
      }
    } else {
      logger.warn('RUN_GMAIL_POLLING=true but GMAIL_CLIENT_ID / refresh token missing');
    }
  }

  // ── Google Drive polling (cv.falishaoep@gmail.com Drive) ──────────────────
  if (process.env.RUN_GOOGLE_DRIVE_POLLING === 'true') {
    const { startGoogleDrivePolling } = await import('./workers/googleDrivePollingWorker');
    startGoogleDrivePolling(10).catch((err: any) => logger.error('Failed to start Google Drive polling', err));
    startedWorkers.push('google-drive-polling');
  }

  logger.info('Dedicated worker service started', { workers: startedWorkers });
}

main().catch((error) => {
  logger.error('Failed to start worker service', error);
  process.exit(1);
});