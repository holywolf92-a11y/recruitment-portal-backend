import { supabaseAdminClient } from '../config/database';
import { createInboxMessage } from '../services/inboxService';
import { createAttachment, enqueueCvParsingJobForAttachment } from '../services/inboxAttachmentService';
import {
  HOSTINGER_MAILBOX,
  HOSTINGER_PROVIDER,
  createEmailReplyEvent,
} from '../services/emailReplyAuditService';
import { getHostingerImapConnection, isHostingerImapConfigured } from '../services/hostingerMailboxService';
import { isAcceptedCvMime } from '../services/gmailService';
import { processMissingDataEmailReply } from '../services/missingDataEmailReplyService';
import { maybeSendMissingDataEmail } from '../services/missingDataEmailService';
import { uploadCandidateDocument } from '../services/candidateDocumentService';
import { createLogger } from '../utils/errorHandling';
import {
  getLocalMailboxState,
  isMailboxPollerActive,
  MailboxDefinition,
  MessageContext,
  MessageOutcome,
  pollMailbox,
  startMailboxPoller,
} from './mailboxPollingEngine';
import { getMailboxPollingDeps } from './mailboxPollingDeps';

const logger = createLogger('HostingerPollingWorker');

const HEARTBEAT_INTERVAL_MS = Math.max(5000, parseInt(process.env.HOSTINGER_POLL_HEARTBEAT_INTERVAL_MS || '15000', 10));
const RUN_STALE_AFTER_MS = Math.max(60000, parseInt(process.env.HOSTINGER_POLL_STALE_AFTER_MS || '900000', 10));
const POLL_BATCH_SIZE = Math.max(1, parseInt(process.env.HOSTINGER_POLL_BATCH_SIZE || '20', 10));

export const HOSTINGER_MAILBOX_ID = 'hostinger';

interface HostingerPollingState {
  isRunning: boolean;
  lastPollStartedAt: string | null;
  lastPollCompletedAt: string | null;
  lastHeartbeatAt: string | null;
  lastResult: { successCount: number; errorCount: number } | null;
  lastError: string | null;
  lastMatchedReply: {
    candidateId: string;
    messageId: string;
    subject: string;
    from: string;
    matchedBy: string;
    receivedAt: string;
  } | null;
}

let lastMatchedReply: HostingerPollingState['lastMatchedReply'] = null;

export function getHostingerPollingIntervalMinutes(): number {
  const configuredIntervalMinutes = parseInt(process.env.HOSTINGER_POLL_INTERVAL_MINUTES || '5', 10);
  return Number.isFinite(configuredIntervalMinutes) && configuredIntervalMinutes > 0
    ? configuredIntervalMinutes
    : 5;
}

export function isHostingerPollingEnabled(): boolean {
  const configuredValue = String(process.env.RUN_HOSTINGER_POLLING || '').trim().toLowerCase();

  if (configuredValue === 'true') {
    return true;
  }

  if (configuredValue === 'false') {
    return false;
  }

  const isProductionRuntime = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
  return isProductionRuntime && isHostingerImapConfigured();
}

export function isHostingerPollingSchedulerActive(): boolean {
  return isMailboxPollerActive(HOSTINGER_MAILBOX_ID);
}

export async function getPersistentHostingerPollingState(): Promise<HostingerPollingState> {
  const db = supabaseAdminClient();
  const { data } = await db
    .from('hostinger_polling_runs')
    .select('id, status, started_at, completed_at, last_heartbeat_at, success_count, error_count, error_message')
    .eq('provider', HOSTINGER_PROVIDER)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    isRunning: !!data && data.status === 'running',
    lastPollStartedAt: data?.started_at || null,
    lastPollCompletedAt: data?.completed_at || null,
    lastHeartbeatAt: data?.last_heartbeat_at || null,
    lastResult: data
      ? {
          successCount: Number(data.success_count || 0),
          errorCount: Number(data.error_count || 0),
        }
      : null,
    lastError: data?.error_message || null,
    lastMatchedReply: null,
  };
}

export function getHostingerPollingState(): HostingerPollingState {
  const local = getLocalMailboxState(HOSTINGER_MAILBOX_ID);
  return {
    isRunning: local.running,
    lastPollStartedAt: local.lastStartedAt,
    lastPollCompletedAt: local.lastFinishedAt,
    lastHeartbeatAt: local.lastHeartbeatAt,
    lastResult: local.lastResult
      ? { successCount: local.lastResult.successCount, errorCount: local.lastResult.errorCount }
      : null,
    lastError: local.lastError,
    lastMatchedReply: lastMatchedReply ? { ...lastMatchedReply } : null,
  };
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/) || raw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return (match?.[1] || match?.[0] || '').trim().toLowerCase();
}

function extractTrackingToken(subject: string, bodyText: string): string | null {
  const tokenMatch = `${subject}\n${bodyText}`.match(/\[#([A-Z]{2}\d{6})\]/i);
  return tokenMatch ? tokenMatch[1].toUpperCase() : null;
}

async function resolveCandidateMatch(args: {
  subject: string;
  bodyText: string;
  from: string;
  inReplyTo?: string;
  references: string[];
  trackingToken: string | null;
}): Promise<{ candidateId: string; matchedBy: 'tracking_token' | 'reply_header' | 'sender_email' } | null> {
  const db = supabaseAdminClient();

  if (args.trackingToken) {
    const { data } = await db
      .from('candidates')
      .select('id')
      .ilike('email_tracking_token', args.trackingToken)
      .maybeSingle();

    if (data?.id) {
      return { candidateId: data.id, matchedBy: 'tracking_token' };
    }
  }

  const referenceIds = [args.inReplyTo, ...args.references]
    .map((value) => String(value || '').trim().replace(/^<|>$/g, ''))
    .filter(Boolean);

  for (const referenceId of referenceIds) {
    const { data: outboundMatch } = await db
      .from('inbox_messages')
      .select('payload')
      .eq('source', 'email_outbound')
      .eq('payload->>providerMessageId', referenceId)
      .limit(1)
      .maybeSingle();

    const candidateId = (outboundMatch as any)?.payload?.candidateId;
    if (typeof candidateId === 'string' && candidateId) {
      return { candidateId, matchedBy: 'reply_header' };
    }
  }

  const fromEmail = extractEmail(args.from);
  if (fromEmail) {
    const { data } = await db
      .from('candidates')
      .select('id')
      .ilike('email', fromEmail)
      .neq('status', 'Deleted')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.id) {
      return { candidateId: data.id, matchedBy: 'sender_email' };
    }
  }

  return null;
}

/** Hostinger kept its own Message-ID fallback; keep it so existing external ids still dedupe. */
function hostingerMessageId(ctx: MessageContext, parsedMessageId: string): string {
  return parsedMessageId === `uid-${ctx.uidValidity}-${ctx.summary.uid}` ? `hostinger-uid-${ctx.summary.uid}` : parsedMessageId;
}

/**
 * Reply matching for the Hostinger support mailbox: match to a candidate (tracking token, reply
 * headers, sender) and attach documents, or route unmatched CVs into the CV pipeline. Marks
 * each handled message \Seen, as before.
 */
async function handleHostingerMessage(ctx: MessageContext): Promise<MessageOutcome> {
  const message = await ctx.loadFullMessage();
  const messageId = hostingerMessageId(ctx, message.messageId);
  const externalId = `hostinger_${messageId}`;
  const trackingToken = extractTrackingToken(message.subject, message.bodyText);
  const receivedAt = message.date || new Date().toISOString();
  const fromEmail = extractEmail(message.from);
  const toEmail = extractEmail(message.to);
  const runId = ctx.runId;
  const runItemId = ctx.runItemId;
  const markSeen = () =>
    ctx.markSeen().catch((err) => {
      logger.warn('Failed to mark Hostinger message as seen', { uid: message.uid, error: err });
    });

  const inboxMessage = await createInboxMessage({
    source: HOSTINGER_PROVIDER,
    externalMessageId: externalId,
    payload: {
      provider: HOSTINGER_PROVIDER,
      mailbox: HOSTINGER_MAILBOX,
      from: message.from,
      to: message.to,
      subject: message.subject,
      bodyText: message.bodyText,
      messageId,
      inReplyTo: message.inReplyTo || null,
      references: message.references,
      uid: message.uid,
    },
    status: 'pending',
    receivedAt,
  }).catch((err) => {
    if (String(err.message).includes('already exists')) {
      logger.debug('Hostinger mailbox message already recorded, skipping duplicate event creation', {
        messageId,
        uid: message.uid,
      });
      return null;
    }
    throw err;
  });

  if (!inboxMessage) {
    await markSeen();
    return { status: 'duplicate' };
  }

  const candidateMatch = await resolveCandidateMatch({
    subject: message.subject,
    bodyText: message.bodyText,
    from: message.from,
    inReplyTo: message.inReplyTo,
    references: message.references,
    trackingToken,
  });

  if (!candidateMatch) {
    const acceptedAttachments = message.attachments.filter((attachment) => isAcceptedCvMime(attachment.mimeType, attachment.filename));

    if (acceptedAttachments.length > 0) {
      let queuedAttachmentCount = 0;
      let intakeErrorCount = 0;

      for (let index = 0; index < acceptedAttachments.length; index++) {
        const attachment = acceptedAttachments[index];
        try {
          const storagePath = `hostinger/${messageId}/${message.uid}_${index}_${attachment.filename}`;
          const createdAttachment = await createAttachment({
            inboxMessageId: inboxMessage.id,
            fileBuffer: attachment.content,
            fileName: attachment.filename,
            mimeType: attachment.mimeType,
            attachmentType: 'cv',
            storageBucket: 'documents',
            storagePath,
            candidateId: undefined,
            messageSubject: message.subject,
            messageSource: 'email',
          }).catch((err) => {
            if (String(err.message).includes('Duplicate')) {
              logger.debug('Hostinger intake attachment already exists, skipping duplicate', {
                filename: attachment.filename,
                messageId,
              });
              return null;
            }
            throw err;
          });

          if (createdAttachment?.id) {
            await enqueueCvParsingJobForAttachment(createdAttachment.id, {
              force: false,
              expiresInSeconds: 3600,
            });
            queuedAttachmentCount++;
          }
        } catch (err) {
          logger.error('Failed to enqueue Hostinger intake attachment', err, {
            filename: attachment.filename,
            messageId,
            uid: message.uid,
          });
          intakeErrorCount++;
        }
      }

      await supabaseAdminClient()
        .from('inbox_messages')
        .update({
          status: 'processed',
          payload: {
            ...(inboxMessage.payload || {}),
            matched: false,
            matchedBy: null,
            candidateId: null,
            attachmentCount: message.attachments.length,
            acceptedAttachmentCount: acceptedAttachments.length,
            queuedCvAttachmentCount: queuedAttachmentCount,
            processedAt: new Date().toISOString(),
            intakeRoutedToCvPipeline: true,
          },
        })
        .eq('id', inboxMessage.id);

      await createEmailReplyEvent({
        providerMessageId: messageId,
        externalMessageId: externalId,
        messageUid: message.uid,
        inboxMessageId: inboxMessage.id,
        runId,
        runItemId,
        matchStatus: 'unmatched',
        trackingToken,
        fromEmail,
        fromDisplay: message.from,
        toEmail,
        subject: message.subject,
        bodyText: message.bodyText,
        attachmentCount: message.attachments.length,
        attachmentUploadSuccessCount: queuedAttachmentCount,
        attachmentUploadErrorCount: intakeErrorCount,
        receivedAt,
        inReplyTo: message.inReplyTo,
        referenceIds: message.references,
        correlationIds: {
          matched: false,
          matchedBy: null,
          intakeRoutedToCvPipeline: true,
          queuedCvAttachmentCount: queuedAttachmentCount,
        },
      });

      await markSeen();
      return {
        status: 'unmatched',
        inboxMessageId: inboxMessage.id,
        attachmentUploadSuccessCount: queuedAttachmentCount,
        attachmentUploadErrorCount: intakeErrorCount,
      };
    }

    logger.warn('Hostinger mailbox reply could not be matched to candidate', {
      subject: message.subject,
      from: message.from,
      messageId,
      uid: message.uid,
    });

    await supabaseAdminClient()
      .from('inbox_messages')
      .update({
        status: 'failed',
        payload: {
          ...(inboxMessage.payload || {}),
          matched: false,
          matchedBy: null,
          candidateId: null,
          attachmentCount: message.attachments.length,
          processedAt: new Date().toISOString(),
        },
      })
      .eq('id', inboxMessage.id);

    await createEmailReplyEvent({
      providerMessageId: messageId,
      externalMessageId: externalId,
      messageUid: message.uid,
      inboxMessageId: inboxMessage.id,
      runId,
      runItemId,
      matchStatus: 'unmatched',
      trackingToken,
      fromEmail,
      fromDisplay: message.from,
      toEmail,
      subject: message.subject,
      bodyText: message.bodyText,
      attachmentCount: message.attachments.length,
      receivedAt,
      inReplyTo: message.inReplyTo,
      referenceIds: message.references,
      correlationIds: {
        matched: false,
        matchedBy: null,
      },
    });

    await markSeen();
    return { status: 'unmatched', inboxMessageId: inboxMessage.id };
  }

  const { candidateId, matchedBy } = candidateMatch;

  let messageAttachmentSuccessCount = 0;
  let messageAttachmentErrorCount = 0;

  for (const attachment of message.attachments) {
    try {
      await uploadCandidateDocument({
        candidate_id: candidateId,
        file_name: attachment.filename,
        mime_type: attachment.mimeType,
        buffer: attachment.content,
        source: 'email',
      });
      messageAttachmentSuccessCount++;
    } catch (err) {
      logger.error('Failed to upload Hostinger reply attachment', err, {
        candidateId,
        filename: attachment.filename,
      });
      messageAttachmentErrorCount++;
    }
  }

  if (message.bodyText.trim()) {
    await processMissingDataEmailReply({
      candidateId,
      emailBodyText: message.bodyText,
      hadAttachments: message.attachments.length > 0,
    });
  }

  await maybeSendMissingDataEmail({
    candidateId,
    trigger: 'hostinger_reply_ingested',
  });

  await supabaseAdminClient()
    .from('inbox_messages')
    .update({
      status: 'processed',
      payload: {
        ...(inboxMessage.payload || {}),
        matched: true,
        matchedBy,
        candidateId,
        attachmentCount: message.attachments.length,
        processedAt: new Date().toISOString(),
      },
    })
    .eq('id', inboxMessage.id);

  await createEmailReplyEvent({
    providerMessageId: messageId,
    externalMessageId: externalId,
    messageUid: message.uid,
    inboxMessageId: inboxMessage.id,
    runId,
    runItemId,
    candidateId,
    matchStatus: 'matched',
    matchedBy,
    trackingToken,
    fromEmail,
    fromDisplay: message.from,
    toEmail,
    subject: message.subject,
    bodyText: message.bodyText,
    attachmentCount: message.attachments.length,
    attachmentUploadSuccessCount: messageAttachmentSuccessCount,
    attachmentUploadErrorCount: messageAttachmentErrorCount,
    receivedAt,
    inReplyTo: message.inReplyTo,
    referenceIds: message.references,
    correlationIds: {
      candidateId,
      matchedBy,
      inboxMessageId: inboxMessage.id,
    },
  });

  lastMatchedReply = {
    candidateId,
    messageId,
    subject: message.subject,
    from: message.from,
    matchedBy,
    receivedAt,
  };

  await markSeen();
  return {
    status: 'matched',
    inboxMessageId: inboxMessage.id,
    candidateId,
    matchedBy,
    attachmentUploadSuccessCount: messageAttachmentSuccessCount,
    attachmentUploadErrorCount: messageAttachmentErrorCount,
  };
}

async function recordHostingerMessageFailure(ctx: MessageContext, err: unknown): Promise<void> {
  const message = await ctx.loadFullMessage().catch(() => null);
  const subject = message?.subject ?? ctx.summary.subject;
  const bodyText = message?.bodyText ?? '';
  const messageId = hostingerMessageId(ctx, message?.messageId ?? ctx.summary.messageId);

  await createEmailReplyEvent({
    providerMessageId: messageId,
    externalMessageId: `hostinger_${messageId}`,
    messageUid: ctx.summary.uid,
    runId: ctx.runId,
    runItemId: ctx.runItemId,
    matchStatus: 'failed',
    trackingToken: extractTrackingToken(subject, bodyText),
    fromEmail: extractEmail(message?.from ?? ctx.summary.from),
    fromDisplay: message?.from ?? ctx.summary.from,
    toEmail: extractEmail(message?.to ?? ctx.summary.to),
    subject,
    bodyText,
    attachmentCount: message?.attachments.length ?? ctx.summary.attachments.length,
    receivedAt: message?.date || ctx.summary.receivedAt,
    inReplyTo: message?.inReplyTo,
    referenceIds: message?.references ?? [],
    errorCode: 'HOSTINGER_MESSAGE_PROCESS_FAILED',
    errorMessage: err instanceof Error ? err.message : String(err),
    errorDetails: err instanceof Error ? { name: err.name, stack: err.stack || null } : { value: String(err) },
  });
}

export function getHostingerMailboxDefinition(intervalMinutes = getHostingerPollingIntervalMinutes()): MailboxDefinition {
  return {
    id: HOSTINGER_MAILBOX_ID,
    provider: HOSTINGER_PROVIDER,
    mailbox: HOSTINGER_MAILBOX,
    label: `Hostinger replies${getHostingerImapConnection().user ? ` (${getHostingerImapConnection().user})` : ''}`,
    folder: HOSTINGER_MAILBOX,
    readOnly: false,
    batchSize: POLL_BATCH_SIZE,
    intervalMinutes,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    staleAfterMs: RUN_STALE_AFTER_MS,
    startDate: null,
    initialPosition: 'oldest',
    alert: { email: null, failureThreshold: 3, staleAfterHours: 26 },
    isConfigured: isHostingerImapConfigured,
    getConnection: getHostingerImapConnection,
    wantsMessage: () => true,
    handleMessage: handleHostingerMessage,
    onMessageFailed: recordHostingerMessageFailure,
  };
}

export async function triggerHostingerManualPoll(): Promise<{ successCount: number; errorCount: number }> {
  if (!isHostingerImapConfigured()) {
    logger.warn('Hostinger IMAP credentials missing; mailbox poll skipped');
    return { successCount: 0, errorCount: 0 };
  }
  const result = await pollMailbox(getHostingerMailboxDefinition(), 'manual', getMailboxPollingDeps());
  return { successCount: result.successCount, errorCount: result.errorCount };
}

export async function ensureHostingerPollingStarted(intervalMinutes = getHostingerPollingIntervalMinutes()): Promise<boolean> {
  if (!isHostingerPollingEnabled()) {
    logger.info('Hostinger mailbox polling worker disabled by configuration');
    return false;
  }

  if (!isHostingerImapConfigured()) {
    logger.warn('Hostinger IMAP credentials missing; automatic mailbox polling not started');
    return false;
  }

  logger.info('Starting Hostinger mailbox polling worker', { intervalMinutes });
  return startMailboxPoller(getHostingerMailboxDefinition(intervalMinutes), getMailboxPollingDeps());
}

export async function startHostingerPolling(intervalMinutes = getHostingerPollingIntervalMinutes()) {
  await ensureHostingerPollingStarted(intervalMinutes);
}
