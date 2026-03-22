"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDocumentLinkWorker = startDocumentLinkWorker;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const documentLinkService_1 = require("../services/documentLinkService");
const database_1 = require("../config/database");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('DocumentLinkWorker');
function startDocumentLinkWorker() {
    const linkService = new documentLinkService_1.DocumentLinkService();
    const worker = new bullmq_1.Worker('document-linking', async (job) => {
        const { attachmentId } = job.data;
        logger.info(`Processing document link job`, { jobId: job.id, attachmentId });
        try {
            const db = (0, database_1.supabaseAdminClient)();
            // Get attachment details
            const { data: attachment, error } = await db
                .from('inbox_attachments')
                .select('*, inbox_messages!inner(source)')
                .eq('id', attachmentId)
                .single();
            if (error || !attachment) {
                throw new Error(`Attachment not found: ${attachmentId}`);
            }
            // Identity-first rule (defense-in-depth): never link WhatsApp documents before a candidate is known.
            const messageSource = attachment?.inbox_messages?.source;
            if (messageSource === 'whatsapp' && !attachment.linked_candidate_id) {
                logger.info('Skipping WhatsApp attachment link job (candidate not yet determined)', {
                    attachmentId,
                    jobId: job.id,
                });
                return { skipped: true, reason: 'WhatsApp requires pre-verification before linking' };
            }
            // Skip if it's a CV (handled by CV parsing flow)
            if (attachment.attachment_kind === 'cv') {
                logger.info(`Skipping CV attachment`, { attachmentId });
                return { skipped: true, reason: 'CV handled by parsing flow' };
            }
            // Extract metadata for matching
            const { data: message } = await db
                .from('inbox_messages')
                .select('payload')
                .eq('id', attachment.inbox_message_id)
                .single();
            const payload = message?.payload || {};
            const extractedEmail = payload.from?.email || payload.email;
            const extractedPhone = (typeof payload.from === 'string' ? payload.from : payload.from?.phone) ||
                payload.phone ||
                payload.sender_phone;
            const extractedName = (typeof payload.from === 'object' ? payload.from?.name : undefined) ||
                payload.sender_name ||
                payload.name;
            // Get extracted metadata from filename (CNIC, etc.)
            const fileMetadata = attachment.extractedMetadata || {};
            // Process the document
            await linkService.processDocument({
                attachmentId,
                extractedCnic: fileMetadata.cnic,
                extractedEmail,
                extractedPhone,
                extractedName,
                extractedFatherName: undefined, // Would need OCR/parsing to extract
            });
            logger.info(`Document link job completed`, { jobId: job.id, attachmentId });
            return { success: true };
        }
        catch (err) {
            logger.error(`Document link job failed`, {
                jobId: job.id,
                attachmentId,
                error: err.message
            });
            throw err;
        }
    }, {
        connection: redis_1.redis,
        concurrency: 1,
        drainDelay: 60, // seconds — idle poll every 60s instead of 5s
        stalledInterval: 300000, // check stalled jobs every 5 min instead of 30s
        lockDuration: 60000,
        limiter: { max: 10, duration: 60000 },
    });
    worker.on('completed', (job) => {
        logger.info(`Document link job completed successfully`, { jobId: job.id });
    });
    worker.on('failed', (job, err) => {
        logger.error(`Document link job failed`, { jobId: job?.id, error: err.message });
    });
    return worker;
}
