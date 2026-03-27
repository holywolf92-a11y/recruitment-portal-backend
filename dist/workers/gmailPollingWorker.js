"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startGmailPolling = startGmailPolling;
exports.triggerManualPoll = triggerManualPoll;
const errorHandling_1 = require("../utils/errorHandling");
const inboxService_1 = require("../services/inboxService");
const inboxAttachmentService_1 = require("../services/inboxAttachmentService");
const gmailService_1 = require("../services/gmailService");
const candidateDocumentService_1 = require("../services/candidateDocumentService");
const missingDataEmailReplyService_1 = require("../services/missingDataEmailReplyService");
const missingDataEmailService_1 = require("../services/missingDataEmailService");
const database_1 = require("../config/database");
const logger = (0, errorHandling_1.createLogger)('GmailPollingWorker');
let isRunning = false;
let lastHistoryId = 0;
async function startGmailPolling(intervalMinutes = 5) {
    logger.info('Starting Gmail polling worker', { intervalMinutes });
    // Account 1 (falishamanpower4035@gmail.com) — handles candidate REPLIES to missing-data emails
    await pollGmail(undefined, 1);
    // Account 2 (falishaoep4035@gmail.com) — handles new incoming CVs
    if ((0, gmailService_1.isAccount2Configured)()) {
        await pollGmail((0, gmailService_1.createOAuth2ClientForAccount2)(), 2);
    }
    else {
        logger.warn('GMAIL2_REFRESH_TOKEN not set — skipping account 2 poll');
    }
    // Account 3 (cv.falishaoep@gmail.com) — label-filtered CV ingestion
    if ((0, gmailService_1.isAccount3Configured)()) {
        await pollGmail((0, gmailService_1.createOAuth2ClientForAccount3)(), 3);
    }
    else {
        logger.warn('GMAIL3_REFRESH_TOKEN not set — skipping account 3 poll (cv.falishaoep@gmail.com)');
    }
    // Then run every N minutes
    const intervalMs = intervalMinutes * 60 * 1000;
    setInterval(async () => {
        await pollGmail(undefined, 1);
        if ((0, gmailService_1.isAccount2Configured)()) {
            await pollGmail((0, gmailService_1.createOAuth2ClientForAccount2)(), 2);
        }
        if ((0, gmailService_1.isAccount3Configured)()) {
            await pollGmail((0, gmailService_1.createOAuth2ClientForAccount3)(), 3);
        }
    }, intervalMs);
}
/** Manually trigger one poll cycle (used by admin API). */
async function triggerManualPoll() {
    const r1 = await pollGmail(undefined, 1);
    let combined = { successCount: r1.successCount, errorCount: r1.errorCount };
    if ((0, gmailService_1.isAccount2Configured)()) {
        const r2 = await pollGmail((0, gmailService_1.createOAuth2ClientForAccount2)(), 2);
        combined = { successCount: combined.successCount + r2.successCount, errorCount: combined.errorCount + r2.errorCount };
    }
    if ((0, gmailService_1.isAccount3Configured)()) {
        const r3 = await pollGmail((0, gmailService_1.createOAuth2ClientForAccount3)(), 3);
        combined = { successCount: combined.successCount + r3.successCount, errorCount: combined.errorCount + r3.errorCount };
    }
    return combined;
}
async function pollGmail(authClient, accountNum = 1) {
    if (isRunning) {
        logger.debug('Gmail polling already in progress, skipping');
        return { successCount: 0, errorCount: 0 };
    }
    isRunning = true;
    const startTime = Date.now();
    try {
        logger.info('Starting Gmail poll');
        // Query for messages with attachments (PDFs, DOCs, images)
        // Account 3 uses label-filtered query based on GMAIL3_LABELS env var
        const gmailQuery = accountNum === 3 ? (0, gmailService_1.buildAccount3Query)() : gmailService_1.GMAIL_CV_QUERY;
        const { messages } = await (0, gmailService_1.listMessages)(gmailQuery, 20, undefined, authClient);
        if (!messages || messages.length === 0) {
            logger.info('No new Gmail messages with attachments');
            isRunning = false;
            return { successCount: 0, errorCount: 0 };
        }
        logger.info(`Found ${messages.length} messages to process`);
        let successCount = 0;
        let errorCount = 0;
        for (const msg of messages) {
            if (!msg.id)
                continue;
            try {
                const fullMessage = await (0, gmailService_1.getMessage)(msg.id, authClient);
                if (!fullMessage.attachments || fullMessage.attachments.length === 0) {
                    continue;
                }
                const db = (0, database_1.supabaseAdminClient)();
                const threadId = fullMessage.threadId;
                // STRATEGY 1 (PRIMARY): Extract tracking token from subject [#ABC12345]
                // This is the most reliable method for matching email replies to candidates
                const tokenMatch = (fullMessage.subject || '').match(/\[#([A-Z]{2}\d{6})\]/i);
                const trackingToken = tokenMatch ? tokenMatch[1].toUpperCase() : null;
                let resolvedCandidate = null;
                // Try token-based lookup first (most reliable)
                if (trackingToken) {
                    const { data: tokenMatch } = await db
                        .from('candidates')
                        .select('id')
                        .ilike('email_tracking_token', trackingToken)
                        .maybeSingle();
                    if (tokenMatch?.id) {
                        resolvedCandidate = { id: tokenMatch.id };
                        logger.info('Resolved candidate by tracking token', { candidateId: tokenMatch.id, trackingToken });
                    }
                }
                // STRATEGY 2 (FALLBACK): Gmail thread ID lookup
                if (!resolvedCandidate && threadId) {
                    const { data: threadMatch } = await db
                        .from('candidates')
                        .select('id')
                        .eq('gmail_thread_id', threadId)
                        .maybeSingle();
                    if (threadMatch?.id) {
                        resolvedCandidate = { id: threadMatch.id };
                        logger.info('Resolved candidate by Gmail thread ID', { candidateId: threadMatch.id, threadId });
                    }
                }
                // STRATEGY 3 (ADDITIONAL): Match by email address from "From" field
                // This prevents duplicates BEFORE parsing even starts
                if (!resolvedCandidate) {
                    const fromRaw = fullMessage.from || '';
                    const emailMatch = fromRaw.match(/<([^>]+)>/) || fromRaw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
                    const fromEmail = (emailMatch?.[1] || emailMatch?.[0] || '').trim().toLowerCase();
                    if (fromEmail) {
                        // Check if this email already has a candidate (skip government emails)
                        const isGovEmail = /police|govt|gov\.|government|official|admin@|info@|contact@/i.test(fromEmail);
                        if (!isGovEmail) {
                            const { data: emailCandidateMatch } = await db
                                .from('candidates')
                                .select('id, email')
                                .ilike('email', fromEmail)
                                .neq('status', 'Deleted')
                                .order('created_at', { ascending: false })
                                .limit(1)
                                .maybeSingle();
                            if (emailCandidateMatch?.id) {
                                resolvedCandidate = { id: emailCandidateMatch.id };
                                logger.info('Resolved candidate by email address (pre-parse deduplication)', {
                                    candidateId: emailCandidateMatch.id,
                                    email: fromEmail,
                                });
                            }
                        }
                    }
                }
                // If we have already seen this thread in inbox, treat subsequent messages as replies
                // even if the candidate mapping isn't written yet (prevents accidental new-candidate creation).
                const { data: existingThreadMessages } = threadId
                    ? await db
                        .from('inbox_messages')
                        .select('id')
                        .eq('source', 'gmail')
                        // PostgREST JSON path filter
                        .eq('payload->>threadId', threadId)
                        .limit(1)
                    : { data: null };
                const threadSeen = !!(existingThreadMessages && existingThreadMessages.length > 0);
                // Create inbox message with Gmail-specific ID
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
                        bodyText: fullMessage.bodyText,
                        inbox_account: accountNum, // which Gmail account received this
                    },
                    status: 'pending',
                    receivedAt: fullMessage.internalDate,
                }).catch((err) => {
                    // Duplicate message is OK - just skip
                    if (String(err.message).includes('already exists')) {
                        logger.debug('Message already in inbox, skipping', { externalId });
                        return null;
                    }
                    throw err;
                });
                if (!inboxMessage)
                    continue;
                // Reply path: resolvedCandidate found => upload attachments as candidate_documents + extract missing fields from reply text.
                if (resolvedCandidate?.id) {
                    try {
                        await db
                            .from('candidates')
                            .update({
                            gmail_thread_id: threadId || null,
                            gmail_last_message_id: fullMessage.messageIdHeader || null,
                            gmail_last_subject: fullMessage.subject || null,
                            gmail_from_email: fullMessage.from || null,
                        })
                            .eq('id', resolvedCandidate.id);
                    }
                    catch (updateErr) {
                        logger.warn('Failed updating candidate Gmail headers (non-fatal)', {
                            candidateId: resolvedCandidate.id,
                            error: updateErr,
                        });
                    }
                    for (const attachment of fullMessage.attachments) {
                        if (!attachment.id)
                            continue;
                        // Filter unsupported MIME types consistently across all paths
                        if (!(0, gmailService_1.isAcceptedCvMime)(attachment.mimeType)) {
                            logger.warn('Skipping unsupported MIME in reply attachment', {
                                filename: attachment.filename, mimeType: attachment.mimeType,
                            });
                            continue;
                        }
                        try {
                            const buffer = await (0, gmailService_1.getAttachment)(fullMessage.id, attachment.id, authClient);
                            await (0, candidateDocumentService_1.uploadCandidateDocument)({
                                candidate_id: resolvedCandidate.id,
                                file_name: attachment.filename,
                                mime_type: attachment.mimeType,
                                buffer,
                                source: 'email',
                            });
                            logger.debug('Uploaded reply attachment to candidate_documents', {
                                candidateId: resolvedCandidate.id,
                                filename: attachment.filename,
                            });
                        }
                        catch (err) {
                            logger.error('Failed to upload reply attachment to candidate_documents', err, {
                                candidateId: resolvedCandidate.id,
                                filename: attachment.filename,
                            });
                            errorCount++;
                        }
                    }
                    if (fullMessage.bodyText && fullMessage.bodyText.trim().length > 0) {
                        await (0, missingDataEmailReplyService_1.processMissingDataEmailReply)({
                            candidateId: resolvedCandidate.id,
                            emailBodyText: fullMessage.bodyText,
                            hadAttachments: fullMessage.attachments.length > 0,
                        });
                    }
                    // After processing, optionally send the next follow-up if due (cooldown/max-attempts are enforced).
                    await (0, missingDataEmailService_1.maybeSendMissingDataEmail)({
                        candidateId: resolvedCandidate.id,
                        trigger: 'gmail_reply_ingested',
                    });
                    successCount++;
                    continue;
                }
                // If this is a reply in an already-seen thread (but candidate isn't mapped yet), look up the original candidate.
                if (threadSeen && !resolvedCandidate?.id) {
                    logger.info('Thread already seen but no candidate mapped yet; looking up original candidate', {
                        threadId,
                        messageId: fullMessage.id,
                    });
                    let resolvedCandidateId = null;
                    // Strategy 1: Find candidate from thread history by looking up inbox_attachments from this Gmail thread
                    const { data: threadAttachments } = await db
                        .from('inbox_attachments')
                        .select('candidate_id, inbox_message_id')
                        .not('candidate_id', 'is', null)
                        .limit(100);
                    if (threadAttachments && threadAttachments.length > 0) {
                        const messageIds = threadAttachments.map(a => a.inbox_message_id).filter(Boolean);
                        const { data: threadMessages } = await db
                            .from('inbox_messages')
                            .select('id, payload')
                            .in('id', messageIds)
                            .eq('source', 'gmail');
                        const matchingMessage = threadMessages?.find((m) => {
                            const payload = m.payload || {};
                            return payload.threadId === threadId;
                        });
                        if (matchingMessage) {
                            const matchingAttachment = threadAttachments.find(a => a.inbox_message_id === matchingMessage.id);
                            if (matchingAttachment?.candidate_id) {
                                resolvedCandidateId = matchingAttachment.candidate_id;
                                logger.info('Resolved candidate from Gmail thread history', { resolvedCandidateId, threadId });
                            }
                        }
                    }
                    // Strategy 2: If thread lookup failed, match by email address (common for web uploads that later reply via email)
                    if (!resolvedCandidateId) {
                        const fromRaw = fullMessage.from || '';
                        const emailMatch = fromRaw.match(/<([^>]+)>/) || fromRaw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
                        const fromEmail = (emailMatch?.[1] || emailMatch?.[0] || '').trim().toLowerCase();
                        if (fromEmail) {
                            // Look for candidate with matching email who was recently sent a missing data email
                            const { data: emailMatch } = await db
                                .from('candidates')
                                .select('id, email, missing_data_email_last_sent_at')
                                .ilike('email', fromEmail)
                                .not('missing_data_email_last_sent_at', 'is', null)
                                .order('missing_data_email_last_sent_at', { ascending: false })
                                .limit(1)
                                .maybeSingle();
                            if (emailMatch?.id) {
                                resolvedCandidateId = emailMatch.id;
                                logger.info('Resolved candidate by email address match', {
                                    resolvedCandidateId,
                                    email: fromEmail,
                                    threadId
                                });
                            }
                        }
                    }
                    // If we found the candidate, link all reply attachments to them
                    if (resolvedCandidateId) {
                        for (const attachment of fullMessage.attachments) {
                            if (!attachment.id)
                                continue;
                            try {
                                const buffer = await (0, gmailService_1.getAttachment)(fullMessage.id, attachment.id, authClient);
                                await (0, candidateDocumentService_1.uploadCandidateDocument)({
                                    candidate_id: resolvedCandidateId,
                                    file_name: attachment.filename,
                                    mime_type: attachment.mimeType,
                                    buffer,
                                    source: 'email',
                                });
                                logger.debug('Uploaded reply attachment to resolved candidate', {
                                    candidateId: resolvedCandidateId,
                                    filename: attachment.filename,
                                });
                            }
                            catch (err) {
                                logger.error('Failed to upload reply attachment to resolved candidate', err, {
                                    candidateId: resolvedCandidateId,
                                    filename: attachment.filename,
                                });
                                errorCount++;
                            }
                        }
                        // Process email body for missing data extraction
                        if (fullMessage.bodyText && fullMessage.bodyText.trim().length > 0) {
                            await (0, missingDataEmailReplyService_1.processMissingDataEmailReply)({
                                candidateId: resolvedCandidateId,
                                emailBodyText: fullMessage.bodyText,
                                hadAttachments: fullMessage.attachments.length > 0,
                            });
                        }
                        // Update candidate with Gmail tracking info (sets gmail_thread_id for future lookups)
                        await db
                            .from('candidates')
                            .update({
                            gmail_thread_id: threadId || null,
                            gmail_last_message_id: fullMessage.messageIdHeader || null,
                            gmail_last_subject: fullMessage.subject || null,
                            gmail_from_email: fullMessage.from || null,
                        })
                            .eq('id', resolvedCandidateId);
                        successCount++;
                        continue;
                    }
                    // If we couldn't resolve the candidate, skip to prevent creating duplicates
                    logger.warn('Thread already seen but could not resolve original candidate; skipping to prevent duplicates', {
                        threadId,
                        messageId: fullMessage.id,
                        from: fullMessage.from,
                    });
                    successCount++;
                    continue;
                }
                // At this point, no candidate was resolved by token/thread/email
                // Download and store attachments  — filter unsupported MIME types first
                // If resolvedCandidate exists (matched by email in Strategy 3), link attachments directly
                if (resolvedCandidate?.id) {
                    logger.info('Pre-parse deduplication: linking attachments to existing candidate', {
                        candidateId: resolvedCandidate.id,
                        messageId: fullMessage.id,
                    });
                    // Link all attachments directly to the resolved candidate
                    for (const attachment of fullMessage.attachments) {
                        if (!attachment.id)
                            continue;
                        try {
                            const buffer = await (0, gmailService_1.getAttachment)(fullMessage.id, attachment.id, authClient);
                            await (0, candidateDocumentService_1.uploadCandidateDocument)({
                                candidate_id: resolvedCandidate.id,
                                file_name: attachment.filename,
                                mime_type: attachment.mimeType,
                                buffer,
                                source: 'email',
                            });
                            logger.debug('Linked attachment to existing candidate (pre-parse dedup)', {
                                candidateId: resolvedCandidate.id,
                                filename: attachment.filename,
                            });
                        }
                        catch (err) {
                            logger.error('Failed to link attachment to existing candidate', err, {
                                candidateId: resolvedCandidate.id,
                                filename: attachment.filename,
                            });
                            errorCount++;
                        }
                    }
                    // Set gmail_thread_id for future lookups
                    await db
                        .from('candidates')
                        .update({
                        gmail_thread_id: threadId || null,
                        gmail_last_message_id: fullMessage.messageIdHeader || null,
                        gmail_last_subject: fullMessage.subject || null,
                        gmail_from_email: fullMessage.from || null,
                    })
                        .eq('id', resolvedCandidate.id);
                    successCount++;
                    continue;
                }
                // No existing candidate found - store attachments and queue parsing (will create new candidate)
                // NOTE: CV parser worker will perform secondary deduplication check via findExistingCandidate()
                // using CNIC/passport/phone/name matching after parsing completes
                for (const attachment of fullMessage.attachments) {
                    if (!attachment.id)
                        continue;
                    // Reject unsupported file types (ZIP/RAR/EXE and anything we can't parse)
                    if (!(0, gmailService_1.isAcceptedCvMime)(attachment.mimeType)) {
                        logger.warn('Skipping unsupported MIME type in Gmail attachment', {
                            filename: attachment.filename,
                            mimeType: attachment.mimeType,
                            messageId: fullMessage.id,
                        });
                        continue;
                    }
                    try {
                        const buffer = await (0, gmailService_1.getAttachment)(fullMessage.id, attachment.id, authClient);
                        // Immutable path: messageId + timestamp ensures no overwrites across different emails
                        const storagePath = `gmail/${fullMessage.id}/${Date.now()}_${attachment.filename}`;
                        const createdAttachment = await (0, inboxAttachmentService_1.createAttachment)({
                            inboxMessageId: inboxMessage.id,
                            fileBuffer: buffer,
                            fileName: attachment.filename,
                            mimeType: attachment.mimeType,
                            attachmentType: 'cv',
                            storageBucket: 'documents',
                            storagePath,
                            candidateId: undefined,
                        }).catch((err) => {
                            // Duplicate attachment is OK - it's the same CV from same email
                            if (String(err.message).includes('Duplicate')) {
                                logger.debug('Attachment already exists, skipping', { filename: attachment.filename });
                                return null;
                            }
                            throw err;
                        });
                        if (createdAttachment?.id) {
                            try {
                                await (0, inboxAttachmentService_1.enqueueCvParsingJobForAttachment)(createdAttachment.id, {
                                    force: false,
                                    expiresInSeconds: 3600,
                                });
                            }
                            catch (enqueueErr) {
                                logger.error('Failed to enqueue CV parsing job', enqueueErr, {
                                    attachmentId: createdAttachment.id,
                                    filename: attachment.filename,
                                });
                            }
                        }
                        logger.debug('Attachment stored', { filename: attachment.filename, messageId: fullMessage.id });
                    }
                    catch (err) {
                        logger.error('Failed to download/store attachment', err, { filename: attachment.filename, messageId: fullMessage.id });
                        errorCount++;
                    }
                }
                successCount++;
            }
            catch (err) {
                logger.error('Failed to process message', err, { messageId: msg.id });
                errorCount++;
            }
        }
        const duration = Date.now() - startTime;
        logger.info('Gmail poll completed', { successCount, errorCount, durationMs: duration });
        return { successCount, errorCount };
    }
    catch (err) {
        logger.error('Gmail polling failed', err);
        return { successCount: 0, errorCount: 1 };
    }
    finally {
        isRunning = false;
    }
}
