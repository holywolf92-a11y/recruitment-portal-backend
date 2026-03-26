import crypto from 'crypto';
import { AppError, ErrorType, createLogger } from '../utils/errorHandling';

const logger = createLogger('WhatsAppService');

export interface WhatsAppBridgeMetadata {
  bridgeAccountId: string | null;
  bridgeLabel: string | null;
  originalSender: string | null;
  originalSenderPhone: string | null;
  originalMessageId: string | null;
  originalTimestamp: string | null;
  detection: string | null;
  fileHash: string | null;
  forwardedByPhone: string | null;
  rawFields: Record<string, string>;
}

export interface WhatsAppMessageData {
  wamid: string;
  from?: string;
  effectiveFrom?: string;
  type?: string;
  text?: string;
  timestamp?: string;
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  bridgeMetadata?: WhatsAppBridgeMetadata | null;
  raw?: any;
}

function isNonInboxSender(value: string | undefined | null): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;

  return normalized.endsWith('@broadcast')
    || normalized.endsWith('@g.us')
    || normalized.endsWith('@newsletter');
}

function normalizeBridgeSenderPhone(value: string | undefined): string | null {
  if (!value) return null;
  const withoutSuffix = value.replace(/@c\.us$/i, '').trim();
  const digits = withoutSuffix.replace(/\D/g, '');
  return digits || null;
}

function parseBridgeCaption(text: string | undefined, forwardedByPhone: string | undefined): WhatsAppBridgeMetadata | null {
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length || lines[0] !== '[FALISHA_BRIDGE]') {
    return null;
  }

  const rawFields: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;
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

export function validateWebhookToken(token: string | undefined, verifyToken: string | undefined) {
  if (!token || !verifyToken) return false;
  return token === verifyToken;
}

export function validateWebhookSignature(rawBody: string | undefined, signatureHeader: string | undefined, appSecret: string | undefined) {
  if (!rawBody || !signatureHeader || !appSecret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch (err) {
    logger.warn('Signature comparison failed', { err: (err as Error).message });
    return false;
  }
}

export function extractMessageData(payload: any): WhatsAppMessageData | null {
  const entry = payload?.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];

  if (!message || !message.id) return null;
  if (isNonInboxSender(message.from)) return null;

  const data: WhatsAppMessageData = {
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
  } else {
    data.effectiveFrom = data.from;
  }

  return data;
}

export async function fetchMediaMetadata(mediaId: string, accessToken: string) {
  const res = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error('Failed to fetch media metadata', { status: res.status, text });
    throw new AppError('Failed to fetch media metadata', ErrorType.EXTERNAL_SERVICE, 502);
  }
  return res.json();
}

export async function downloadMedia(url: string, accessToken: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error('Failed to download media', { status: res.status, text });
    throw new AppError('Failed to download media', ErrorType.EXTERNAL_SERVICE, 502);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function sendMessage(phoneNumberId: string, accessToken: string, to: string, text: string) {
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
    throw new AppError('Failed to send WhatsApp message', ErrorType.EXTERNAL_SERVICE, res.status);
  }

  return res.json();
}

export async function sendTemplateMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  template: {
    name: string;
    language: string;
    components?: any[];
  }
) {
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
    throw new AppError('Failed to send WhatsApp template message', ErrorType.EXTERNAL_SERVICE, res.status);
  }

  return res.json();
}
