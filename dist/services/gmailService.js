"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REJECTED_MIMES = exports.ACCEPTED_CV_MIMES = exports.GMAIL_CV_QUERY = void 0;
exports.createOAuth2ClientWithToken = createOAuth2ClientWithToken;
exports.createOAuth2ClientForAccount2 = createOAuth2ClientForAccount2;
exports.isAccount2Configured = isAccount2Configured;
exports.createOAuth2ClientForAccount3 = createOAuth2ClientForAccount3;
exports.isAccount3Configured = isAccount3Configured;
exports.buildAccount3Query = buildAccount3Query;
exports.isAcceptedCvMime = isAcceptedCvMime;
exports.listMessages = listMessages;
exports.listAllMessages = listAllMessages;
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
/** Create an OAuth2 client using a specific refresh token (for multi-account support). */
function createOAuth2ClientWithToken(refreshToken, clientId, clientSecret) {
    const id = clientId ?? process.env.GMAIL_CLIENT_ID;
    const secret = clientSecret ?? process.env.GMAIL_CLIENT_SECRET;
    if (!id || !secret) {
        throw new errorHandling_1.AppError('Gmail credentials not configured', errorHandling_1.ErrorType.VALIDATION, 500);
    }
    const oauth2Client = new googleapis_1.google.auth.OAuth2(id, secret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
}
/**
 * Create an OAuth2 client for Account 2 (falishaoep4035@gmail.com).
 * Uses GMAIL2_CLIENT_ID / GMAIL2_CLIENT_SECRET / GMAIL2_REFRESH_TOKEN.
 * Falls back to shared GMAIL_CLIENT_ID/SECRET if account-specific ones are not set.
 */
function createOAuth2ClientForAccount2() {
    const refreshToken = process.env.GMAIL2_REFRESH_TOKEN;
    if (!refreshToken) {
        throw new errorHandling_1.AppError('GMAIL2_REFRESH_TOKEN not configured', errorHandling_1.ErrorType.VALIDATION, 500);
    }
    const clientId = process.env.GMAIL2_CLIENT_ID ?? process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL2_CLIENT_SECRET ?? process.env.GMAIL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new errorHandling_1.AppError('Gmail credentials not configured for account 2', errorHandling_1.ErrorType.VALIDATION, 500);
    }
    const oauth2Client = new googleapis_1.google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
}
/** Returns true if Account 2 is fully configured. */
function isAccount2Configured() {
    return !!(process.env.GMAIL2_REFRESH_TOKEN);
}
/**
 * Create an OAuth2 client for Account 3 (cv.falishaoep@gmail.com).
 * Uses GMAIL3_CLIENT_ID / GMAIL3_CLIENT_SECRET / GMAIL3_REFRESH_TOKEN.
 * Falls back to shared GMAIL_CLIENT_ID/SECRET if account-specific ones are not set.
 */
function createOAuth2ClientForAccount3() {
    const refreshToken = process.env.GMAIL3_REFRESH_TOKEN;
    if (!refreshToken) {
        throw new errorHandling_1.AppError('GMAIL3_REFRESH_TOKEN not configured', errorHandling_1.ErrorType.VALIDATION, 500);
    }
    const clientId = process.env.GMAIL3_CLIENT_ID ?? process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL3_CLIENT_SECRET ?? process.env.GMAIL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new errorHandling_1.AppError('Gmail credentials not configured for account 3', errorHandling_1.ErrorType.VALIDATION, 500);
    }
    const oauth2Client = new googleapis_1.google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
}
/** Returns true if Account 3 (cv.falishaoep@gmail.com) is fully configured. */
function isAccount3Configured() {
    return !!(process.env.GMAIL3_REFRESH_TOKEN);
}
/**
 * Build a Gmail search query that respects an optional GMAIL3_LABELS env var.
 * GMAIL3_LABELS is a comma-separated list of label names, e.g. "CVs,Applications".
 * If not set, returns the standard GMAIL_CV_QUERY.
 */
function buildAccount3Query() {
    const labelsEnv = process.env.GMAIL3_LABELS?.trim();
    if (!labelsEnv)
        return exports.GMAIL_CV_QUERY;
    const labelNames = labelsEnv.split(',').map(l => l.trim()).filter(Boolean);
    if (labelNames.length === 0)
        return exports.GMAIL_CV_QUERY;
    // Gmail search: "(label:CVs OR label:Applications) has:attachment ..."
    const labelClause = labelNames.map(l => `label:${l.replace(/\s+/g, '-')}`).join(' OR ');
    return `(${labelClause}) ${exports.GMAIL_CV_QUERY}`;
}
/** CV-relevant Gmail query — includes all document and image attachment types */
exports.GMAIL_CV_QUERY = 'has:attachment (filename:pdf OR filename:doc OR filename:docx OR ' +
    'filename:jpg OR filename:jpeg OR filename:png OR filename:gif OR filename:webp OR ' +
    'filename:bmp OR filename:txt)';
/** MIME types we accept for CV processing */
exports.ACCEPTED_CV_MIMES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
]);
/** MIME types we explicitly reject */
exports.REJECTED_MIMES = new Set([
    'application/zip',
    'application/x-rar-compressed',
    'application/x-zip-compressed',
    'application/rar',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/x-executable',
    'application/x-msdownload',
]);
function isAcceptedCvMime(mimeType) {
    const m = mimeType.toLowerCase().split(';')[0].trim();
    if (exports.REJECTED_MIMES.has(m))
        return false;
    if (exports.ACCEPTED_CV_MIMES.has(m))
        return true;
    // Accept any image/*
    if (m.startsWith('image/'))
        return true;
    return false;
}
/**
 * Retry wrapper for Gmail API calls with exponential backoff.
 * Handles 429 (rate limit) and 5xx (transient server errors) gracefully.
 * Gmail API quota: 250 quota units/user/second. Each list/get = 5 units.
 */
async function withGmailRetry(fn, maxAttempts = 5, baseDelayMs = 1000) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            const status = err?.response?.status ?? err?.code ?? err?.status ?? 0;
            const isRateLimit = status === 429 ||
                status === 403 ||
                String(err?.message || '').toLowerCase().includes('rate') ||
                String(err?.message || '').toLowerCase().includes('quota');
            const isTransient = isRateLimit || status === 500 || status === 502 || status === 503;
            if (!isTransient || attempt === maxAttempts)
                throw err;
            const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
            logger.warn(`Gmail API rate limit / transient error — retrying in ${Math.round(delay)}ms`, {
                attempt,
                status,
                message: err?.message,
            });
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastErr;
}
async function listMessages(query = exports.GMAIL_CV_QUERY, maxResults = 10, pageToken, authClient) {
    const auth = authClient ?? createOAuth2Client();
    const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
    return withGmailRetry(async () => {
        try {
            const res = await gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults,
                ...(pageToken ? { pageToken } : {}),
            });
            return {
                messages: (res.data.messages ?? []),
                nextPageToken: res.data.nextPageToken ?? undefined,
            };
        }
        catch (err) {
            logger.error('Failed to list messages', err);
            throw new errorHandling_1.AppError('Failed to list Gmail messages', errorHandling_1.ErrorType.EXTERNAL_SERVICE, 502);
        }
    });
}
/**
 * Paginate through ALL matching Gmail messages.
 * Calls onBatch for each page so callers can process incrementally.
 */
async function listAllMessages(query = exports.GMAIL_CV_QUERY, options) {
    let q = query;
    if (options?.afterDate) {
        const d = options.afterDate;
        q += ` after:${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    }
    if (options?.beforeDate) {
        const d = options.beforeDate;
        q += ` before:${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    }
    const batchSize = options?.batchSize ?? 100;
    const maxTotal = options?.maxTotal ?? 10000;
    const pageDelayMs = options?.pageDelayMs ?? 1000; // 1 s between pages = safe quota buffer
    let pageToken;
    let pageNum = 0;
    let total = 0;
    while (true) {
        const page = await listMessages(q, Math.min(batchSize, maxTotal - total), pageToken, options?.authClient);
        const ids = page.messages.map((m) => m.id).filter(Boolean);
        if (ids.length > 0) {
            pageNum++;
            total += ids.length;
            if (options?.onBatch)
                await options.onBatch(ids, pageNum, total);
        }
        if (!page.nextPageToken || total >= maxTotal || ids.length === 0)
            break;
        pageToken = page.nextPageToken;
        // Respect quota — pause between pages
        if (pageDelayMs > 0)
            await new Promise((r) => setTimeout(r, pageDelayMs));
    }
    return { total, pageCount: pageNum };
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
async function getMessage(messageId, authClient) {
    const auth = authClient ?? createOAuth2Client();
    const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
    return withGmailRetry(async () => {
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
    }); // end withGmailRetry
}
/**
 * Send a reply into an existing Gmail thread.
 * Pass `authClient` for Account 2 (falishaoep4035@gmail.com) threads;
 * omit to use Account 1 (falishamanpower4035@gmail.com).
 */
async function sendThreadReply(args, authClient) {
    const auth = authClient ?? createOAuth2Client();
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
async function getAttachment(messageId, attachmentId, authClient) {
    const auth = authClient ?? createOAuth2Client();
    const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
    return withGmailRetry(async () => {
        try {
            const res = await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId,
                id: attachmentId,
            });
            const data = res.data.data;
            if (!data)
                throw new Error('No attachment data returned');
            return Buffer.from(data, 'base64');
        }
        catch (err) {
            logger.error('Failed to get attachment', err);
            throw new errorHandling_1.AppError('Failed to download Gmail attachment', errorHandling_1.ErrorType.EXTERNAL_SERVICE, 502);
        }
    });
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
