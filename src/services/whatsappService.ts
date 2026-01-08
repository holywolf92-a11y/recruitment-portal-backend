import crypto from 'crypto';
import { AppError, ErrorType, createLogger } from '../utils/errorHandling';

const logger = createLogger('WhatsAppService');

export interface WhatsAppMessageData {
  wamid: string;
  from?: string;
  type?: string;
  text?: string;
  timestamp?: string;
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  raw?: any;
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
