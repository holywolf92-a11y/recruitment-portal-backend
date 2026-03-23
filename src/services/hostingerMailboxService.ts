import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { createLogger } from '../utils/errorHandling';

const logger = createLogger('HostingerMailboxService');

export interface HostingerMailboxAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface HostingerMailboxMessage {
  uid: number;
  messageId: string;
  subject: string;
  from: string;
  to: string;
  date?: string;
  bodyText: string;
  inReplyTo?: string;
  references: string[];
  attachments: HostingerMailboxAttachment[];
}

interface ParsedAttachmentLike {
  filename?: string | null;
  contentType?: string | null;
  content: Buffer;
}

function getImapConfig() {
  return {
    host: process.env.HOSTINGER_IMAP_HOST || 'imap.hostinger.com',
    port: parseInt(process.env.HOSTINGER_IMAP_PORT || '993', 10),
    secure: String(process.env.HOSTINGER_IMAP_SECURE || 'true').toLowerCase() !== 'false',
    user: process.env.HOSTINGER_IMAP_USER || process.env.HOSTINGER_SMTP_USER || '',
    pass: process.env.HOSTINGER_IMAP_PASSWORD || process.env.HOSTINGER_SMTP_PASSWORD || '',
  };
}

function normalizeHeaderValue(value: string | string[] | undefined | null): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .flatMap((item) => String(item).split(/\s+/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAddressText(value: { text?: string } | Array<{ text?: string }> | undefined | null): string {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value.map((item) => item?.text || '').filter(Boolean).join(', ');
  }
  return value.text || '';
}

function normalizeMessageId(value: string | undefined | null): string {
  return String(value || '').trim().replace(/^<|>$/g, '');
}

export function isHostingerImapConfigured(): boolean {
  const cfg = getImapConfig();
  return !!(cfg.user && cfg.pass);
}

export async function countUnreadHostingerMessages(): Promise<number> {
  const cfg = getImapConfig();
  const client = new ImapFlow({
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
  } finally {
    lock.release();
    await client.logout().catch((err) => {
      logger.warn('Hostinger IMAP logout failed after unread count', { error: err });
    });
  }
}

async function collectFetchedMessages(client: ImapFlow, range: string | number[], limit = 20): Promise<HostingerMailboxMessage[]> {
  const items: HostingerMailboxMessage[] = [];

  for await (const message of client.fetch(range, { uid: true, envelope: true, source: true })) {
    if (!message.uid || !message.source) continue;

    const parsed = await simpleParser(message.source as Buffer);
    const parsedMessageId = normalizeMessageId(parsed.messageId);
    const fallbackMessageId = normalizeMessageId(message.envelope?.messageId as string | undefined);
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
      attachments: parsed.attachments.map((attachment: ParsedAttachmentLike, index: number) => ({
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

async function fetchHostingerMessages(range: string | number[], limit = 20): Promise<HostingerMailboxMessage[]> {
  const cfg = getImapConfig();
  const client = new ImapFlow({
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
  } finally {
    lock.release();
    await client.logout().catch((err) => {
      logger.warn('Hostinger IMAP logout failed', { error: err });
    });
  }
}

export async function listUnreadHostingerMessages(limit = 20): Promise<HostingerMailboxMessage[]> {
  const cfg = getImapConfig();
  const client = new ImapFlow({
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
  } finally {
    lock.release();
    await client.logout().catch((err) => {
      logger.warn('Hostinger IMAP logout failed after unread fetch', { error: err });
    });
  }
}

export async function listHostingerMessagesSinceUid(lastSeenUid: number, limit = 20): Promise<HostingerMailboxMessage[]> {
  const startUid = Math.max(1, Math.floor(lastSeenUid) + 1);
  const cfg = getImapConfig();
  const client = new ImapFlow({
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
  } finally {
    lock.release();
    await client.logout().catch((err) => {
      logger.warn('Hostinger IMAP logout failed after fetch-since-uid', { error: err });
    });
  }
}

export async function markHostingerMessageSeen(uid: number): Promise<void> {
  const cfg = getImapConfig();
  const client = new ImapFlow({
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
  } finally {
    lock.release();
    await client.logout().catch((err) => {
      logger.warn('Hostinger IMAP logout failed after mark-seen', { error: err });
    });
  }
}