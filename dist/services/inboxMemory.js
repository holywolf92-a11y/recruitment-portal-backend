"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memCreateMessage = memCreateMessage;
exports.memListMessages = memListMessages;
exports.memGetMessage = memGetMessage;
exports.memUpdateMessage = memUpdateMessage;
exports.memDeleteMessage = memDeleteMessage;
exports.memCreateAttachment = memCreateAttachment;
exports.memListAttachmentsForMessage = memListAttachmentsForMessage;
exports.memDeleteAttachment = memDeleteAttachment;
const errorHandling_1 = require("../utils/errorHandling");
const messages = new Map();
const messagesByExternalId = new Map();
const attachments = new Map();
const cvDedupIndex = new Set(); // `${sha256}|cv`
function newId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
async function memCreateMessage(input) {
    if (messagesByExternalId.has(input.externalMessageId)) {
        throw new errorHandling_1.AppError('external_message_id already exists', errorHandling_1.ErrorType.DUPLICATE, 409);
    }
    const id = newId('msg');
    const m = {
        id,
        source: input.source,
        external_message_id: input.externalMessageId,
        payload: input.payload ?? null,
        status: input.status ?? 'pending',
        received_at: input.receivedAt ?? new Date().toISOString(),
        created_at: new Date().toISOString(),
    };
    messages.set(id, m);
    messagesByExternalId.set(input.externalMessageId, id);
    return m;
}
async function memListMessages(filters) {
    let arr = Array.from(messages.values());
    if (filters.source)
        arr = arr.filter((m) => m.source === filters.source);
    if (filters.status)
        arr = arr.filter((m) => m.status === filters.status);
    arr = arr.sort((a, b) => (b.received_at || '').localeCompare(a.received_at || ''));
    const total = arr.length;
    if (filters.limit !== undefined && filters.offset !== undefined) {
        arr = arr.slice(filters.offset, filters.offset + filters.limit);
    }
    else if (filters.limit !== undefined) {
        arr = arr.slice(0, filters.limit);
    }
    return { messages: arr, total, limit: filters.limit, offset: filters.offset };
}
async function memGetMessage(id) {
    const m = messages.get(id);
    if (!m)
        throw new errorHandling_1.AppError('Inbox message not found', errorHandling_1.ErrorType.NOT_FOUND, 404);
    return m;
}
async function memUpdateMessage(id, input) {
    const m = messages.get(id);
    if (!m)
        throw new errorHandling_1.AppError('Inbox message not found', errorHandling_1.ErrorType.NOT_FOUND, 404);
    if (input.status !== undefined)
        m.status = input.status;
    if (input.payload !== undefined)
        m.payload = input.payload;
    return m;
}
async function memDeleteMessage(id) {
    const m = messages.get(id);
    if (!m)
        throw new errorHandling_1.AppError('Inbox message not found', errorHandling_1.ErrorType.NOT_FOUND, 404);
    messages.delete(id);
    messagesByExternalId.delete(m.external_message_id);
    // Remove related attachments
    for (const [aid, a] of attachments) {
        if (a.inbox_message_id === id)
            attachments.delete(aid);
    }
    return m;
}
async function memCreateAttachment(input) {
    const msg = messages.get(input.inboxMessageId);
    if (!msg)
        throw new errorHandling_1.AppError('Inbox message not found', errorHandling_1.ErrorType.NOT_FOUND, 404);
    const id = newId('att');
    const att = {
        id,
        inbox_message_id: input.inboxMessageId,
        candidate_id: input.candidateId ?? null,
        storage_bucket: input.storageBucket,
        storage_path: input.storagePath,
        file_name: input.fileName,
        mime_type: input.mimeType ?? null,
        sha256: input.sha256 ?? null,
        attachment_type: input.attachmentType ?? 'cv',
        created_at: new Date().toISOString(),
    };
    // Dedup on sha256 + type=cv
    if (att.sha256 && att.attachment_type === 'cv') {
        const key = `${att.sha256}|cv`;
        if (cvDedupIndex.has(key)) {
            throw new errorHandling_1.AppError('Duplicate attachment (sha256 + type)', errorHandling_1.ErrorType.DUPLICATE, 409);
        }
        cvDedupIndex.add(key);
    }
    attachments.set(id, att);
    return att;
}
async function memListAttachmentsForMessage(messageId) {
    return Array.from(attachments.values()).filter((a) => a.inbox_message_id === messageId);
}
async function memDeleteAttachment(id) {
    const a = attachments.get(id);
    if (!a)
        throw new errorHandling_1.AppError('Inbox attachment not found', errorHandling_1.ErrorType.NOT_FOUND, 404);
    attachments.delete(id);
    return a;
}
