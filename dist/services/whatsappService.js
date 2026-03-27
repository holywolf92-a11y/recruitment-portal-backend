"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWebhookToken = validateWebhookToken;
exports.validateWebhookSignature = validateWebhookSignature;
exports.extractMessageData = extractMessageData;
exports.fetchMediaMetadata = fetchMediaMetadata;
exports.downloadMedia = downloadMedia;
exports.sendMessage = sendMessage;
exports.sendTemplateMessage = sendTemplateMessage;
const crypto_1 = __importDefault(require("crypto"));
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('WhatsAppService');
function isNonInboxSender(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized)
        return false;
    return normalized.endsWith('@broadcast')
        || normalized.endsWith('@g.us')
        || normalized.endsWith('@newsletter');
}
function normalizeBridgeSenderPhone(value) {
    if (!value)
        return null;
    const withoutSuffix = value.replace(/@c\.us$/i, '').trim();
    const digits = withoutSuffix.replace(/\D/g, '');
    return digits || null;
}
function parseBridgeCaption(text, forwardedByPhone) {
    if (!text)
        return null;
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length || lines[0] !== '[FALISHA_BRIDGE]') {
        return null;
    }
    const rawFields = {};
    for (const line of lines.slice(1)) {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0)
            continue;
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (!key)
            continue;
        rawFields[key] = value;
    }
    const originalSender = rawFields.original_sender ?? null;
    return {
        bridgeAccountId: rawFields.bridge_account ?? null,
        bridgeLabel: rawFields.bridge_label ?? null,
        originalSender,
        originalSenderPhone: normalizeBridgeSenderPhone(originalSender ?? undefined),
        originalMessageId: rawFields.original_message_id ?? null,
        originalTimestamp: rawFields.original_timestamp ?? null,
        detection: rawFields.detection ?? null,
        fileHash: rawFields.file_hash ?? null,
        forwardedByPhone: forwardedByPhone ?? null,
        rawFields,
    };
}
function validateWebhookToken(token, verifyToken) {
    if (!token || !verifyToken)
        return false;
    return token === verifyToken;
}
function validateWebhookSignature(rawBody, signatureHeader, appSecret) {
    if (!rawBody || !signatureHeader || !appSecret)
        return false;
    const expected = `sha256=${crypto_1.default.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
    try {
        return crypto_1.default.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
    }
    catch (err) {
        logger.warn('Signature comparison failed', { err: err.message });
        return false;
    }
}
function extractMessageData(payload) {
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message || !message.id)
        return null;
    if (isNonInboxSender(message.from))
        return null;
    const data = {
        wamid: message.id,
        from: message.from,
        type: message.type,
        timestamp: message.timestamp,
        raw: payload,
    };
    if (message.type === 'text') {
        data.text = message.text?.body;
    }
    if (message.type === 'image' || message.type === 'document' || message.type === 'video' || message.type === 'audio' || message.type === 'sticker') {
        const media = message[message.type];
        data.mediaId = media?.id;
        data.mimeType = media?.mime_type;
        data.fileName = media?.filename;
        if (typeof media?.caption === 'string' && media.caption.trim()) {
            data.text = media.caption.trim();
        }
    }
    const bridgeMetadata = parseBridgeCaption(data.text, data.from);
    if (bridgeMetadata) {
        if (isNonInboxSender(bridgeMetadata.originalSender)) {
            return null;
        }
        data.bridgeMetadata = bridgeMetadata;
        data.effectiveFrom = bridgeMetadata.originalSenderPhone ?? data.from;
        data.raw = {
            webhook: payload,
            bridgeMetadata,
        };
    }
    else {
        data.effectiveFrom = data.from;
    }
    return data;
}
async function fetchMediaMetadata(mediaId, accessToken) {
    const res = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
        const text = await res.text();
        logger.error('Failed to fetch media metadata', { status: res.status, text });
        throw new errorHandling_1.AppError('Failed to fetch media metadata', errorHandling_1.ErrorType.EXTERNAL_SERVICE, 502);
    }
    return res.json();
}
async function downloadMedia(url, accessToken) {
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
        const text = await res.text();
        logger.error('Failed to download media', { status: res.status, text });
        throw new errorHandling_1.AppError('Failed to download media', errorHandling_1.ErrorType.EXTERNAL_SERVICE, 502);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
async function sendMessage(phoneNumberId, accessToken, to, text) {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: text },
        }),
    });
    if (!res.ok) {
        const textRes = await res.text();
        logger.error('Failed to send message', { status: res.status, text: textRes });
        throw new errorHandling_1.AppError('Failed to send WhatsApp message', errorHandling_1.ErrorType.EXTERNAL_SERVICE, res.status);
    }
    return res.json();
}
async function sendTemplateMessage(phoneNumberId, accessToken, to, template) {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
                name: template.name,
                language: { code: template.language },
                ...(template.components ? { components: template.components } : {}),
            },
        }),
    });
    if (!res.ok) {
        const textRes = await res.text();
        logger.error('Failed to send template message', { status: res.status, text: textRes });
        throw new errorHandling_1.AppError('Failed to send WhatsApp template message', errorHandling_1.ErrorType.EXTERNAL_SERVICE, res.status);
    }
    return res.json();
}
