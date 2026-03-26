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

  logger.info('Dedicated worker service started', { workers: startedWorkers });
}

main().catch((error) => {
  logger.error('Failed to start worker service', error);
  process.exit(1);
});