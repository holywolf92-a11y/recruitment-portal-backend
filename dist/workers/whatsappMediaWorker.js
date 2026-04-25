"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWhatsAppMediaWorker = startWhatsAppMediaWorker;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const errorHandling_1 = require("../utils/errorHandling");
const database_1 = require("../config/database");
const documentClassifier_1 = require("../services/documentClassifier");
const inboxAttachmentService_1 = require("../services/inboxAttachmentService");
const whatsappService_1 = require("../services/whatsappService");
const queue_1 = require("../config/queue");
const logger = (0, errorHandling_1.createLogger)('WhatsAppMediaWorker');
const UNSUPPORTED_WHATSAPP_FILE_EXTENSIONS = new Set([
    '.lnk', '.exe', '.dll', '.bat', '.cmd', '.msi', '.scr',
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.mp4', '.mp3', '.avi', '.mov', '.mkv', '.wav', '.flac',
]);
function getUnsupportedWhatsAppFileExtension(fileName) {
    if (!fileName)
        return null;
    const dot = fileName.lastIndexOf('.');
    if (dot < 0)
        return null;
    const ext = fileName.slice(dot).toLowerCase();
    return UNSUPPORTED_WHATSAPP_FILE_EXTENSIONS.has(ext) ? ext : null;
}
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
        // WhatsApp media metadata API rarely returns the real filename; the original
        // filename from the webhook payload (job.data.fileName) is more reliable.
        // IMPORTANT: enforce allow-list decisions BEFORE downloading any bytes.
        const fileName = meta.file_name || job.data.fileName || meta.id || `${mediaId}.bin`;
        const mimeType = meta.mime_type || job.data.mimeType || 'application/octet-stream';
        const normalizedMime = String(mimeType || '').toLowerCase();
        const unsupportedFileExtension = getUnsupportedWhatsAppFileExtension(fileName);
        // Business rule: WhatsApp channel is CV-only and CVs must be PDFs.
        // Default is ON; can be disabled via env for emergencies.
        const enforcePdfOnly = String(process.env.WHATSAPP_ENFORCE_PDF_ONLY ?? 'true').toLowerCase() !== 'false';
        const looksLikePdf = normalizedMime === 'application/pdf' || String(fileName).toLowerCase().endsWith('.pdf');
        if (unsupportedFileExtension || (enforcePdfOnly && !looksLikePdf)) {
            try {
                const db = (0, database_1.supabaseAdminClient)();
                await db.from('inbox_messages').update({ status: 'processed' }).eq('id', inboxMessageId);
            }
            catch (err) {
                logger.warn('Failed to mark rejected WhatsApp upload as processed', {
                    inboxMessageId,
                    err: err instanceof Error ? err.message : String(err),
                });
            }
            // Best-effort: optionally tell sender to resend as PDF.
            const shouldReply = String(process.env.WHATSAPP_SEND_REJECT_REPLY ?? 'false').toLowerCase() === 'true';
            if (shouldReply && enforcePdfOnly && !looksLikePdf) {
                try {
                    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
                    if (phoneNumberId) {
                        await (0, whatsappService_1.sendMessage)(phoneNumberId, accessToken, fromPhone, 'Please send your CV as a PDF document only.');
                    }
                }
                catch (err) {
                    logger.warn('Failed to send WhatsApp PDF-only reply (non-fatal)', {
                        inboxMessageId,
                        fromPhone,
                        err: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            logger.warn('Rejecting WhatsApp upload before attachment creation', {
                jobId: job.id,
                wamid,
                mediaId,
                fileName,
                mimeType,
                reason: unsupportedFileExtension ? `unsupported_extension:${unsupportedFileExtension}` : 'non_pdf',
                inboxMessageId,
            });
            return {
                skippedUnsupported: !!unsupportedFileExtension,
                skippedNonPdf: enforcePdfOnly && !looksLikePdf,
                extension: unsupportedFileExtension,
                fileName,
                mimeType,
            };
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
        const classification = documentClassifier_1.DocumentClassifier.classify(fileName, undefined, mimeType, buffer);
        const attachmentType = classification.attachmentKind === 'cv' ? 'cv' : 'document';
        // Detect unsupported binary formats — video/audio cannot be parsed as CVs or identity docs.
        const isUnsupportedMedia = normalizedMime.startsWith('video/') ||
            normalizedMime.startsWith('audio/');
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
        const shouldTreatAsCv = !isUnsupportedMedia &&
            !normalizedMime.startsWith('image/') &&
            (attachmentType === 'document' || attachment?.attachment_kind === 'cv');
        if (isUnsupportedMedia) {
            // Video / audio cannot be parsed as a CV or verified as an identity document.
            // Store the file (already done) and log — no queue job created.
            logger.warn('Skipping unsupported media type (video/audio) — no parsing or verification job created', {
                attachmentId: attachment.id,
                mimeType,
                fileName,
            });
        }
        else if (shouldTreatAsCv) {
            try {
                // Old WhatsApp behavior: treat document uploads as CV candidates so they always
                // reach full parsing even when filename-based classification says "unknown".
                if (attachment?.attachment_kind !== 'cv') {
                    const db = (0, database_1.supabaseAdminClient)();
                    await db.from('inbox_attachments').update({ attachment_kind: 'cv' }).eq('id', attachment.id);
                }
                await (0, inboxAttachmentService_1.enqueueCvParsingJobForAttachment)(attachment.id, { force: false, expiresInSeconds: 3600 });
            }
            catch (err) {
                logger.error('Failed to enqueue CV parsing (non-fatal)', err, { attachmentId: attachment.id });
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
                logger.error('Failed to enqueue WhatsApp attachment pre-verification (non-fatal)', err, { attachmentId: attachment.id });
            }
        }
        // Best-effort: mark legacy inbox message as processed so it doesn't linger as "pending".
        try {
            const db = (0, database_1.supabaseAdminClient)();
            await db.from('inbox_messages').update({ status: 'processed' }).eq('id', inboxMessageId);
        }
        catch (err) {
            logger.warn('Failed to update inbox_messages status (fail-open)', {
                inboxMessageId,
                err: err instanceof Error ? err.message : String(err),
            });
        }
        return {
            attachmentId: attachment.id,
            attachmentKind: attachment?.attachment_kind,
            attachmentType: attachment?.attachment_type,
            candidateId: null,
        };
    }, {
        connection: redis_1.redis,
        concurrency: 1,
        drainDelay: 60, // seconds — idle poll every 60s instead of 5s
        stalledInterval: 300000, // check stalled jobs every 5 min instead of 30s
        lockDuration: 60000,
        limiter: { max: 30, duration: 60000 },
    });
    worker.on('completed', (job) => {
        logger.info('WhatsApp media job completed', { jobId: job.id });
    });
    worker.on('failed', (job, err) => {
        logger.error('WhatsApp media job failed', err, {
            jobId: job?.id,
            wamid: job?.data?.wamid,
            mediaId: job?.data?.mediaId,
            inboxMessageId: job?.data?.inboxMessageId,
        });
        // Only mark as failed on the final attempt.
        try {
            const attempts = job?.opts?.attempts ?? 1;
            const attemptsMade = job?.attemptsMade ?? 0;
            const isFinal = attemptsMade >= attempts;
            const inboxMessageId = job?.data?.inboxMessageId;
            if (isFinal && inboxMessageId) {
                const db = (0, database_1.supabaseAdminClient)();
                void db.from('inbox_messages').update({ status: 'failed' }).eq('id', inboxMessageId);
            }
        }
        catch {
            // fail-open
        }
    });
    return worker;
}
