/**
 * Message handler for CV intake mailboxes (info@ and friends).
 *
 * Each PDF/DOC/DOCX attachment goes through the same path as the other sources:
 * createInboxMessage → createAttachment → enqueueCvParsingJobForAttachment. The existing
 * classification decides what is a CV; enqueue skips the rest.
 *
 * Idempotent on retry: the inbox message is keyed by Message-ID (external_message_id). A message
 * left 'pending' by a failed attempt is resumed, and attachments stored by that attempt are found
 * by sha256 and re-enqueued instead of duplicated.
 */

import type { MessageContext, MessageOutcome } from '../workers/mailboxPollingEngine';
import { isIntakeCvAttachment, sanitizePathSegment, sha256Hex } from './imapMailboxService';

const MAX_BODY_TEXT_CHARS = 20000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IntakeInboxMessageRow {
  id: string;
  status: string | null;
  payload: Record<string, unknown> | null;
}

export interface CvIntakeDeps {
  findInboxMessageByExternalId(externalMessageId: string): Promise<IntakeInboxMessageRow | null>;
  createInboxMessage(input: {
    source: string;
    externalMessageId: string;
    payload: Record<string, unknown>;
    status: 'pending';
    receivedAt: string;
  }): Promise<{ id: string; payload?: Record<string, unknown> | null }>;
  updateInboxMessage(id: string, update: { status: string; payload: Record<string, unknown> }): Promise<void>;
  createAttachment(input: {
    inboxMessageId: string;
    fileBuffer: Buffer;
    fileName: string;
    mimeType: string;
    attachmentType: 'cv';
    storageBucket: string;
    storagePath: string;
    messageSubject: string;
    messageSource: string;
  }): Promise<{ id: string } | null>;
  findCvAttachmentBySha256(sha256: string): Promise<{ id: string; inbox_message_id: string | null } | null>;
  enqueueCvParsingJob(attachmentId: string): Promise<{ status: string }>;
  isDuplicateError(err: unknown): boolean;
}

export interface CvIntakeHandlerOptions {
  /** inbox_messages.source; 'email' shows as "Email" in the CV Inbox. */
  inboxSource: string;
  provider: string;
  mailbox: string;
  account: string;
  deps: CvIntakeDeps;
}

export function buildIntakeExternalMessageId(account: string, messageId: string): string {
  const raw = `imap:${account}:${messageId}`;
  // external_message_id is VARCHAR(255).
  return raw.length <= 255 ? raw : `imap:${account}:sha256:${sha256Hex(messageId)}`;
}

function assertPersisted(id: string | null | undefined, what: string): string {
  // inboxService falls back to an in-memory record on DB errors; that must not count as stored.
  if (!id || !UUID_PATTERN.test(id)) {
    throw new Error(`${what} was not persisted to the database (got id "${id || ''}")`);
  }
  return id;
}

export function createCvIntakeMessageHandler(options: CvIntakeHandlerOptions) {
  const { deps } = options;

  return async function handleCvIntakeMessage(ctx: MessageContext): Promise<MessageOutcome> {
    const { summary } = ctx;
    const externalMessageId = buildIntakeExternalMessageId(options.account, summary.messageId);

    let inboxMessage = await deps.findInboxMessageByExternalId(externalMessageId);
    if (inboxMessage && inboxMessage.status === 'processed') {
      return { status: 'duplicate', inboxMessageId: inboxMessage.id };
    }

    const message = await ctx.loadFullMessage();
    const accepted = message.attachments.filter(
      (attachment) => isIntakeCvAttachment(attachment.mimeType, attachment.filename) && attachment.content?.length > 0
    );
    const receivedAt = summary.receivedAt || message.date || new Date().toISOString();

    if (accepted.length === 0) {
      if (inboxMessage) {
        await deps.updateInboxMessage(inboxMessage.id, {
          status: 'processed',
          payload: { ...(inboxMessage.payload || {}), acceptedAttachmentCount: 0, processedAt: new Date().toISOString() },
        });
      }
      return { status: 'skipped', inboxMessageId: inboxMessage?.id || null };
    }

    if (!inboxMessage) {
      const payload = {
        provider: options.provider,
        mailbox: options.mailbox,
        account: options.account,
        from: message.from || summary.from,
        to: message.to || summary.to,
        subject: message.subject || summary.subject,
        bodyText: message.bodyText.slice(0, MAX_BODY_TEXT_CHARS),
        messageId: summary.messageId,
        inReplyTo: message.inReplyTo || null,
        references: message.references,
        uid: summary.uid,
        uidValidity: ctx.uidValidity,
        internalDate: summary.receivedAt,
        attachmentCount: message.attachments.length,
        acceptedAttachmentCount: accepted.length,
      };
      try {
        const created = await deps.createInboxMessage({
          source: options.inboxSource,
          externalMessageId,
          payload,
          status: 'pending',
          receivedAt,
        });
        inboxMessage = { id: created.id, status: 'pending', payload: created.payload || payload };
      } catch (err) {
        if (!deps.isDuplicateError(err)) throw err;
        inboxMessage = await deps.findInboxMessageByExternalId(externalMessageId);
        if (!inboxMessage) throw err;
        if (inboxMessage.status === 'processed') {
          return { status: 'duplicate', inboxMessageId: inboxMessage.id };
        }
      }
    }

    const inboxMessageId = assertPersisted(inboxMessage.id, 'Inbox message');
    const storageFolder = `email/imap/${sanitizePathSegment(options.account)}/${ctx.uidValidity}-${summary.uid}`;
    const results: Array<{ fileName: string; attachmentId: string | null; result: string }> = [];
    let storedCount = 0;

    for (let index = 0; index < accepted.length; index++) {
      const attachment = accepted[index];
      let attachmentId: string | null = null;

      try {
        const created = await deps.createAttachment({
          inboxMessageId,
          fileBuffer: attachment.content,
          fileName: attachment.filename,
          mimeType: attachment.mimeType,
          attachmentType: 'cv',
          storageBucket: 'documents',
          storagePath: `${storageFolder}/${index}_${sanitizePathSegment(attachment.filename)}`,
          messageSubject: message.subject || summary.subject,
          messageSource: 'email',
        });
        attachmentId = assertPersisted(created?.id, `Attachment ${attachment.filename}`);
      } catch (err) {
        if (!deps.isDuplicateError(err)) throw err;
        const prior = await deps.findCvAttachmentBySha256(sha256Hex(attachment.content));
        if (!prior || prior.inbox_message_id !== inboxMessageId) {
          // Same file already arrived through another email or channel.
          results.push({ fileName: attachment.filename, attachmentId: prior?.id || null, result: 'duplicate_file' });
          continue;
        }
        // Stored by an earlier, interrupted attempt at this same email: make sure it is queued.
        attachmentId = prior.id;
      }

      const enqueue = await deps.enqueueCvParsingJob(attachmentId);
      storedCount++;
      results.push({ fileName: attachment.filename, attachmentId, result: enqueue.status });
    }

    await deps.updateInboxMessage(inboxMessageId, {
      status: 'processed',
      payload: {
        ...(inboxMessage.payload || {}),
        acceptedAttachmentCount: accepted.length,
        storedCvAttachmentCount: storedCount,
        intakeAttachments: results,
        intakeRoutedToCvPipeline: true,
        processedAt: new Date().toISOString(),
      },
    });

    return {
      status: storedCount > 0 ? 'ingested' : 'duplicate',
      inboxMessageId,
      attachmentUploadSuccessCount: storedCount,
      attachmentUploadErrorCount: 0,
    };
  };
}
