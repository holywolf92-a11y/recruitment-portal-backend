import { google } from 'googleapis';
import { createLogger, AppError, ErrorType } from '../utils/errorHandling';

const logger = createLogger('GmailService');

interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

function getCredentials(): GmailCredentials {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new AppError('Gmail credentials not configured', ErrorType.VALIDATION, 500);
  }

  return { clientId, clientSecret, refreshToken };
}

function createOAuth2Client() {
  const { clientId, clientSecret, refreshToken } = getCredentials();

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return oauth2Client;
}

/** Create an OAuth2 client using a specific refresh token (for multi-account support). */
export function createOAuth2ClientWithToken(refreshToken: string) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new AppError('Gmail credentials not configured', ErrorType.VALIDATION, 500);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return oauth2Client;
}

/** CV-relevant Gmail query — includes all document and image attachment types */
export const GMAIL_CV_QUERY =
  'has:attachment (filename:pdf OR filename:doc OR filename:docx OR ' +
  'filename:jpg OR filename:jpeg OR filename:png OR filename:gif OR filename:webp OR ' +
  'filename:bmp OR filename:txt)';

/** MIME types we accept for CV processing */
export const ACCEPTED_CV_MIMES = new Set([
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
export const REJECTED_MIMES = new Set([
  'application/zip',
  'application/x-rar-compressed',
  'application/x-zip-compressed',
  'application/rar',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/x-executable',
  'application/x-msdownload',
]);

export function isAcceptedCvMime(mimeType: string): boolean {
  const m = mimeType.toLowerCase().split(';')[0].trim();
  if (REJECTED_MIMES.has(m)) return false;
  if (ACCEPTED_CV_MIMES.has(m)) return true;
  // Accept any image/*
  if (m.startsWith('image/')) return true;
  return false;
}

export async function listMessages(
  query: string = GMAIL_CV_QUERY,
  maxResults: number = 10,
  pageToken?: string,
  authClient?: ReturnType<typeof createOAuth2Client>
): Promise<{ messages: Array<{ id: string; threadId: string }>; nextPageToken?: string }> {
  const auth = authClient ?? createOAuth2Client();
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
      ...(pageToken ? { pageToken } : {}),
    });

    return {
      messages: (res.data.messages ?? []) as Array<{ id: string; threadId: string }>,
      nextPageToken: res.data.nextPageToken ?? undefined,
    };
  } catch (err) {
    logger.error('Failed to list messages', err);
    throw new AppError('Failed to list Gmail messages', ErrorType.EXTERNAL_SERVICE, 502);
  }
}

/**
 * Paginate through ALL matching Gmail messages.
 * Calls onBatch for each page so callers can process incrementally.
 */
export async function listAllMessages(
  query: string = GMAIL_CV_QUERY,
  options?: {
    batchSize?: number;
    afterDate?: Date;
    beforeDate?: Date;
    onBatch?: (ids: string[], pageNum: number, totalSoFar: number) => Promise<void>;
    maxTotal?: number;
    authClient?: ReturnType<typeof createOAuth2Client>;
  }
): Promise<{ total: number; pageCount: number }> {
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
  const maxTotal = options?.maxTotal ?? 10_000;
  let pageToken: string | undefined;
  let pageNum = 0;
  let total = 0;

  while (true) {
    const page = await listMessages(q, Math.min(batchSize, maxTotal - total), pageToken, options?.authClient);;
    const ids = page.messages.map((m) => m.id).filter(Boolean);

    if (ids.length > 0) {
      pageNum++;
      total += ids.length;
      if (options?.onBatch) await options.onBatch(ids, pageNum, total);
    }

    if (!page.nextPageToken || total >= maxTotal || ids.length === 0) break;
    pageToken = page.nextPageToken;
  }

  return { total, pageCount: pageNum };
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from?: string;
  to?: string;
  subject?: string;
  messageIdHeader?: string;
  internalDate?: string;
  attachmentCount?: number;
  attachments?: { id: string; filename: string; mimeType: string; size: number }[];
  bodyText?: string;
}

function decodeGmailBody(data?: string): string {
  if (!data) return '';
  // Gmail uses base64url (RFC 4648 §5)
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function extractPlainTextFromPayload(payload: any): string {
  if (!payload) return '';

  // Prefer text/plain parts; fallback to payload.body.data.
  const parts: any[] = Array.isArray(payload.parts) ? payload.parts : [];

  const walk = (p: any): string[] => {
    if (!p) return [];
    const mt = String(p.mimeType || '').toLowerCase();
    const filename = String(p.filename || '');

    // Skip attachments
    if (filename && filename.trim().length > 0) return [];

    const out: string[] = [];
    if (mt === 'text/plain' && p.body?.data) {
      out.push(decodeGmailBody(p.body.data));
    }

    const childParts: any[] = Array.isArray(p.parts) ? p.parts : [];
    for (const c of childParts) out.push(...walk(c));
    return out;
  };

  const plainParts = walk(payload).map((t) => t.trim()).filter(Boolean);
  if (plainParts.length > 0) return plainParts.join('\n\n');

  if (payload.body?.data) return decodeGmailBody(payload.body.data).trim();
  return '';
}

function base64UrlEncode(input: string | Buffer): string {
  const b64 = (Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8')).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function getMessage(messageId: string, authClient?: ReturnType<typeof createOAuth2Client>): Promise<GmailMessage> {
  const auth = authClient ?? createOAuth2Client();
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const msg = res.data;
    const headers = msg.payload?.headers ?? [];
    const getHeader = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;

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
  } catch (err) {
    logger.error('Failed to get message', err);
    throw new AppError('Failed to get Gmail message', ErrorType.EXTERNAL_SERVICE, 502);
  }
}

export async function sendThreadReply(args: {
  toEmail: string;
  subject: string;
  bodyText: string;
  threadId: string;
  inReplyToMessageId?: string;
  referencesMessageId?: string;
}) {
  const auth = createOAuth2Client();
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const headers: string[] = [];
    headers.push(`To: ${args.toEmail}`);
    headers.push(`Subject: ${args.subject}`);
    headers.push('MIME-Version: 1.0');
    headers.push('Content-Type: text/plain; charset=utf-8');

    const inReplyTo = args.inReplyToMessageId || args.referencesMessageId;
    if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
    if (args.referencesMessageId) headers.push(`References: ${args.referencesMessageId}`);

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
  } catch (err) {
    logger.error('Failed to send Gmail thread reply', err);
    throw new AppError('Failed to send Gmail email', ErrorType.EXTERNAL_SERVICE, 502);
  }
}

export async function getAttachment(messageId: string, attachmentId: string, authClient?: ReturnType<typeof createOAuth2Client>): Promise<Buffer> {
  const auth = authClient ?? createOAuth2Client();
  const gmail = google.gmail({ version: 'v1', auth });

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
  } catch (err) {
    logger.error('Failed to get attachment', err);
    throw new AppError('Failed to download Gmail attachment', ErrorType.EXTERNAL_SERVICE, 502);
  }
}

export async function testConnection() {
  const auth = createOAuth2Client();
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const res = await gmail.users.getProfile({
      userId: 'me',
    });
    return {
      ok: true,
      email: res.data.emailAddress,
    };
  } catch (err) {
    logger.error('Gmail connection test failed', err);
    return {
      ok: false,
      error: (err as Error).message,
    };
  }
}
