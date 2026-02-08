"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMessages = listMessages;
exports.getMessage = getMessage;
exports.sendThreadReply = sendThreadReply;
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
function decodeGmailBody(data) {
    if (!data)
        return '';
    // Gmail uses base64url (RFC 4648 §5)
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLength);
    return Buffer.from(padded, 'base64').toString('utf8');
}
function extractPlainTextFromPayload(payload) {
    if (!payload)
        return '';
    // Prefer text/plain parts; fallback to payload.body.data.
    const parts = Array.isArray(payload.parts) ? payload.parts : [];
    const walk = (p) => {
        if (!p)
            return [];
        const mt = String(p.mimeType || '').toLowerCase();
        const filename = String(p.filename || '');
        // Skip attachments
        if (filename && filename.trim().length > 0)
            return [];
        const out = [];
        if (mt === 'text/plain' && p.body?.data) {
            out.push(decodeGmailBody(p.body.data));
        }
        const childParts = Array.isArray(p.parts) ? p.parts : [];
        for (const c of childParts)
            out.push(...walk(c));
        return out;
    };
    const plainParts = walk(payload).map((t) => t.trim()).filter(Boolean);
    if (plainParts.length > 0)
        return plainParts.join('\n\n');
    if (payload.body?.data)
        return decodeGmailBody(payload.body.data).trim();
    return '';
}
function base64UrlEncode(input) {
    const b64 = (Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8')).toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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
        const bodyText = extractPlainTextFromPayload(msg.payload);
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
            messageIdHeader: getHeader('Message-ID'),
            internalDate: msg.internalDate ? new Date(parseInt(msg.internalDate, 10)).toISOString() : undefined,
            attachmentCount: attachments.length,
            attachments,
            bodyText,
        };
    }
    catch (err) {
        logger.error('Failed to get message', err);
        throw new errorHandling_1.AppError('Failed to get Gmail message', errorHandling_1.ErrorType.EXTERNAL_SERVICE, 502);
    }
}
async function sendThreadReply(args) {
    const auth = createOAuth2Client();
    const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
    try {
        const headers = [];
        headers.push(`To: ${args.toEmail}`);
        headers.push(`Subject: ${args.subject}`);
        headers.push('MIME-Version: 1.0');
        headers.push('Content-Type: text/plain; charset=utf-8');
        const inReplyTo = args.inReplyToMessageId || args.referencesMessageId;
        if (inReplyTo)
            headers.push(`In-Reply-To: ${inReplyTo}`);
        if (args.referencesMessageId)
            headers.push(`References: ${args.referencesMessageId}`);
        const rfc822 = `${headers.join('\r\n')}\r\n\r\n${args.bodyText}`;
        const raw = base64UrlEncode(rfc822);
        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw,
                threadId: args.threadId,
            },
        });
        return {
            id: res.data.id,
            threadId: res.data.threadId,
        };
    }
    catch (err) {
        logger.error('Failed to send Gmail thread reply', err);
        throw new errorHandling_1.AppError('Failed to send Gmail email', errorHandling_1.ErrorType.EXTERNAL_SERVICE, 502);
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
