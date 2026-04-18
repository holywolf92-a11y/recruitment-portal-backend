import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { createLogger } from '../utils/errorHandling';
import { sendText } from '../services/whatsappInteractiveService';
import { normalizePhoneE164 } from '../services/candidateService';
import { supabaseAdminClient } from '../config/database';

const logger = createLogger('WhatsAppSocialLinksWorker');

export interface WhatsAppSocialLinksJobData {
  /** E.164 or local phone number of the recipient */
  phone: string;
  /** Pre-built message text to send (already formatted with emojis) */
  message: string;
  /** Intended audience for the queued follow-up. */
  recipientRole?: 'candidate' | 'employer' | 'partner';
}

function toRecipient(phone: string): string | null {
  const normalized = normalizePhoneE164(phone.trim()) || phone.trim();
  const digits = normalized.replace(/\D/g, '');
  return digits || null;
}

async function candidateExistsForPhone(phone: string): Promise<boolean> {
  const normalized = normalizePhoneE164(phone.trim()) || phone.trim();
  const digits = normalized.replace(/\D/g, '');
  if (!digits) {
    return false;
  }

  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('candidates')
    .select('id')
    .or(`phone.eq.${normalized},phone.ilike.%${digits}%`)
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.warn('Failed to verify candidate recipient for social-links job', {
      phone,
      error: error.message,
    });
    return false;
  }

  return Boolean(data?.id);
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

      const intendedRole = job.data.recipientRole;
      if (intendedRole && intendedRole !== 'candidate' && intendedRole !== 'partner') {
        logger.info('Skipping social-links message — recipient role is employer', {
          jobId: job.id,
          recipient,
          recipientRole: intendedRole,
        });
        return;
      }

      // For candidates, verify a matching application exists before sending.
      // For partners, trust the queue entry directly.
      if (!intendedRole || intendedRole === 'candidate') {
        const isCandidateRecipient = await candidateExistsForPhone(job.data.phone);
        if (!isCandidateRecipient) {
          logger.info('Skipping social-links message — no matching candidate application found', {
            jobId: job.id,
            recipient,
          });
          return;
        }
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
