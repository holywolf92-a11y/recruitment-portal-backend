"use strict";
/**
 * Google Drive Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Polls Google Drive folders for new CV files and feeds them into the existing
 * CV parsing pipeline.
 *
 * Required env vars:
 *   GOOGLE_DRIVE_REFRESH_TOKEN  — OAuth refresh token (same one from get-google-token.js)
 *   GOOGLE_DRIVE_FOLDER_IDS     — comma-separated folder IDs from Drive URLs
 *                                 e.g. "1AbCdEfGhij123,1XyZwVutsrqpo456"
 *
 * Optional:
 *   GMAIL_CLIENT_ID             — Google OAuth Client ID (shared with Gmail)
 *   GMAIL_CLIENT_SECRET         — Google OAuth Client Secret (shared with Gmail)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAcceptedDriveMime = isAcceptedDriveMime;
exports.driveExtFromMime = driveExtFromMime;
exports.isDriveConfigured = isDriveConfigured;
exports.getDriveFolderIds = getDriveFolderIds;
exports.listAllDriveFiles = listAllDriveFiles;
exports.listFilesInFolder = listFilesInFolder;
exports.downloadDriveFile = downloadDriveFile;
exports.getDriveFileMetadata = getDriveFileMetadata;
exports.getDriveFolderName = getDriveFolderName;
const googleapis_1 = require("googleapis");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('GoogleDriveService');
/** MIME types we download from Drive as CVs */
const ACCEPTED_DRIVE_MIMES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'text/plain',
]);
/** Map from Drive mimeType to file extension */
const MIME_TO_EXT = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'text/plain': 'txt',
};
function isAcceptedDriveMime(mimeType) {
    const m = mimeType.toLowerCase().split(';')[0].trim();
    if (ACCEPTED_DRIVE_MIMES.has(m))
        return true;
    if (m.startsWith('image/'))
        return true;
    return false;
}
function driveExtFromMime(mimeType) {
    return MIME_TO_EXT[mimeType.toLowerCase().split(';')[0].trim()] ?? 'bin';
}
/** Returns true if Drive is fully configured (only needs refresh token). */
function isDriveConfigured() {
    return !!(process.env.GOOGLE_DRIVE_REFRESH_TOKEN);
}
/** Get the list of Drive folder IDs to watch (from GOOGLE_DRIVE_FOLDER_IDS). */
function getDriveFolderIds() {
    return (process.env.GOOGLE_DRIVE_FOLDER_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
}
function createDriveClient() {
    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    if (!refreshToken || !clientId || !clientSecret) {
        throw new errorHandling_1.AppError('Google Drive credentials not configured', errorHandling_1.ErrorType.VALIDATION, 500);
    }
    const auth = new googleapis_1.google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    return googleapis_1.google.drive({ version: 'v3', auth });
}
/**
 * Search ALL of the authenticated user's Drive for CV files.
 * Excludes videos and non-CV file types. Returns files modified after `afterDate`.
 */
async function listAllDriveFiles(afterDate) {
    const drive = createDriveClient();
    const mimeConditions = Array.from(ACCEPTED_DRIVE_MIMES).map(m => `mimeType = '${m}'`);
    let q = `trashed = false and (${mimeConditions.join(' or ')})`;
    if (afterDate) {
        const iso = afterDate.toISOString();
        q += ` and modifiedTime > '${iso}'`;
    }
    const files = [];
    let pageToken;
    do {
        const res = await drive.files.list({
            q,
            fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, parents)',
            orderBy: 'modifiedTime desc',
            pageSize: 100,
            ...(pageToken ? { pageToken } : {}),
        });
        const batch = res.data.files ?? [];
        for (const f of batch) {
            if (f.id && f.name && f.mimeType && isAcceptedDriveMime(f.mimeType)) {
                files.push({
                    id: f.id,
                    name: f.name,
                    mimeType: f.mimeType,
                    size: f.size ? Number(f.size) : undefined,
                    modifiedTime: f.modifiedTime ?? undefined,
                    parents: f.parents ?? undefined,
                });
            }
        }
        pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return files;
}
/**
 * List CV files in a Drive folder.
 * Returns files modified after `afterDate` if provided.
 * Only returns accepted MIME types (PDF, DOC, DOCX, images).
 */
async function listFilesInFolder(folderId, afterDate) {
    const drive = createDriveClient();
    let q = `'${folderId}' in parents and trashed = false and (`;
    const mimeConditions = Array.from(ACCEPTED_DRIVE_MIMES).map(m => `mimeType = '${m}'`);
    q += mimeConditions.join(' or ') + ')';
    if (afterDate) {
        const iso = afterDate.toISOString();
        q += ` and modifiedTime > '${iso}'`;
    }
    const files = [];
    let pageToken;
    do {
        const res = await drive.files.list({
            q,
            fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, parents)',
            orderBy: 'modifiedTime desc',
            pageSize: 100,
            ...(pageToken ? { pageToken } : {}),
        });
        const batch = res.data.files ?? [];
        for (const f of batch) {
            if (f.id && f.name && f.mimeType && isAcceptedDriveMime(f.mimeType)) {
                files.push({
                    id: f.id,
                    name: f.name,
                    mimeType: f.mimeType,
                    size: f.size ? Number(f.size) : undefined,
                    modifiedTime: f.modifiedTime ?? undefined,
                    parents: f.parents ?? undefined,
                });
            }
        }
        pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return files;
}
/**
 * Download a Drive file and return its content as a Buffer.
 */
async function downloadDriveFile(fileId) {
    const drive = createDriveClient();
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
}
/**
 * Get metadata for a single Drive file.
 */
async function getDriveFileMetadata(fileId) {
    const drive = createDriveClient();
    const res = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType, size, modifiedTime, parents',
    });
    const f = res.data;
    if (!f.id || !f.name || !f.mimeType) {
        throw new errorHandling_1.AppError(`Drive file ${fileId} missing required metadata`, errorHandling_1.ErrorType.VALIDATION, 404);
    }
    return {
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size ? Number(f.size) : undefined,
        modifiedTime: f.modifiedTime ?? undefined,
        parents: f.parents ?? undefined,
    };
}
/**
 * Get the name of a Drive folder for logging purposes.
 */
async function getDriveFolderName(folderId) {
    try {
        const drive = createDriveClient();
        const res = await drive.files.get({ fileId: folderId, fields: 'name' });
        return res.data.name ?? folderId;
    }
    catch {
        return folderId;
    }
}
