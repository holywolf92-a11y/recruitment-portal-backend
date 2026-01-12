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
const crypto_1 = __importDefault(require("crypto"));
const errorHandling_1 = require("../utils/errorHandling");
const logger = (0, errorHandling_1.createLogger)('WhatsAppService');
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
