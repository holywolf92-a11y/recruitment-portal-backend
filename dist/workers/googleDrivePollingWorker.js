"use strict";
/**
 * Google Drive Polling Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Polls Google Drive folders for new CV files every 10 minutes and feeds them
 * into the existing CV parsing pipeline (same queue as Gmail/WhatsApp).
 *
 * Deduplication: uses the inbox_messages table with source='google_drive' and
 * externalMessageId='drive_{fileId}' — same pattern as Gmail uses 'gmail_{msgId}'.
 *
 * Required env vars:
 *   GOOGLE_DRIVE_REFRESH_TOKEN  — OAuth refresh token
 *   GOOGLE_DRIVE_FOLDER_IDS     — comma-separated folder IDs
 *   RUN_GOOGLE_DRIVE_POLLING    — set to 'true' to enable
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDrivePollingEnabled = isDrivePollingEnabled;
exports.startGoogleDrivePolling = startGoogleDrivePolling;
exports.triggerManualDrivePoll = triggerManualDrivePoll;
const errorHandling_1 = require("../utils/errorHandling");
const inboxService_1 = require("../services/inboxService");
const inboxAttachmentService_1 = require("../services/inboxAttachmentService");
const database_1 = require("../config/database");
const googleDriveService_1 = require("../services/googleDriveService");
const logger = (0, errorHandling_1.createLogger)('GoogleDrivePollingWorker');
let isDriveRunning = false;
/** How far back to look on the very first poll — scan everything since Jan 1 2024. After that, only new files. */
let lastPollTime = new Date('2024-01-01T00:00:00.000Z');
function isDrivePollingEnabled() {
    return process.env.RUN_GOOGLE_DRIVE_POLLING === 'true';
}
async function startGoogleDrivePolling(intervalMinutes = 10) {
    if (!(0, googleDriveService_1.isDriveConfigured)()) {
        logger.warn('Google Drive not configured — set GOOGLE_DRIVE_REFRESH_TOKEN');
        return;
    }
    logger.info('Starting Google Drive polling worker (scanning all Drive files)', { intervalMinutes });
    // Initial poll
    await pollDriveFolders();
    const intervalMs = intervalMinutes * 60 * 1000;
    setInterval(async () => {
        await pollDriveFolders();
    }, intervalMs);
}
/** Manually trigger one poll cycle (admin API). */
async function triggerManualDrivePoll() {
    return pollDriveFolders(true);
}
async function pollDriveFolders(force = false) {
    if (isDriveRunning && !force) {
        logger.debug('Drive polling already in progress, skipping');
        return { successCount: 0, errorCount: 0, skippedCount: 0 };
    }
    isDriveRunning = true;
    const pollStart = new Date();
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    try {
        logger.info('Polling Google Drive (all files)', { since: lastPollTime.toISOString() });
        const files = await (0, googleDriveService_1.listAllDriveFiles)(lastPollTime);
        logger.info(`Found ${files.length} new file(s) in Google Drive`, { count: files.length });
        for (const file of files) {
            try {
                const folderId = file.parents?.[0] ?? 'root';
                const result = await processDriveFile(file, folderId, 'Google Drive');
                if (result === 'processed')
                    successCount++;
                else if (result === 'skipped')
                    skippedCount++;
            }
            catch (err) {
                logger.error('Failed to process Drive file', { fileId: file.id, fileName: file.name, error: err?.message });
                errorCount++;
            }
        }
        lastPollTime = pollStart;
        logger.info('Google Drive poll complete', { successCount, errorCount, skippedCount });
    }
    finally {
        isDriveRunning = false;
    }
    return { successCount, errorCount, skippedCount };
}
async function processDriveFile(file, folderId, folderName) {
    const db = (0, database_1.supabaseAdminClient)();
    const externalId = `drive_${file.id}`;
    const drivePayload = {
        fileId: file.id,
        fileName: file.name,
        mimeType: file.mimeType,
        folderId,
        folderName,
        modifiedTime: file.modifiedTime,
        size: file.size,
    };
    // Dedup: check if we've already processed this file
    const { data: existing } = await db
        .from('inbox_messages')
        .select('id, status, payload, inbox_attachments(id)')
        .eq('source', 'google_drive')
        .eq('external_message_id', externalId)
        .maybeSingle();
    const existingAttachments = existing?.inbox_attachments ?? [];
    if (existing && existingAttachments.length > 0) {
        logger.debug('Drive file already processed, skipping', { fileId: file.id, fileName: file.name });
        return 'skipped';
    }
    if (existing?.status === 'duplicate') {
        logger.debug('Drive file previously marked duplicate, skipping', { fileId: file.id, fileName: file.name });
        return 'skipped';
    }
    logger.info('Processing new Drive file', { fileId: file.id, fileName: file.name, mimeType: file.mimeType });
    // Download file content
    const fileBuffer = await (0, googleDriveService_1.downloadDriveFile)(file.id);
    if (!fileBuffer || fileBuffer.length === 0) {
        logger.warn('Drive file is empty, skipping', { fileId: file.id });
        return 'skipped';
    }
    // Create inbox message for tracking
    const inboxMessage = existing ?? await (0, inboxService_1.createInboxMessage)({
        source: 'google_drive',
        externalMessageId: externalId,
        payload: drivePayload,
        status: 'pending',
        receivedAt: file.modifiedTime ? new Date(file.modifiedTime).toISOString() : new Date().toISOString(),
    }).catch((err) => {
        if (String(err?.message || '').includes('already exists')) {
            logger.debug('Drive inbox message already exists, skipping', { externalId });
            return null;
        }
        throw err;
    });
    if (!inboxMessage)
        return 'skipped';
    if (existing && existingAttachments.length === 0) {
        logger.warn('Repairing orphaned Drive inbox message with no attachments', {
            fileId: file.id,
            fileName: file.name,
            inboxMessageId: existing.id,
            status: existing.status,
        });
    }
    // Build storage path: google_drive/raw/{folderId}/{fileId}.{ext}
    const ext = (0, googleDriveService_1.driveExtFromMime)(file.mimeType);
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
    const storagePath = `google_drive/raw/${folderId}/${file.id}_${safeFileName}`;
    try {
        // Create attachment and enqueue for CV parsing
        const attachment = await (0, inboxAttachmentService_1.createAttachment)({
            inboxMessageId: inboxMessage.id,
            fileBuffer,
            fileName: file.name,
            mimeType: file.mimeType,
            attachmentType: 'cv',
            storageBucket: 'documents',
            storagePath,
            messageSource: 'google_drive',
            messageSubject: `Google Drive: ${folderName}/${file.name}`,
        });
        if (!attachment?.id) {
            logger.warn('Failed to create attachment for Drive file', { fileId: file.id });
            await (0, inboxService_1.updateInboxMessage)(inboxMessage.id, {
                status: 'failed',
                payload: {
                    ...(inboxMessage.payload || drivePayload),
                    lastDriveError: {
                        code: 'ATTACHMENT_CREATE_RETURNED_EMPTY',
                        message: 'Attachment creation returned no attachment id',
                        at: new Date().toISOString(),
                    },
                },
            });
            return 'skipped';
        }
        await (0, inboxAttachmentService_1.enqueueCvParsingJobForAttachment)(attachment.id, { force: true });
        await (0, inboxService_1.updateInboxMessage)(inboxMessage.id, {
            status: 'processing',
            payload: {
                ...(inboxMessage.payload || drivePayload),
                repairedAt: existing && existingAttachments.length === 0 ? new Date().toISOString() : undefined,
            },
        });
        logger.info('Enqueued Drive file for CV parsing', {
            fileId: file.id,
            fileName: file.name,
            attachmentId: attachment.id,
        });
        return 'processed';
    }
    catch (err) {
        const message = String(err?.message || err || 'Unknown Drive attachment error');
        if (err instanceof errorHandling_1.AppError && err.type === errorHandling_1.ErrorType.DUPLICATE) {
            await (0, inboxService_1.updateInboxMessage)(inboxMessage.id, {
                status: 'duplicate',
                payload: {
                    ...(inboxMessage.payload || drivePayload),
                    lastDriveError: {
                        code: 'DUPLICATE_ATTACHMENT',
                        message,
                        at: new Date().toISOString(),
                    },
                },
            });
            logger.info('Drive file matched existing CV attachment, marked as duplicate', {
                fileId: file.id,
                fileName: file.name,
                inboxMessageId: inboxMessage.id,
            });
            return 'skipped';
        }
        await (0, inboxService_1.updateInboxMessage)(inboxMessage.id, {
            status: 'failed',
            payload: {
                ...(inboxMessage.payload || drivePayload),
                lastDriveError: {
                    code: 'ATTACHMENT_OR_ENQUEUE_FAILED',
                    message,
                    at: new Date().toISOString(),
                },
            },
        });
        throw err;
    }
}
