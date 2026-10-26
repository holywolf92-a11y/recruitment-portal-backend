import crypto from 'crypto';
import { ImapFlow } from 'imapflow';
import type { MessageStructureObject } from 'imapflow';
import { simpleParser } from 'mailparser';

/**
 * Provider-neutral IMAP helpers shared by every mailbox poller
 * (Hostinger replies, Google Workspace intake mailboxes such as info@).
 */

export interface ImapConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface MailboxAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface MailboxMessage {
  uid: number;
  messageId: string;
  subject: string;
  from: string;
  to: string;
  date?: string;
  bodyText: string;
  inReplyTo?: string;
  references: string[];
  attachments: MailboxAttachment[];
}

/** An attachment-like body part, read from BODYSTRUCTURE without downloading the message. */
export interface MailboxAttachmentHint {
  part?: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface ParsedAttachmentLike {
  filename?: string | null;
  contentType?: string | null;
  content: Buffer;
}

export const INTAKE_CV_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const INTAKE_CV_EXTENSIONS = ['.pdf', '.doc', '.docx'];

const NEVER_CV_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/rar',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/x-executable',
  'application/x-msdownload',
]);

export function createImapClient(cfg: ImapConnectionConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
    logger: false,
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 5 * 60 * 1000,
  });
}

export function normalizeMimeType(value: string | null | undefined): string {
  return String(value || '').toLowerCase().split(';')[0].trim();
}

export function normalizeMessageId(value: string | undefined | null): string {
  return String(value || '').trim().replace(/^<|>$/g, '');
}

export function normalizeHeaderValue(value: string | string[] | undefined | null): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .flatMap((item) => String(item).split(/\s+/))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getAddressText(value: { text?: string } | Array<{ text?: string }> | undefined | null): string {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value.map((item) => item?.text || '').filter(Boolean).join(', ');
  }
  return value.text || '';
}

export function getEnvelopeAddressText(list: Array<{ name?: string; address?: string }> | undefined | null): string {
  if (!Array.isArray(list)) return '';
  return list
    .map((entry) => {
      const address = String(entry?.address || '').trim();
      const name = String(entry?.name || '').trim();
      if (name && address) return `${name} <${address}>`;
      return address || name;
    })
    .filter(Boolean)
    .join(', ');
}

/** PDF, DOC or DOCX, by MIME type or by file extension. */
export function isIntakeCvAttachment(mimeType: string | null | undefined, filename: string | null | undefined): boolean {
  const mime = normalizeMimeType(mimeType);
  if (NEVER_CV_MIME_TYPES.has(mime)) return false;
  const name = String(filename || '').toLowerCase().trim();
  if (INTAKE_CV_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return INTAKE_CV_MIME_TYPES.has(mime);
}

/** Leaf body parts that look like attachments (named, attachment disposition, or non-text). */
export function listAttachmentHints(structure: MessageStructureObject | undefined | null): MailboxAttachmentHint[] {
  const hints: MailboxAttachmentHint[] = [];

  const walk = (node: MessageStructureObject | undefined | null) => {
    if (!node) return;
    if (Array.isArray(node.childNodes) && node.childNodes.length > 0) {
      node.childNodes.forEach(walk);
      return;
    }

    const mimeType = normalizeMimeType(node.type);
    const filename = String(
      node.dispositionParameters?.filename || node.parameters?.name || ''
    ).trim();
    const isAttachmentDisposition = String(node.disposition || '').toLowerCase() === 'attachment';
    const isBodyText = (mimeType === 'text/plain' || mimeType === 'text/html') && !filename && !isAttachmentDisposition;
    if (isBodyText || mimeType.startsWith('multipart/')) return;

    hints.push({
      part: node.part,
      filename,
      mimeType,
      size: Number(node.size || 0),
    });
  };

  walk(structure);
  return hints;
}

/** Cheap BODYSTRUCTURE pre-filter: true when the message may carry a PDF/DOC/DOCX. */
export function mayContainIntakeCvAttachment(hints: MailboxAttachmentHint[]): boolean {
  return hints.some((hint) =>
    isIntakeCvAttachment(hint.mimeType, hint.filename) ||
    // Some senders label documents as generic binary with an unreadable name.
    (hint.mimeType === 'application/octet-stream' && !/\.(jpe?g|png|gif|zip|rar|7z|exe)$/i.test(hint.filename))
  );
}

export async function parseRawMailboxMessage(
  uid: number,
  source: Buffer,
  options: { envelopeMessageId?: string | null; fallbackMessageId: string }
): Promise<MailboxMessage> {
  const parsed = await simpleParser(source);
  const messageId =
    normalizeMessageId(parsed.messageId) ||
    normalizeMessageId(options.envelopeMessageId) ||
    options.fallbackMessageId;

  return {
    uid,
    messageId,
    subject: parsed.subject || '',
    from: getAddressText(parsed.from),
    to: getAddressText(parsed.to),
    date: parsed.date?.toISOString(),
    bodyText: parsed.text || '',
    inReplyTo: normalizeMessageId(parsed.inReplyTo),
    references: normalizeHeaderValue(parsed.references).map(normalizeMessageId).filter(Boolean),
    attachments: parsed.attachments.map((attachment: ParsedAttachmentLike, index: number) => ({
      filename: attachment.filename || `attachment-${uid}-${index + 1}`,
      mimeType: attachment.contentType || 'application/octet-stream',
      content: attachment.content,
    })),
  };
}

export function sha256Hex(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Storage-safe file/path segment. */
export function sanitizePathSegment(value: string, fallback = 'file'): string {
  const cleaned = String(value || '').replace(/[^a-zA-Z0-9.\-_]/g, '_').replace(/_+/g, '_').slice(0, 120);
  return cleaned || fallback;
}
