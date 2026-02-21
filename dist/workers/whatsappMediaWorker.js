"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWhatsAppMediaWorker = startWhatsAppMediaWorker;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const errorHandling_1 = require("../utils/errorHandling");
const documentClassifier_1 = require("../services/documentClassifier");
const inboxAttachmentService_1 = require("../services/inboxAttachmentService");
const whatsappService_1 = require("../services/whatsappService");
const queue_1 = require("../config/queue");
const logger = (0, errorHandling_1.createLogger)('WhatsAppMediaWorker');
function startWhatsAppMediaWorker() {
    const worker = new bullmq_1.Worker('whatsapp-media', async (job) => {
        const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
        if (!accessToken) {
            throw new Error('WHATSAPP_ACCESS_TOKEN is not configured');
        }
        const { inboxMessageId, wamid, fromPhone, mediaId } = job.data;
        logger.info('Processing WhatsApp media', {
            jobId: job.id,
            wamid,
            fromPhone,
            mediaId,
            inboxMessageId,
        });
        const meta = await (0, whatsappService_1.fetchMediaMetadata)(mediaId, accessToken);
        if (!meta?.url) {
            throw new Error(`Media metadata missing url for mediaId=${mediaId}`);
        }
        const buffer = await (0, whatsappService_1.downloadMedia)(meta.url, accessToken);
        if (!buffer || buffer.length === 0) {
            throw new Error('Downloaded media is empty');
        }
        // Basic size guardrail (WhatsApp supports large media; keep conservative here)
        const maxBytes = 25 * 1024 * 1024;
        if (buffer.length > maxBytes) {
            throw new Error(`Media too large: ${buffer.length} bytes > ${maxBytes}`);
        }
        const fileName = meta.file_name || meta.id || `${mediaId}.bin`;
        const mimeType = meta.mime_type || job.data.mimeType || 'application/octet-stream';
        const classification = documentClassifier_1.DocumentClassifier.classify(fileName, undefined, mimeType);
        const attachmentType = classification.attachmentKind === 'cv' ? 'cv' : 'document';
        // Identity-first rule: store raw WhatsApp upload unbound; never create/bind a candidate here.
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const rawId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const storagePath = `whatsapp/raw/${rawId}/${sanitizedFileName}`;
        const attachment = await (0, inboxAttachmentService_1.createAttachment)({
            inboxMessageId,
            fileBuffer: buffer,
            fileName,
            mimeType,
            attachmentType,
            storageBucket: 'documents',
            storagePath,
            messageSource: 'whatsapp',
            whatsappWamid: wamid,
            whatsappMediaId: mediaId,
        });
        // CV parsing is keyed off inbox_attachments.attachment_type === 'cv'
        if (attachment?.attachment_type === 'cv' || attachment?.attachment_kind === 'cv') {
            try {
                await (0, inboxAttachmentService_1.enqueueCvParsingJobForAttachment)(attachment.id, { force: false, expiresInSeconds: 3600 });
            }
            catch (err) {
                logger.error('Failed to enqueue CV parsing (non-fatal)', {
                    attachmentId: attachment.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        else {
            // Identity-first rule: run AI extraction BEFORE linking/binding.
            try {
                await queue_1.whatsappAttachmentVerificationQueue.add('preverify', {
                    attachmentId: attachment.id,
                    fromPhone,
                    wamid,
                    inboxMessageId,
                    receivedAt: job.data.receivedAt,
                }, {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 2000 },
                    removeOnComplete: 200,
                    removeOnFail: 200,
                });
            }
            catch (err) {
                logger.error('Failed to enqueue WhatsApp attachment pre-verification (non-fatal)', {
                    attachmentId: attachment.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        return {
            attachmentId: attachment.id,
            attachmentKind: attachment?.attachment_kind,
            attachmentType: attachment?.attachment_type,
            candidateId: null,
        };
    }, {
        connection: redis_1.redis,
        concurrency: 3,
        limiter: { max: 30, duration: 60000 },
    });
    worker.on('completed', (job) => {
        logger.info('WhatsApp media job completed', { jobId: job.id });
    });
    worker.on('failed', (job, err) => {
        logger.error('WhatsApp media job failed', { jobId: job?.id, error: err.message });
    });
    return worker;
}
