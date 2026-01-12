"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMessages = listMessages;
exports.getMessage = getMessage;
exports.getAttachment = getAttachment;
exports.testConnection = testConnection;
const googleapis_1 = require("googleapis");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('GmailService');
function getCredentials() {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
        throw new errorHandling_1.AppError('Gmail credentials not configured', errorHandling_1.ErrorType.VALIDATION, 500);
    }
    return { clientId, clientSecret, refreshToken };
}
function createOAuth2Client() {
    const { clientId, clientSecret, refreshToken } = getCredentials();
    const oauth2Client = new googleapis_1.google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
}
async function listMessages(query = 'filename:pdf OR filename:doc OR filename:docx', maxResults = 10) {
    const auth = createOAuth2Client();
    const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
    try {
        const res = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults,
        });
        return res.data.messages ?? [];
    }
    catch (err) {
        logger.error('Failed to list messages', err);
        throw new errorHandling_1.AppError('Failed to list Gmail messages', errorHandling_1.ErrorType.EXTERNAL_SERVICE, 502);
    }
}
async function getMessage(messageId) {
    const auth = createOAuth2Client();
    const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
    try {
        const res = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full',
        });
        const msg = res.data;
        const headers = msg.payload?.headers ?? [];
        const getHeader = (name) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
        const attachments = msg.payload?.parts
            ?.filter((part) => part.filename)
            .map((part) => ({
            id: part.body?.attachmentId ?? '',
            filename: part.filename ?? '',
            mimeType: part.mimeType ?? 'application/octet-stream',
            size: part.body?.size ?? 0,
        })) ?? [];
        return {
            id: msg.id ?? messageId,
            threadId: msg.threadId ?? '',
            from: getHeader('from'),
            to: getHeader('to'),
            subject: getHeader('subject'),
            internalDate: msg.internalDate ? new Date(parseInt(msg.internalDate, 10)).toISOString() : undefined,
            attachmentCount: attachments.length,
            attachments,
        };
    }
    catch (err) {
        logger.error('Failed to get message', err);
        throw new errorHandling_1.AppError('Failed to get Gmail message', errorHandling_1.ErrorType.EXTERNAL_SERVICE, 502);
    }
}
async function getAttachment(messageId, attachmentId) {
    const auth = createOAuth2Client();
    const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
    try {
        const res = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId,
            id: attachmentId,
        });
        const data = res.data.data;
        if (!data) {
            throw new Error('No attachment data returned');
        }
        return Buffer.from(data, 'base64');
    }
    catch (err) {
        logger.error('Failed to get attachment', err);
        throw new errorHandling_1.AppError('Failed to download Gmail attachment', errorHandling_1.ErrorType.EXTERNAL_SERVICE, 502);
    }
}
async function testConnection() {
    const auth = createOAuth2Client();
    const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
    try {
        const res = await gmail.users.getProfile({
            userId: 'me',
        });
        return {
            ok: true,
            email: res.data.emailAddress,
        };
    }
    catch (err) {
        logger.error('Gmail connection test failed', err);
        return {
            ok: false,
            error: err.message,
        };
    }
}
