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
/** How far back to look on the very first poll (24 hours). After that, only new files. */
let lastPollTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
function isDrivePollingEnabled() {
    return process.env.RUN_GOOGLE_DRIVE_POLLING === 'true';
}
async function startGoogleDrivePolling(intervalMinutes = 10) {
    if (!(0, googleDriveService_1.isDriveConfigured)()) {
        logger.warn('Google Drive not configured — set GOOGLE_DRIVE_REFRESH_TOKEN and GOOGLE_DRIVE_FOLDER_IDS');
        return;
    }
    const folderIds = (0, googleDriveService_1.getDriveFolderIds)();
    logger.info('Starting Google Drive polling worker', { intervalMinutes, folderCount: folderIds.length });
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
        const folderIds = (0, googleDriveService_1.getDriveFolderIds)();
        logger.info('Polling Google Drive folders', { folderCount: folderIds.length, since: lastPollTime.toISOString() });
        for (const folderId of folderIds) {
            try {
                const folderName = await (0, googleDriveService_1.getDriveFolderName)(folderId);
                const files = await (0, googleDriveService_1.listFilesInFolder)(folderId, lastPollTime);
                if (files.length === 0) {
                    logger.debug('No new files in Drive folder', { folderId, folderName });
                    continue;
                }
                logger.info(`Found ${files.length} new file(s) in Drive folder`, { folderId, folderName });
                for (const file of files) {
                    try {
                        const result = await processDriveFile(file, folderId, folderName);
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
            }
            catch (err) {
                logger.error('Failed to poll Drive folder', { folderId, error: err?.message });
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
    // Dedup: check if we've already processed this file
    const { data: existing } = await db
        .from('inbox_messages')
        .select('id')
        .eq('source', 'google_drive')
        .eq('external_message_id', externalId)
        .maybeSingle();
    if (existing) {
        logger.debug('Drive file already processed, skipping', { fileId: file.id, fileName: file.name });
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
    const inboxMessage = await (0, inboxService_1.createInboxMessage)({
        source: 'google_drive',
        externalMessageId: externalId,
        payload: {
            fileId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            folderId,
            folderName,
            modifiedTime: file.modifiedTime,
            size: file.size,
        },
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
    // Build storage path: google_drive/raw/{folderId}/{fileId}.{ext}
    const ext = (0, googleDriveService_1.driveExtFromMime)(file.mimeType);
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
    const storagePath = `google_drive/raw/${folderId}/${file.id}_${safeFileName}`;
    // Create attachment and enqueue for CV parsing
    const attachment = await (0, inboxAttachmentService_1.createAttachment)({
        inboxMessageId: inboxMessage.id,
        fileBuffer,
        fileName: file.name,
        mimeType: file.mimeType,
        storageBucket: 'candidate-documents',
        storagePath,
        messageSource: 'google_drive',
        messageSubject: `Google Drive: ${folderName}/${file.name}`,
    });
    if (!attachment?.id) {
        logger.warn('Failed to create attachment for Drive file', { fileId: file.id });
        return 'skipped';
    }
    await (0, inboxAttachmentService_1.enqueueCvParsingJobForAttachment)(attachment.id, { force: true });
    logger.info('Enqueued Drive file for CV parsing', {
        fileId: file.id,
        fileName: file.name,
        attachmentId: attachment.id,
    });
    return 'processed';
}
