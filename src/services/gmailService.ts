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

export async function listMessages(
  query: string = 'filename:pdf OR filename:doc OR filename:docx',
  maxResults: number = 10
) {
  const auth = createOAuth2Client();
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    return res.data.messages ?? [];
  } catch (err) {
    logger.error('Failed to list messages', err);
    throw new AppError('Failed to list Gmail messages', ErrorType.EXTERNAL_SERVICE, 502);
  }
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from?: string;
  to?: string;
  subject?: string;
  internalDate?: string;
  attachmentCount?: number;
  attachments?: { id: string; filename: string; mimeType: string; size: number }[];
}

export async function getMessage(messageId: string): Promise<GmailMessage> {
  const auth = createOAuth2Client();
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
  } catch (err) {
    logger.error('Failed to get message', err);
    throw new AppError('Failed to get Gmail message', ErrorType.EXTERNAL_SERVICE, 502);
  }
}

export async function getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const auth = createOAuth2Client();
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
