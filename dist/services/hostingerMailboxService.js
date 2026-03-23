"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHostingerImapConfigured = isHostingerImapConfigured;
exports.countUnreadHostingerMessages = countUnreadHostingerMessages;
exports.listUnreadHostingerMessages = listUnreadHostingerMessages;
exports.listHostingerMessagesSinceUid = listHostingerMessagesSinceUid;
exports.markHostingerMessageSeen = markHostingerMessageSeen;
const imapflow_1 = require("imapflow");
const mailparser_1 = require("mailparser");
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('HostingerMailboxService');
function getImapConfig() {
    return {
        host: process.env.HOSTINGER_IMAP_HOST || 'imap.hostinger.com',
        port: parseInt(process.env.HOSTINGER_IMAP_PORT || '993', 10),
        secure: String(process.env.HOSTINGER_IMAP_SECURE || 'true').toLowerCase() !== 'false',
        user: process.env.HOSTINGER_IMAP_USER || process.env.HOSTINGER_SMTP_USER || '',
        pass: process.env.HOSTINGER_IMAP_PASSWORD || process.env.HOSTINGER_SMTP_PASSWORD || '',
    };
}
function normalizeHeaderValue(value) {
    if (!value)
        return [];
    const list = Array.isArray(value) ? value : [value];
    return list
        .flatMap((item) => String(item).split(/\s+/))
        .map((item) => item.trim())
        .filter(Boolean);
}
function getAddressText(value) {
    if (!value)
        return '';
    if (Array.isArray(value)) {
        return value.map((item) => item?.text || '').filter(Boolean).join(', ');
    }
    return value.text || '';
}
function normalizeMessageId(value) {
    return String(value || '').trim().replace(/^<|>$/g, '');
}
function isHostingerImapConfigured() {
    const cfg = getImapConfig();
    return !!(cfg.user && cfg.pass);
}
async function countUnreadHostingerMessages() {
    const cfg = getImapConfig();
    const client = new imapflow_1.ImapFlow({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: {
            user: cfg.user,
            pass: cfg.pass,
        },
        logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
        const unseenUids = (await client.search({ seen: false })) || [];
        return unseenUids.length;
    }
    finally {
        lock.release();
        await client.logout().catch((err) => {
            logger.warn('Hostinger IMAP logout failed after unread count', { error: err });
        });
    }
}
async function collectFetchedMessages(client, range, limit = 20) {
    const items = [];
    for await (const message of client.fetch(range, { uid: true, envelope: true, source: true })) {
        if (!message.uid || !message.source)
            continue;
        const parsed = await (0, mailparser_1.simpleParser)(message.source);
        const parsedMessageId = normalizeMessageId(parsed.messageId);
        const fallbackMessageId = normalizeMessageId(message.envelope?.messageId);
        const messageId = parsedMessageId || fallbackMessageId || `hostinger-uid-${message.uid}`;
        items.push({
            uid: message.uid,
            messageId,
            subject: parsed.subject || message.envelope?.subject || '',
            from: getAddressText(parsed.from),
            to: getAddressText(parsed.to),
            date: parsed.date?.toISOString(),
            bodyText: parsed.text || '',
            inReplyTo: normalizeMessageId(parsed.inReplyTo),
            references: normalizeHeaderValue(parsed.references).map(normalizeMessageId).filter(Boolean),
            attachments: parsed.attachments.map((attachment, index) => ({
                filename: attachment.filename || `attachment-${message.uid}-${index + 1}`,
                mimeType: attachment.contentType || 'application/octet-stream',
                content: attachment.content,
            })),
        });
        if (items.length >= limit) {
            break;
        }
    }
    return items.sort((left, right) => left.uid - right.uid);
}
async function fetchHostingerMessages(range, limit = 20) {
    const cfg = getImapConfig();
    const client = new imapflow_1.ImapFlow({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: {
            user: cfg.user,
            pass: cfg.pass,
        },
        logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
        return await collectFetchedMessages(client, range, limit);
    }
    finally {
        lock.release();
        await client.logout().catch((err) => {
            logger.warn('Hostinger IMAP logout failed', { error: err });
        });
    }
}
async function listUnreadHostingerMessages(limit = 20) {
    const cfg = getImapConfig();
    const client = new imapflow_1.ImapFlow({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: {
            user: cfg.user,
            pass: cfg.pass,
        },
        logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
        const unseenUids = (await client.search({ seen: false })) || [];
        if (!unseenUids.length) {
            return [];
        }
        const selectedUids = unseenUids.slice(-limit);
        return await collectFetchedMessages(client, selectedUids, limit);
    }
    finally {
        lock.release();
        await client.logout().catch((err) => {
            logger.warn('Hostinger IMAP logout failed after unread fetch', { error: err });
        });
    }
}
async function listHostingerMessagesSinceUid(lastSeenUid, limit = 20) {
    const startUid = Math.max(1, Math.floor(lastSeenUid) + 1);
    const cfg = getImapConfig();
    const client = new imapflow_1.ImapFlow({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: {
            user: cfg.user,
            pass: cfg.pass,
        },
        logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
        const uidNext = Number(client.mailbox && typeof client.mailbox === 'object' ? client.mailbox.uidNext || 0 : 0);
        // Hostinger rejects FETCH ranges like "9:*" when uidNext is already 9.
        if (uidNext > 0 && startUid >= uidNext) {
            return [];
        }
        return await collectFetchedMessages(client, `${startUid}:*`, limit);
    }
    finally {
        lock.release();
        await client.logout().catch((err) => {
            logger.warn('Hostinger IMAP logout failed after fetch-since-uid', { error: err });
        });
    }
}
async function markHostingerMessageSeen(uid) {
    const cfg = getImapConfig();
    const client = new imapflow_1.ImapFlow({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: {
            user: cfg.user,
            pass: cfg.pass,
        },
        logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
    }
    finally {
        lock.release();
        await client.logout().catch((err) => {
            logger.warn('Hostinger IMAP logout failed after mark-seen', { error: err });
        });
    }
}
