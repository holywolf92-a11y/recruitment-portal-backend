import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { createLogger } from '../utils/errorHandling';
import { sendText } from '../services/whatsappInteractiveService';
import { normalizePhoneE164 } from '../services/candidateService';

const logger = createLogger('WhatsAppSocialLinksWorker');

export interface WhatsAppSocialLinksJobData {
  /** E.164 or local phone number of the recipient */
  phone: string;
  /** Pre-built message text to send (already formatted with emojis) */
  message: string;
}

function toRecipient(phone: string): string | null {
  const normalized = normalizePhoneE164(phone.trim()) || phone.trim();
  const digits = normalized.replace(/\D/g, '');
  return digits || null;
}

export function startWhatsAppSocialLinksWorker() {
  const worker = new Worker(
    'whatsapp-social-links',
    async (job: Job<WhatsAppSocialLinksJobData>) => {
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

      if (!phoneNumberId || !accessToken) {
        logger.warn('Skipping social-links message — WHATSAPP credentials missing', { jobId: job.id });
        return;
      }

      const recipient = toRecipient(job.data.phone);
      if (!recipient) {
        logger.warn('Skipping social-links message — invalid phone', { jobId: job.id, phone: job.data.phone });
        return;
      }

      logger.info('Sending delayed social-links message', { jobId: job.id, recipient });
      await sendText(phoneNumberId, accessToken, recipient, job.data.message);
      logger.info('Social-links message sent', { jobId: job.id, recipient });
    },
    {
      connection: redis,
      concurrency: 3,
    }
  );

  worker.on('failed', (job, err) => {
    logger.error('Social-links job failed', err, { jobId: job?.id });
  });

  return worker;
}
