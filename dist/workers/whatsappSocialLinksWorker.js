"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWhatsAppSocialLinksWorker = startWhatsAppSocialLinksWorker;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const errorHandling_1 = require("../utils/errorHandling");
const whatsappInteractiveService_1 = require("../services/whatsappInteractiveService");
const candidateService_1 = require("../services/candidateService");
const database_1 = require("../config/database");
const logger = (0, errorHandling_1.createLogger)('WhatsAppSocialLinksWorker');
function toRecipient(phone) {
    const normalized = (0, candidateService_1.normalizePhoneE164)(phone.trim()) || phone.trim();
    const digits = normalized.replace(/\D/g, '');
    return digits || null;
}
async function candidateExistsForPhone(phone) {
    const normalized = (0, candidateService_1.normalizePhoneE164)(phone.trim()) || phone.trim();
    const digits = normalized.replace(/\D/g, '');
    if (!digits) {
        return false;
    }
    const db = (0, database_1.supabaseAdminClient)();
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
function startWhatsAppSocialLinksWorker() {
    const worker = new bullmq_1.Worker('whatsapp-social-links', async (job) => {
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
        if (intendedRole && intendedRole !== 'candidate') {
            logger.info('Skipping social-links message — recipient role is not candidate', {
                jobId: job.id,
                recipient,
                recipientRole: intendedRole,
            });
            return;
        }
        const isCandidateRecipient = await candidateExistsForPhone(job.data.phone);
        if (!isCandidateRecipient) {
            logger.info('Skipping social-links message — no matching candidate application found', {
                jobId: job.id,
                recipient,
            });
            return;
        }
        logger.info('Sending delayed social-links message', { jobId: job.id, recipient });
        await (0, whatsappInteractiveService_1.sendText)(phoneNumberId, accessToken, recipient, job.data.message);
        logger.info('Social-links message sent', { jobId: job.id, recipient });
    }, {
        connection: redis_1.redis,
        concurrency: 3,
    });
    worker.on('failed', (job, err) => {
        logger.error('Social-links job failed', err, { jobId: job?.id });
    });
    return worker;
}
