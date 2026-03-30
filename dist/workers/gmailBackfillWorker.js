"use strict";
/**
 * Gmail Historical Backfill Worker
 *
 * Paginate through ALL historical Gmail messages matching the CV query,
 * skip any already in inbox_messages, and process new ones through the
 * full CV pipeline (store → queue parsing → candidate binding).
 *
 * Architecture:
 *   listAllMessages (paginated) → skip processed → getMessage → isAcceptedCvMime filter
 *   → createInboxMessage → createAttachment → enqueueCvParsingJob → candidateBinding (in cvParserWorker)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBackfillState = getBackfillState;
exports.cancelBackfill = cancelBackfill;
exports.startGmailBackfill = startGmailBackfill;
const errorHandling_1 = require("../utils/errorHandling");
const inboxService_1 = require("../services/inboxService");
const inboxAttachmentService_1 = require("../services/inboxAttachmentService");
const gmailService_1 = require("../services/gmailService");
const database_1 = require("../config/database");
const logger = (0, errorHandling_1.createLogger)('GmailBackfillWorker');
let state = {
    running: false,
    cancelled: false,
    startedAt: null,
    finishedAt: null,
    mode: 'idle',
    discovered: 0,
    skipped: 0,
    processed: 0,
    errors: 0,
    currentPage: 0,
    afterDate: null,
    beforeDate: null,
    lastError: null,
};
function getBackfillState() {
    return { ...state };
}
function cancelBackfill() {
    if (state.running) {
        state.cancelled = true;
        logger.info('Backfill cancellation requested');
    }
}
function resetState(afterDate, beforeDate) {
    state = {
        running: true,
        cancelled: false,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        mode: 'backfill',
        discovered: 0,
        skipped: 0,
        processed: 0,
        errors: 0,
        currentPage: 0,
        afterDate: afterDate?.toISOString() ?? null,
        beforeDate: beforeDate?.toISOString() ?? null,
        lastError: null,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Check if a Gmail message is already recorded in inbox_messages.
 */
async function isAlreadyProcessed(gmailMessageId) {
    const db = (0, database_1.supabaseAdminClient)();
    const externalId = `gmail_${gmailMessageId}`;
    const { data } = await db
        .from('inbox_messages')
        .select('id')
        .eq('external_message_id', externalId)
        .maybeSingle();
    return !!data;
}
/**
 * Process a single Gmail message ID.
 * Returns 'skipped' | 'processed' | 'error'.
 */
async function processOne(gmailMessageId, authClient, account = 1) {
    try {
        // Idempotency: skip already-stored messages
        if (await isAlreadyProcessed(gmailMessageId)) {
            return 'skipped';
        }
        const fullMessage = await (0, gmailService_1.getMessage)(gmailMessageId, authClient);
        // ── Date filter: skip emails received before 2024-01-01 ──────────────────
        const CV_CUTOFF_MS = new Date('2024-01-01T00:00:00.000Z').getTime();
        const emailDateMs = fullMessage.internalDate ? parseInt(String(fullMessage.internalDate), 10) : 0;
        if (emailDateMs > 0 && emailDateMs < CV_CUTOFF_MS) {
            logger.debug('Backfill: skipping pre-2024 email', {
                messageId: gmailMessageId,
                emailDate: new Date(emailDateMs).toISOString(),
            });
            state.skipped++;
            return 'skipped';
        }
        // ─────────────────────────────────────────────────────────────────────────
        if (!fullMessage.attachments || fullMessage.attachments.length === 0) {
            // Text-only message — nothing to store for CV purposes
            return 'skipped';
        }
        // Filter to only CV-relevant attachments
        const cvAttachments = fullMessage.attachments.filter((a) => a.id && (0, gmailService_1.isAcceptedCvMime)(a.mimeType));
        if (cvAttachments.length === 0) {
            logger.debug('No accepted-MIME attachments in message', {
                messageId: gmailMessageId,
                attachments: fullMessage.attachments.map((a) => a.mimeType),
            });
            return 'skipped';
        }
        // Create inbox_message record
        const externalId = `gmail_${fullMessage.id}`;
        const inboxMessage = await (0, inboxService_1.createInboxMessage)({
            source: 'gmail',
            externalMessageId: externalId,
            payload: {
                from: fullMessage.from,
                subject: fullMessage.subject,
                internalDate: fullMessage.internalDate,
                threadId: fullMessage.threadId,
                messageIdHeader: fullMessage.messageIdHeader,
                backfill: true, // CV parser MUST check this and skip immediate email sends
                inbox_account: account, // which Gmail account received this
            },
            status: 'pending',
            receivedAt: fullMessage.internalDate,
        }).catch((err) => {
            if (String(err?.message || err).includes('already exists')) {
                return null; // Race condition — fine
            }
            throw err;
        });
        if (!inboxMessage)
            return 'skipped';
        let attachmentCount = 0;
        for (const attachment of cvAttachments) {
            try {
                const buffer = await (0, gmailService_1.getAttachment)(fullMessage.id, attachment.id, authClient);
                // Immutable path — never overwrites
                const storagePath = `gmail/backfill/${fullMessage.id}/${Date.now()}_${attachment.filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
                const created = await (0, inboxAttachmentService_1.createAttachment)({
                    inboxMessageId: inboxMessage.id,
                    fileBuffer: buffer,
                    fileName: attachment.filename,
                    mimeType: attachment.mimeType,
                    attachmentType: 'cv',
                    storageBucket: 'documents',
                    storagePath,
                    candidateId: undefined,
                }).catch((err) => {
                    if (String(err?.message || err).includes('Duplicate')) {
                        logger.debug('Backfill: attachment already stored', { filename: attachment.filename });
                        return null;
                    }
                    throw err;
                });
                if (created?.id) {
                    await (0, inboxAttachmentService_1.enqueueCvParsingJobForAttachment)(created.id, {
                        force: false,
                        expiresInSeconds: 86400, // 24h — backfill jobs can wait longer
                    }).catch((err) => {
                        logger.error('Backfill: failed to enqueue CV parsing', err, {
                            attachmentId: created.id,
                            filename: attachment.filename,
                        });
                    });
                    logger.info('Backfill: attachment stored + queued', {
                        messageId: gmailMessageId,
                        filename: attachment.filename,
                        attachmentId: created.id,
                    });
                    attachmentCount++;
                }
            }
            catch (err) {
                logger.error('Backfill: failed to download/store attachment', err, {
                    messageId: gmailMessageId,
                    filename: attachment.filename,
                });
                state.errors++;
            }
        }
        // Mark inbox_message as processed if at least one attachment went through
        if (attachmentCount > 0) {
            const db = (0, database_1.supabaseAdminClient)();
            await db.from('inbox_messages').update({ status: 'processed' }).eq('id', inboxMessage.id);
        }
        return 'processed';
    }
    catch (err) {
        logger.error('Backfill: error processing message', err, { messageId: gmailMessageId });
        state.lastError = err?.message ?? String(err);
        state.errors++;
        return 'error';
    }
}
/**
 * Start historical Gmail backfill.
 * Runs asynchronously — call getBackfillState() to poll progress.
 * Returns immediately with the initial state.
 */
async function startGmailBackfill(opts = {}) {
    if (state.running) {
        throw new Error('Backfill is already running. Cancel it first.');
    }
    resetState(opts.afterDate, opts.beforeDate);
    const batchSize = opts.batchSize ?? 100;
    const maxTotal = opts.maxTotal ?? 10000;
    const delayMs = opts.delayMs ?? 300; // 300ms between messages (safe: ~3 msgs/s)
    const pageDelayMs = opts.pageDelayMs ?? 1000; // 1s between pages (enterprise-safe)
    const account = (opts.account ?? 1);
    const authClient = opts.authClient;
    logger.info('Starting Gmail historical backfill', {
        account,
        afterDate: opts.afterDate?.toISOString() ?? 'all history',
        beforeDate: opts.beforeDate?.toISOString() ?? 'now',
        batchSize,
        maxTotal,
        delayMs,
        pageDelayMs,
    });
    // Launch async — don't await
    (async () => {
        try {
            await (0, gmailService_1.listAllMessages)(gmailService_1.GMAIL_CV_QUERY, {
                batchSize,
                afterDate: opts.afterDate,
                beforeDate: opts.beforeDate,
                maxTotal,
                pageDelayMs, // inter-page quota guard
                authClient, // use account-specific auth (Account 2 if set, else Account 1 default)
                onBatch: async (ids, pageNum, totalSoFar) => {
                    state.discovered = totalSoFar;
                    state.currentPage = pageNum;
                    logger.info(`Backfill: processing page ${pageNum} (${ids.length} messages, ${totalSoFar} discovered)`, {
                        account,
                        processed: state.processed,
                        skipped: state.skipped,
                        errors: state.errors,
                    });
                    for (const id of ids) {
                        if (state.cancelled) {
                            logger.info('Backfill: cancelled by request');
                            return;
                        }
                        const result = await processOne(id, authClient, account);
                        if (result === 'processed')
                            state.processed++;
                        else if (result === 'skipped')
                            state.skipped++;
                        // errors counted inside processOne
                        if (delayMs > 0) {
                            await new Promise((r) => setTimeout(r, delayMs));
                        }
                    }
                },
            });
            logger.info('Backfill complete', {
                discovered: state.discovered,
                processed: state.processed,
                skipped: state.skipped,
                errors: state.errors,
            });
        }
        catch (err) {
            logger.error('Backfill failed', err);
            state.lastError = err?.message ?? String(err);
        }
        finally {
            state.running = false;
            state.finishedAt = new Date().toISOString();
            state.mode = 'idle';
        }
    })();
    return { ...state };
}
