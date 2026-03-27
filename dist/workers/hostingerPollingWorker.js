"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHostingerPollingIntervalMinutes = getHostingerPollingIntervalMinutes;
exports.isHostingerPollingEnabled = isHostingerPollingEnabled;
exports.isHostingerPollingSchedulerActive = isHostingerPollingSchedulerActive;
exports.getPersistentHostingerPollingState = getPersistentHostingerPollingState;
exports.getHostingerPollingState = getHostingerPollingState;
exports.triggerHostingerManualPoll = triggerHostingerManualPoll;
exports.ensureHostingerPollingStarted = ensureHostingerPollingStarted;
exports.startHostingerPolling = startHostingerPolling;
const database_1 = require("../config/database");
const inboxService_1 = require("../services/inboxService");
const inboxAttachmentService_1 = require("../services/inboxAttachmentService");
const emailReplyAuditService_1 = require("../services/emailReplyAuditService");
const hostingerMailboxService_1 = require("../services/hostingerMailboxService");
const gmailService_1 = require("../services/gmailService");
const missingDataEmailReplyService_1 = require("../services/missingDataEmailReplyService");
const missingDataEmailService_1 = require("../services/missingDataEmailService");
const candidateDocumentService_1 = require("../services/candidateDocumentService");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('HostingerPollingWorker');
const HEARTBEAT_INTERVAL_MS = Math.max(5000, parseInt(process.env.HOSTINGER_POLL_HEARTBEAT_INTERVAL_MS || '15000', 10));
const RUN_STALE_AFTER_MS = Math.max(60000, parseInt(process.env.HOSTINGER_POLL_STALE_AFTER_MS || '900000', 10));
const POLL_BATCH_SIZE = Math.max(1, parseInt(process.env.HOSTINGER_POLL_BATCH_SIZE || '20', 10));
let isRunning = false;
let activeRunId = null;
let pollingIntervalTimer = null;
const WORKER_INSTANCE_ID = [
    process.env.RAILWAY_REPLICA_ID,
    process.env.HOSTNAME,
    `pid:${process.pid}`,
]
    .filter(Boolean)
    .join('|') || `pid:${process.pid}`;
const pollingState = {
    isRunning: false,
    lastPollStartedAt: null,
    lastPollCompletedAt: null,
    lastHeartbeatAt: null,
    lastResult: null,
    lastError: null,
    lastMatchedReply: null,
};
function getHostingerPollingIntervalMinutes() {
    const configuredIntervalMinutes = parseInt(process.env.HOSTINGER_POLL_INTERVAL_MINUTES || '5', 10);
    return Number.isFinite(configuredIntervalMinutes) && configuredIntervalMinutes > 0
        ? configuredIntervalMinutes
        : 5;
}
function isHostingerPollingEnabled() {
    const configuredValue = String(process.env.RUN_HOSTINGER_POLLING || '').trim().toLowerCase();
    if (configuredValue === 'true') {
        return true;
    }
    if (configuredValue === 'false') {
        return false;
    }
    const isProductionRuntime = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
    return isProductionRuntime && (0, hostingerMailboxService_1.isHostingerImapConfigured)();
}
function isHostingerPollingSchedulerActive() {
    return !!pollingIntervalTimer;
}
function startRunHeartbeat(runId) {
    if (!runId)
        return null;
    return setInterval(() => {
        const heartbeatAt = new Date().toISOString();
        pollingState.lastHeartbeatAt = heartbeatAt;
        void (0, emailReplyAuditService_1.heartbeatPollingRun)(runId);
    }, HEARTBEAT_INTERVAL_MS);
}
async function createPollingRun(trigger = 'worker') {
    try {
        const db = (0, database_1.supabaseAdminClient)();
        const now = new Date().toISOString();
        const { data, error } = await db
            .from('hostinger_polling_runs')
            .insert({
            provider: emailReplyAuditService_1.HOSTINGER_PROVIDER,
            mailbox: emailReplyAuditService_1.HOSTINGER_MAILBOX,
            trigger,
            status: 'running',
            worker_instance_id: WORKER_INSTANCE_ID,
            started_at: now,
            last_heartbeat_at: now,
        })
            .select('id')
            .single();
        if (error)
            throw error;
        return data?.id || null;
    }
    catch (err) {
        logger.warn('Failed to create Hostinger polling run record', { error: err });
        return null;
    }
}
async function completePollingRun(args) {
    if (!args.runId)
        return;
    try {
        const db = (0, database_1.supabaseAdminClient)();
        await db
            .from('hostinger_polling_runs')
            .update({
            status: args.status,
            completed_at: new Date().toISOString(),
            last_heartbeat_at: new Date().toISOString(),
            duration_ms: Date.now() - args.startedAtMs,
            unread_count_before: args.unreadCountBefore,
            unread_count_after: args.unreadCountAfter,
            messages_discovered: args.messagesDiscovered,
            messages_processed: args.messagesProcessed,
            messages_matched: args.messagesMatched,
            messages_unmatched: args.messagesUnmatched,
            attachment_upload_success_count: args.attachmentUploadSuccessCount,
            attachment_upload_error_count: args.attachmentUploadErrorCount,
            success_count: args.successCount,
            error_count: args.errorCount,
            error_code: args.errorCode || null,
            error_message: args.errorMessage || null,
            error_details: args.errorDetails || null,
        })
            .eq('id', args.runId);
    }
    catch (err) {
        logger.warn('Failed to complete Hostinger polling run record', { runId: args.runId, error: err });
    }
}
async function getPersistentHostingerPollingState() {
    const db = (0, database_1.supabaseAdminClient)();
    const { data } = await db
        .from('hostinger_polling_runs')
        .select('id, status, started_at, completed_at, last_heartbeat_at, success_count, error_count, error_message')
        .eq('provider', emailReplyAuditService_1.HOSTINGER_PROVIDER)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    return {
        isRunning: !!data && data.status === 'running',
        lastPollStartedAt: data?.started_at || null,
        lastPollCompletedAt: data?.completed_at || null,
        lastHeartbeatAt: data?.last_heartbeat_at || null,
        lastResult: data
            ? {
                successCount: Number(data.success_count || 0),
                errorCount: Number(data.error_count || 0),
            }
            : null,
        lastError: data?.error_message || null,
        lastMatchedReply: null,
    };
}
function getHostingerPollingState() {
    return {
        ...pollingState,
        lastResult: pollingState.lastResult ? { ...pollingState.lastResult } : null,
        lastMatchedReply: pollingState.lastMatchedReply ? { ...pollingState.lastMatchedReply } : null,
    };
}
function extractEmail(raw) {
    const match = raw.match(/<([^>]+)>/) || raw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
    return (match?.[1] || match?.[0] || '').trim().toLowerCase();
}
function extractTrackingToken(subject, bodyText) {
    const tokenMatch = `${subject}\n${bodyText}`.match(/\[#([A-Z]{2}\d{6})\]/i);
    return tokenMatch ? tokenMatch[1].toUpperCase() : null;
}
async function resolveCandidateMatch(args) {
    const db = (0, database_1.supabaseAdminClient)();
    if (args.trackingToken) {
        const { data } = await db
            .from('candidates')
            .select('id')
            .ilike('email_tracking_token', args.trackingToken)
            .maybeSingle();
        if (data?.id) {
            return { candidateId: data.id, matchedBy: 'tracking_token' };
        }
    }
    const referenceIds = [args.inReplyTo, ...args.references]
        .map((value) => String(value || '').trim().replace(/^<|>$/g, ''))
        .filter(Boolean);
    for (const referenceId of referenceIds) {
        const { data: outboundMatch } = await db
            .from('inbox_messages')
            .select('payload')
            .eq('source', 'email_outbound')
            .eq('payload->>providerMessageId', referenceId)
            .limit(1)
            .maybeSingle();
        const candidateId = outboundMatch?.payload?.candidateId;
        if (typeof candidateId === 'string' && candidateId) {
            return { candidateId, matchedBy: 'reply_header' };
        }
    }
    const fromEmail = extractEmail(args.from);
    if (fromEmail) {
        const { data } = await db
            .from('candidates')
            .select('id')
            .ilike('email', fromEmail)
            .neq('status', 'Deleted')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (data?.id) {
            return { candidateId: data.id, matchedBy: 'sender_email' };
        }
    }
    return null;
}
async function triggerHostingerManualPoll() {
    return pollHostingerMailbox('manual');
}
async function ensureHostingerPollingStarted(intervalMinutes = getHostingerPollingIntervalMinutes()) {
    if (!isHostingerPollingEnabled()) {
        logger.info('Hostinger mailbox polling worker disabled by configuration');
        return false;
    }
    if (!(0, hostingerMailboxService_1.isHostingerImapConfigured)()) {
        logger.warn('Hostinger IMAP credentials missing; automatic mailbox polling not started');
        return false;
    }
    if (pollingIntervalTimer) {
        return false;
    }
    logger.info('Starting Hostinger mailbox polling worker', { intervalMinutes });
    await (0, emailReplyAuditService_1.markAbandonedPollingRuns)(RUN_STALE_AFTER_MS);
    await pollHostingerMailbox('recovery');
    const intervalMs = intervalMinutes * 60 * 1000;
    pollingIntervalTimer = setInterval(async () => {
        await pollHostingerMailbox('worker');
    }, intervalMs);
    pollingIntervalTimer.unref?.();
    return true;
}
async function startHostingerPolling(intervalMinutes = getHostingerPollingIntervalMinutes()) {
    await ensureHostingerPollingStarted(intervalMinutes);
}
async function pollHostingerMailbox(trigger) {
    if (!(0, hostingerMailboxService_1.isHostingerImapConfigured)()) {
        logger.warn('Hostinger IMAP credentials missing; mailbox poll skipped');
        return { successCount: 0, errorCount: 0 };
    }
    if (isRunning) {
        logger.debug('Hostinger mailbox polling already running, skipping overlap');
        return { successCount: 0, errorCount: 0 };
    }
    const abandonedRuns = await (0, emailReplyAuditService_1.markAbandonedPollingRuns)(RUN_STALE_AFTER_MS);
    isRunning = true;
    const pollStartedAt = new Date().toISOString();
    activeRunId = await createPollingRun(trigger);
    const heartbeatTimer = startRunHeartbeat(activeRunId);
    pollingState.isRunning = true;
    pollingState.lastPollStartedAt = pollStartedAt;
    pollingState.lastHeartbeatAt = pollStartedAt;
    pollingState.lastError = null;
    const startedAtMs = Date.now();
    const checkpoint = await (0, emailReplyAuditService_1.getMailboxCheckpoint)();
    const latestCheckpoint = {
        lastSeenUid: checkpoint.lastSeenUid,
        lastSeenMessageId: checkpoint.lastSeenMessageId,
        lastSeenReceivedAt: checkpoint.lastSeenReceivedAt,
    };
    const unreadCountBefore = await (0, hostingerMailboxService_1.countUnreadHostingerMessages)().catch(() => 0);
    let messagesDiscovered = 0;
    let messagesProcessed = 0;
    let messagesMatched = 0;
    let messagesUnmatched = 0;
    let attachmentUploadSuccessCount = 0;
    let attachmentUploadErrorCount = 0;
    async function persistCheckpoint(args) {
        await (0, emailReplyAuditService_1.updateMailboxCheckpoint)({
            lastSeenUid: args.lastSeenUid,
            lastSeenMessageId: args.lastSeenMessageId,
            lastSeenReceivedAt: args.lastSeenReceivedAt,
            lastPollRunId: activeRunId,
            lastPollStartedAt: pollStartedAt,
            lastPollCompletedAt: args.lastPollCompletedAt,
            metadata: args.metadata,
        });
        latestCheckpoint.lastSeenUid = Math.max(latestCheckpoint.lastSeenUid, Math.floor(args.lastSeenUid));
        latestCheckpoint.lastSeenMessageId = args.lastSeenMessageId || latestCheckpoint.lastSeenMessageId;
        latestCheckpoint.lastSeenReceivedAt = args.lastSeenReceivedAt || latestCheckpoint.lastSeenReceivedAt;
    }
    await (0, emailReplyAuditService_1.updateMailboxCheckpoint)({
        lastSeenUid: checkpoint.lastSeenUid,
        lastSeenMessageId: checkpoint.lastSeenMessageId,
        lastSeenReceivedAt: checkpoint.lastSeenReceivedAt,
        lastPollRunId: activeRunId,
        lastPollStartedAt: pollStartedAt,
        metadata: {
            lastTrigger: trigger,
            lastRecoveredAbandonedRuns: abandonedRuns,
            lastWorkerInstanceId: WORKER_INSTANCE_ID,
        },
    }).catch((err) => {
        logger.warn('Failed to update mailbox checkpoint at poll start', { error: err });
    });
    try {
        const messages = await (0, hostingerMailboxService_1.listHostingerMessagesSinceUid)(checkpoint.lastSeenUid, POLL_BATCH_SIZE);
        messagesDiscovered = messages.length;
        if (!messages.length) {
            logger.info('No Hostinger mailbox messages found beyond current checkpoint', {
                checkpointUid: checkpoint.lastSeenUid,
            });
            pollingState.lastPollCompletedAt = new Date().toISOString();
            pollingState.lastResult = { successCount: 0, errorCount: 0 };
            await persistCheckpoint({
                lastSeenUid: latestCheckpoint.lastSeenUid,
                lastSeenMessageId: latestCheckpoint.lastSeenMessageId,
                lastSeenReceivedAt: latestCheckpoint.lastSeenReceivedAt,
                lastPollCompletedAt: pollingState.lastPollCompletedAt,
                metadata: {
                    lastTrigger: trigger,
                    lastPollMessageCount: 0,
                },
            }).catch((err) => {
                logger.warn('Failed to update mailbox checkpoint after empty poll', { error: err });
            });
            await completePollingRun({
                runId: activeRunId,
                status: 'completed',
                startedAtMs,
                unreadCountBefore,
                unreadCountAfter: await (0, hostingerMailboxService_1.countUnreadHostingerMessages)().catch(() => 0),
                messagesDiscovered,
                messagesProcessed,
                messagesMatched,
                messagesUnmatched,
                attachmentUploadSuccessCount,
                attachmentUploadErrorCount,
                successCount: 0,
                errorCount: 0,
            });
            return { successCount: 0, errorCount: 0 };
        }
        let successCount = 0;
        let errorCount = 0;
        for (const message of messages) {
            const externalId = `hostinger_${message.messageId}`;
            const trackingToken = extractTrackingToken(message.subject, message.bodyText);
            const receivedAt = message.date || new Date().toISOString();
            const fromEmail = extractEmail(message.from);
            const toEmail = extractEmail(message.to);
            const runItemId = activeRunId
                ? await (0, emailReplyAuditService_1.createPollingRunItem)({
                    runId: activeRunId,
                    providerMessageId: message.messageId,
                    externalMessageId: externalId,
                    messageUid: message.uid,
                    attachmentCount: message.attachments.length,
                    receivedAt,
                })
                : null;
            try {
                const inboxMessage = await (0, inboxService_1.createInboxMessage)({
                    source: emailReplyAuditService_1.HOSTINGER_PROVIDER,
                    externalMessageId: externalId,
                    payload: {
                        provider: emailReplyAuditService_1.HOSTINGER_PROVIDER,
                        mailbox: emailReplyAuditService_1.HOSTINGER_MAILBOX,
                        from: message.from,
                        to: message.to,
                        subject: message.subject,
                        bodyText: message.bodyText,
                        messageId: message.messageId,
                        inReplyTo: message.inReplyTo || null,
                        references: message.references,
                        uid: message.uid,
                    },
                    status: 'pending',
                    receivedAt,
                }).catch((err) => {
                    if (String(err.message).includes('already exists')) {
                        logger.debug('Hostinger mailbox message already recorded, skipping duplicate event creation', {
                            messageId: message.messageId,
                            uid: message.uid,
                        });
                        return null;
                    }
                    throw err;
                });
                if (!inboxMessage) {
                    messagesProcessed++;
                    successCount++;
                    if (runItemId) {
                        await (0, emailReplyAuditService_1.completePollingRunItem)({
                            runItemId,
                            status: 'duplicate',
                        });
                    }
                    await (0, hostingerMailboxService_1.markHostingerMessageSeen)(message.uid).catch((err) => {
                        logger.warn('Failed to mark duplicate Hostinger message as seen', { uid: message.uid, error: err });
                    });
                    await persistCheckpoint({
                        lastSeenUid: message.uid,
                        lastSeenMessageId: message.messageId,
                        lastSeenReceivedAt: receivedAt,
                        metadata: {
                            lastTrigger: trigger,
                            lastMessageStatus: 'duplicate',
                        },
                    }).catch((err) => {
                        logger.warn('Failed to advance mailbox checkpoint for duplicate message', { error: err, uid: message.uid });
                    });
                    continue;
                }
                const candidateMatch = await resolveCandidateMatch({
                    subject: message.subject,
                    bodyText: message.bodyText,
                    from: message.from,
                    inReplyTo: message.inReplyTo,
                    references: message.references,
                    trackingToken,
                });
                if (!candidateMatch) {
                    messagesProcessed++;
                    messagesUnmatched++;
                    const acceptedAttachments = message.attachments.filter((attachment) => (0, gmailService_1.isAcceptedCvMime)(attachment.mimeType));
                    if (acceptedAttachments.length > 0) {
                        let queuedAttachmentCount = 0;
                        let intakeErrorCount = 0;
                        for (let index = 0; index < acceptedAttachments.length; index++) {
                            const attachment = acceptedAttachments[index];
                            try {
                                const storagePath = `hostinger/${message.messageId}/${message.uid}_${index}_${attachment.filename}`;
                                const createdAttachment = await (0, inboxAttachmentService_1.createAttachment)({
                                    inboxMessageId: inboxMessage.id,
                                    fileBuffer: attachment.content,
                                    fileName: attachment.filename,
                                    mimeType: attachment.mimeType,
                                    attachmentType: 'cv',
                                    storageBucket: 'documents',
                                    storagePath,
                                    candidateId: undefined,
                                    messageSubject: message.subject,
                                    messageSource: 'email',
                                }).catch((err) => {
                                    if (String(err.message).includes('Duplicate')) {
                                        logger.debug('Hostinger intake attachment already exists, skipping duplicate', {
                                            filename: attachment.filename,
                                            messageId: message.messageId,
                                        });
                                        return null;
                                    }
                                    throw err;
                                });
                                if (createdAttachment?.id) {
                                    await (0, inboxAttachmentService_1.enqueueCvParsingJobForAttachment)(createdAttachment.id, {
                                        force: false,
                                        expiresInSeconds: 3600,
                                    });
                                    queuedAttachmentCount++;
                                }
                            }
                            catch (err) {
                                logger.error('Failed to enqueue Hostinger intake attachment', err, {
                                    filename: attachment.filename,
                                    messageId: message.messageId,
                                    uid: message.uid,
                                });
                                intakeErrorCount++;
                                attachmentUploadErrorCount++;
                            }
                        }
                        attachmentUploadSuccessCount += queuedAttachmentCount;
                        await (0, database_1.supabaseAdminClient)()
                            .from('inbox_messages')
                            .update({
                            status: 'processed',
                            payload: {
                                ...(inboxMessage.payload || {}),
                                matched: false,
                                matchedBy: null,
                                candidateId: null,
                                attachmentCount: message.attachments.length,
                                acceptedAttachmentCount: acceptedAttachments.length,
                                queuedCvAttachmentCount: queuedAttachmentCount,
                                processedAt: new Date().toISOString(),
                                intakeRoutedToCvPipeline: true,
                            },
                        })
                            .eq('id', inboxMessage.id);
                        await (0, emailReplyAuditService_1.createEmailReplyEvent)({
                            providerMessageId: message.messageId,
                            externalMessageId: externalId,
                            messageUid: message.uid,
                            inboxMessageId: inboxMessage.id,
                            runId: activeRunId,
                            runItemId,
                            matchStatus: 'unmatched',
                            trackingToken,
                            fromEmail,
                            fromDisplay: message.from,
                            toEmail,
                            subject: message.subject,
                            bodyText: message.bodyText,
                            attachmentCount: message.attachments.length,
                            attachmentUploadSuccessCount: queuedAttachmentCount,
                            attachmentUploadErrorCount: intakeErrorCount,
                            receivedAt,
                            inReplyTo: message.inReplyTo,
                            referenceIds: message.references,
                            correlationIds: {
                                matched: false,
                                matchedBy: null,
                                intakeRoutedToCvPipeline: true,
                                queuedCvAttachmentCount: queuedAttachmentCount,
                            },
                        });
                        if (runItemId) {
                            await (0, emailReplyAuditService_1.completePollingRunItem)({
                                runItemId,
                                status: 'unmatched',
                                inboxMessageId: inboxMessage.id,
                                attachmentUploadSuccessCount: queuedAttachmentCount,
                                attachmentUploadErrorCount: intakeErrorCount,
                            });
                        }
                        await (0, hostingerMailboxService_1.markHostingerMessageSeen)(message.uid).catch((err) => {
                            logger.warn('Failed to mark Hostinger intake message as seen', { uid: message.uid, error: err });
                        });
                        await persistCheckpoint({
                            lastSeenUid: message.uid,
                            lastSeenMessageId: message.messageId,
                            lastSeenReceivedAt: receivedAt,
                            metadata: {
                                lastTrigger: trigger,
                                lastMessageStatus: 'intake_enqueued',
                                lastQueuedCvAttachmentCount: queuedAttachmentCount,
                            },
                        }).catch((err) => {
                            logger.warn('Failed to advance mailbox checkpoint for Hostinger intake message', { error: err, uid: message.uid });
                        });
                        successCount++;
                        continue;
                    }
                    logger.warn('Hostinger mailbox reply could not be matched to candidate', {
                        subject: message.subject,
                        from: message.from,
                        messageId: message.messageId,
                        uid: message.uid,
                    });
                    await (0, database_1.supabaseAdminClient)()
                        .from('inbox_messages')
                        .update({
                        status: 'failed',
                        payload: {
                            ...(inboxMessage.payload || {}),
                            matched: false,
                            matchedBy: null,
                            candidateId: null,
                            attachmentCount: message.attachments.length,
                            processedAt: new Date().toISOString(),
                        },
                    })
                        .eq('id', inboxMessage.id);
                    await (0, emailReplyAuditService_1.createEmailReplyEvent)({
                        providerMessageId: message.messageId,
                        externalMessageId: externalId,
                        messageUid: message.uid,
                        inboxMessageId: inboxMessage.id,
                        runId: activeRunId,
                        runItemId,
                        matchStatus: 'unmatched',
                        trackingToken,
                        fromEmail,
                        fromDisplay: message.from,
                        toEmail,
                        subject: message.subject,
                        bodyText: message.bodyText,
                        attachmentCount: message.attachments.length,
                        receivedAt,
                        inReplyTo: message.inReplyTo,
                        referenceIds: message.references,
                        correlationIds: {
                            matched: false,
                            matchedBy: null,
                        },
                    });
                    if (runItemId) {
                        await (0, emailReplyAuditService_1.completePollingRunItem)({
                            runItemId,
                            status: 'unmatched',
                            inboxMessageId: inboxMessage.id,
                        });
                    }
                    await (0, hostingerMailboxService_1.markHostingerMessageSeen)(message.uid).catch((err) => {
                        logger.warn('Failed to mark unmatched Hostinger message as seen', { uid: message.uid, error: err });
                    });
                    await persistCheckpoint({
                        lastSeenUid: message.uid,
                        lastSeenMessageId: message.messageId,
                        lastSeenReceivedAt: receivedAt,
                        metadata: {
                            lastTrigger: trigger,
                            lastMessageStatus: 'unmatched',
                        },
                    }).catch((err) => {
                        logger.warn('Failed to advance mailbox checkpoint for unmatched message', { error: err, uid: message.uid });
                    });
                    successCount++;
                    continue;
                }
                const { candidateId, matchedBy } = candidateMatch;
                messagesMatched++;
                let messageAttachmentSuccessCount = 0;
                let messageAttachmentErrorCount = 0;
                for (const attachment of message.attachments) {
                    try {
                        await (0, candidateDocumentService_1.uploadCandidateDocument)({
                            candidate_id: candidateId,
                            file_name: attachment.filename,
                            mime_type: attachment.mimeType,
                            buffer: attachment.content,
                            source: 'email',
                        });
                        attachmentUploadSuccessCount++;
                        messageAttachmentSuccessCount++;
                    }
                    catch (err) {
                        logger.error('Failed to upload Hostinger reply attachment', err, {
                            candidateId,
                            filename: attachment.filename,
                        });
                        attachmentUploadErrorCount++;
                        messageAttachmentErrorCount++;
                        errorCount++;
                    }
                }
                if (message.bodyText.trim()) {
                    await (0, missingDataEmailReplyService_1.processMissingDataEmailReply)({
                        candidateId,
                        emailBodyText: message.bodyText,
                        hadAttachments: message.attachments.length > 0,
                    });
                }
                await (0, missingDataEmailService_1.maybeSendMissingDataEmail)({
                    candidateId,
                    trigger: 'hostinger_reply_ingested',
                });
                await (0, database_1.supabaseAdminClient)()
                    .from('inbox_messages')
                    .update({
                    status: 'processed',
                    payload: {
                        ...(inboxMessage.payload || {}),
                        matched: true,
                        matchedBy,
                        candidateId,
                        attachmentCount: message.attachments.length,
                        processedAt: new Date().toISOString(),
                    },
                })
                    .eq('id', inboxMessage.id);
                await (0, emailReplyAuditService_1.createEmailReplyEvent)({
                    providerMessageId: message.messageId,
                    externalMessageId: externalId,
                    messageUid: message.uid,
                    inboxMessageId: inboxMessage.id,
                    runId: activeRunId,
                    runItemId,
                    candidateId,
                    matchStatus: 'matched',
                    matchedBy,
                    trackingToken,
                    fromEmail,
                    fromDisplay: message.from,
                    toEmail,
                    subject: message.subject,
                    bodyText: message.bodyText,
                    attachmentCount: message.attachments.length,
                    attachmentUploadSuccessCount: messageAttachmentSuccessCount,
                    attachmentUploadErrorCount: messageAttachmentErrorCount,
                    receivedAt,
                    inReplyTo: message.inReplyTo,
                    referenceIds: message.references,
                    correlationIds: {
                        candidateId,
                        matchedBy,
                        inboxMessageId: inboxMessage.id,
                    },
                });
                if (runItemId) {
                    await (0, emailReplyAuditService_1.completePollingRunItem)({
                        runItemId,
                        status: 'matched',
                        inboxMessageId: inboxMessage.id,
                        candidateId,
                        matchedBy,
                        attachmentUploadSuccessCount: messageAttachmentSuccessCount,
                        attachmentUploadErrorCount: messageAttachmentErrorCount,
                    });
                }
                pollingState.lastMatchedReply = {
                    candidateId,
                    messageId: message.messageId,
                    subject: message.subject,
                    from: message.from,
                    matchedBy,
                    receivedAt,
                };
                await (0, hostingerMailboxService_1.markHostingerMessageSeen)(message.uid).catch((err) => {
                    logger.warn('Failed to mark Hostinger message as seen', { uid: message.uid, error: err });
                });
                await persistCheckpoint({
                    lastSeenUid: message.uid,
                    lastSeenMessageId: message.messageId,
                    lastSeenReceivedAt: receivedAt,
                    metadata: {
                        lastTrigger: trigger,
                        lastMessageStatus: 'matched',
                        lastMatchedCandidateId: candidateId,
                    },
                }).catch((err) => {
                    logger.warn('Failed to advance mailbox checkpoint for matched message', { error: err, uid: message.uid });
                });
                messagesProcessed++;
                successCount++;
            }
            catch (err) {
                messagesProcessed++;
                errorCount++;
                pollingState.lastError = err instanceof Error ? err.message : String(err);
                logger.error('Failed to process Hostinger mailbox message', err, {
                    messageId: message.messageId,
                    uid: message.uid,
                });
                if (runItemId) {
                    await (0, emailReplyAuditService_1.completePollingRunItem)({
                        runItemId,
                        status: 'failed',
                        errorCode: 'HOSTINGER_MESSAGE_PROCESS_FAILED',
                        errorMessage: err instanceof Error ? err.message : String(err),
                        errorDetails: err instanceof Error ? { name: err.name, stack: err.stack || null } : { value: String(err) },
                    });
                }
                await (0, emailReplyAuditService_1.createEmailReplyEvent)({
                    providerMessageId: message.messageId,
                    externalMessageId: externalId,
                    messageUid: message.uid,
                    runId: activeRunId,
                    runItemId,
                    matchStatus: 'failed',
                    trackingToken,
                    fromEmail,
                    fromDisplay: message.from,
                    toEmail,
                    subject: message.subject,
                    bodyText: message.bodyText,
                    attachmentCount: message.attachments.length,
                    receivedAt,
                    inReplyTo: message.inReplyTo,
                    referenceIds: message.references,
                    errorCode: 'HOSTINGER_MESSAGE_PROCESS_FAILED',
                    errorMessage: err instanceof Error ? err.message : String(err),
                    errorDetails: err instanceof Error ? { name: err.name, stack: err.stack || null } : { value: String(err) },
                });
                break;
            }
        }
        logger.info('Hostinger mailbox poll completed', { successCount, errorCount, checkpointUid: latestCheckpoint.lastSeenUid });
        pollingState.lastPollCompletedAt = new Date().toISOString();
        pollingState.lastResult = { successCount, errorCount };
        await persistCheckpoint({
            lastSeenUid: latestCheckpoint.lastSeenUid,
            lastSeenMessageId: latestCheckpoint.lastSeenMessageId,
            lastSeenReceivedAt: latestCheckpoint.lastSeenReceivedAt,
            lastPollCompletedAt: pollingState.lastPollCompletedAt,
            metadata: {
                lastTrigger: trigger,
                lastPollMessageCount: messagesProcessed,
                lastPollErrorCount: errorCount,
            },
        }).catch((err) => {
            logger.warn('Failed to finalize mailbox checkpoint after poll', { error: err });
        });
        await completePollingRun({
            runId: activeRunId,
            status: errorCount > 0 ? 'completed_with_errors' : 'completed',
            startedAtMs,
            unreadCountBefore,
            unreadCountAfter: await (0, hostingerMailboxService_1.countUnreadHostingerMessages)().catch(() => 0),
            messagesDiscovered,
            messagesProcessed,
            messagesMatched,
            messagesUnmatched,
            attachmentUploadSuccessCount,
            attachmentUploadErrorCount,
            successCount,
            errorCount,
        });
        return { successCount, errorCount };
    }
    catch (err) {
        logger.error('Hostinger mailbox polling failed', err);
        pollingState.lastPollCompletedAt = new Date().toISOString();
        pollingState.lastResult = { successCount: 0, errorCount: 1 };
        pollingState.lastError = err instanceof Error ? err.message : String(err);
        await persistCheckpoint({
            lastSeenUid: latestCheckpoint.lastSeenUid,
            lastSeenMessageId: latestCheckpoint.lastSeenMessageId,
            lastSeenReceivedAt: latestCheckpoint.lastSeenReceivedAt,
            lastPollCompletedAt: pollingState.lastPollCompletedAt,
            metadata: {
                lastTrigger: trigger,
                lastPollMessageCount: messagesProcessed,
                lastPollErrorCount: 1,
            },
        }).catch((checkpointError) => {
            logger.warn('Failed to persist mailbox checkpoint after poll failure', { error: checkpointError });
        });
        await completePollingRun({
            runId: activeRunId,
            status: 'failed',
            startedAtMs,
            unreadCountBefore,
            unreadCountAfter: await (0, hostingerMailboxService_1.countUnreadHostingerMessages)().catch(() => unreadCountBefore),
            messagesDiscovered,
            messagesProcessed,
            messagesMatched,
            messagesUnmatched,
            attachmentUploadSuccessCount,
            attachmentUploadErrorCount,
            successCount: 0,
            errorCount: 1,
            errorCode: 'HOSTINGER_POLL_FAILED',
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err instanceof Error ? { name: err.name, stack: err.stack || null } : { value: String(err) },
        });
        return { successCount: 0, errorCount: 1 };
    }
    finally {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
        }
        isRunning = false;
        activeRunId = null;
        pollingState.isRunning = false;
    }
}
