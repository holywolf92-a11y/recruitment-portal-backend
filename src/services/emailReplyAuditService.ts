import { supabaseAdminClient } from '../config/database';
import { createLogger } from '../utils/errorHandling';

const logger = createLogger('EmailReplyAuditService');

export const HOSTINGER_PROVIDER = 'hostinger-imap';
export const HOSTINGER_MAILBOX = 'INBOX';

export interface MailboxCheckpoint {
  id: string;
  provider: string;
  mailbox: string;
  lastSeenUid: number;
  lastSeenMessageId: string | null;
  lastSeenReceivedAt: string | null;
  lastPollRunId: string | null;
  lastPollStartedAt: string | null;
  lastPollCompletedAt: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
}

export interface PollingRunItemCreateArgs {
  runId: string;
  providerMessageId: string | null;
  externalMessageId: string | null;
  messageUid: number | null;
  attachmentCount: number;
  receivedAt: string | null;
}

export interface PollingRunItemCompleteArgs {
  runItemId: string;
  status: 'duplicate' | 'matched' | 'unmatched' | 'failed';
  inboxMessageId?: string | null;
  candidateId?: string | null;
  matchedBy?: string | null;
  attachmentUploadSuccessCount?: number;
  attachmentUploadErrorCount?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorDetails?: Record<string, unknown> | null;
}

export interface EmailReplyEventCreateArgs {
  providerMessageId: string | null;
  externalMessageId: string | null;
  messageUid: number | null;
  inboxMessageId?: string | null;
  runId?: string | null;
  runItemId?: string | null;
  candidateId?: string | null;
  matchStatus: 'matched' | 'unmatched' | 'failed';
  matchedBy?: string | null;
  trackingToken?: string | null;
  fromEmail?: string | null;
  fromDisplay?: string | null;
  toEmail?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  attachmentCount?: number;
  attachmentUploadSuccessCount?: number;
  attachmentUploadErrorCount?: number;
  receivedAt?: string | null;
  inReplyTo?: string | null;
  referenceIds?: string[];
  correlationIds?: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorDetails?: Record<string, unknown> | null;
}

function mapCheckpointRow(row: any): MailboxCheckpoint {
  return {
    id: row.id,
    provider: row.provider,
    mailbox: row.mailbox,
    lastSeenUid: Number(row.last_seen_uid || 0),
    lastSeenMessageId: row.last_seen_message_id || null,
    lastSeenReceivedAt: row.last_seen_received_at || null,
    lastPollRunId: row.last_poll_run_id || null,
    lastPollStartedAt: row.last_poll_started_at || null,
    lastPollCompletedAt: row.last_poll_completed_at || null,
    metadata: (row.metadata as Record<string, unknown>) || {},
    updatedAt: row.updated_at || null,
  };
}

export async function getMailboxCheckpoint(
  provider = HOSTINGER_PROVIDER,
  mailbox = HOSTINGER_MAILBOX
): Promise<MailboxCheckpoint> {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('mailbox_polling_checkpoints')
    .select('*')
    .eq('provider', provider)
    .eq('mailbox', mailbox)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return mapCheckpointRow(data);
  }

  const { data: created, error: insertError } = await db
    .from('mailbox_polling_checkpoints')
    .insert({
      provider,
      mailbox,
      last_seen_uid: 0,
      metadata: {},
    })
    .select('*')
    .single();

  if (insertError) {
    throw insertError;
  }

  return mapCheckpointRow(created);
}

export async function updateMailboxCheckpoint(args: {
  provider?: string;
  mailbox?: string;
  lastSeenUid: number;
  lastSeenMessageId?: string | null;
  lastSeenReceivedAt?: string | null;
  lastPollRunId?: string | null;
  lastPollStartedAt?: string | null;
  lastPollCompletedAt?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const provider = args.provider || HOSTINGER_PROVIDER;
  const mailbox = args.mailbox || HOSTINGER_MAILBOX;
  const existing = await getMailboxCheckpoint(provider, mailbox);
  const db = supabaseAdminClient();

  const mergedMetadata = {
    ...(existing.metadata || {}),
    ...(args.metadata || {}),
  };

  const { error } = await db
    .from('mailbox_polling_checkpoints')
    .update({
      last_seen_uid: Math.max(existing.lastSeenUid, Math.floor(args.lastSeenUid)),
      last_seen_message_id: args.lastSeenMessageId || existing.lastSeenMessageId,
      last_seen_received_at: args.lastSeenReceivedAt || existing.lastSeenReceivedAt,
      last_poll_run_id: args.lastPollRunId || existing.lastPollRunId,
      last_poll_started_at: args.lastPollStartedAt || existing.lastPollStartedAt,
      last_poll_completed_at: args.lastPollCompletedAt || existing.lastPollCompletedAt,
      metadata: mergedMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);

  if (error) {
    throw error;
  }
}

export async function createPollingRunItem(args: PollingRunItemCreateArgs): Promise<string | null> {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('hostinger_polling_run_items')
    .insert({
      run_id: args.runId,
      provider: HOSTINGER_PROVIDER,
      mailbox: HOSTINGER_MAILBOX,
      provider_message_id: args.providerMessageId,
      external_message_id: args.externalMessageId,
      message_uid: args.messageUid,
      attachment_count: args.attachmentCount,
      received_at: args.receivedAt,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    logger.warn('Failed to create polling run item', { error, runId: args.runId, messageUid: args.messageUid });
    return null;
  }

  return data?.id || null;
}

export async function completePollingRunItem(args: PollingRunItemCompleteArgs): Promise<void> {
  const db = supabaseAdminClient();
  const { error } = await db
    .from('hostinger_polling_run_items')
    .update({
      status: args.status,
      inbox_message_id: args.inboxMessageId || null,
      candidate_id: args.candidateId || null,
      matched_by: args.matchedBy || null,
      attachment_upload_success_count: args.attachmentUploadSuccessCount || 0,
      attachment_upload_error_count: args.attachmentUploadErrorCount || 0,
      completed_at: new Date().toISOString(),
      error_code: args.errorCode || null,
      error_message: args.errorMessage || null,
      error_details: args.errorDetails || null,
    })
    .eq('id', args.runItemId);

  if (error) {
    logger.warn('Failed to complete polling run item', { error, runItemId: args.runItemId });
  }
}

export async function createEmailReplyEvent(args: EmailReplyEventCreateArgs): Promise<string | null> {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from('email_reply_events')
    .insert({
      provider: HOSTINGER_PROVIDER,
      mailbox: HOSTINGER_MAILBOX,
      provider_message_id: args.providerMessageId,
      external_message_id: args.externalMessageId,
      message_uid: args.messageUid,
      inbox_message_id: args.inboxMessageId || null,
      run_id: args.runId || null,
      run_item_id: args.runItemId || null,
      candidate_id: args.candidateId || null,
      match_status: args.matchStatus,
      matched_by: args.matchedBy || null,
      tracking_token: args.trackingToken || null,
      from_email: args.fromEmail || null,
      from_display: args.fromDisplay || null,
      to_email: args.toEmail || null,
      subject: args.subject || null,
      body_text: args.bodyText || null,
      body_preview: String(args.bodyText || '').slice(0, 1000) || null,
      attachment_count: args.attachmentCount || 0,
      attachment_upload_success_count: args.attachmentUploadSuccessCount || 0,
      attachment_upload_error_count: args.attachmentUploadErrorCount || 0,
      received_at: args.receivedAt || null,
      in_reply_to: args.inReplyTo || null,
      reference_ids: args.referenceIds || [],
      correlation_ids: args.correlationIds || {},
      error_code: args.errorCode || null,
      error_message: args.errorMessage || null,
      error_details: args.errorDetails || null,
    })
    .select('id')
    .single();

  if (error) {
    logger.warn('Failed to create email reply event', {
      error,
      providerMessageId: args.providerMessageId,
      messageUid: args.messageUid,
      matchStatus: args.matchStatus,
    });
    return null;
  }

  return data?.id || null;
}

export async function heartbeatPollingRun(runId: string | null): Promise<void> {
  if (!runId) return;
  const db = supabaseAdminClient();
  const { error } = await db
    .from('hostinger_polling_runs')
    .update({
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .eq('status', 'running');

  if (error) {
    logger.warn('Failed to heartbeat Hostinger polling run', { error, runId });
  }
}

export async function markAbandonedPollingRuns(staleAfterMs: number): Promise<number> {
  const db = supabaseAdminClient();
  const cutoffIso = new Date(Date.now() - staleAfterMs).toISOString();
  const { data, error } = await db
    .from('hostinger_polling_runs')
    .select('id, started_at, last_heartbeat_at, worker_instance_id')
    .eq('provider', HOSTINGER_PROVIDER)
    .eq('status', 'running');

  if (error) {
    logger.warn('Failed to load running Hostinger polling runs for watchdog', { error });
    return 0;
  }

  const staleRunIds = (data || [])
    .filter((row: any) => {
      const heartbeat = row.last_heartbeat_at || row.started_at;
      return heartbeat && String(heartbeat) < cutoffIso;
    })
    .map((row: any) => String(row.id));

  if (staleRunIds.length === 0) {
    return 0;
  }

  for (const runId of staleRunIds) {
    const { error: updateError } = await db
      .from('hostinger_polling_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        abandoned_at: new Date().toISOString(),
        error_count: 1,
        error_code: 'ABANDONED_RUN',
        error_message: 'Run marked abandoned by watchdog after missing heartbeat',
        error_details: {
          staleAfterMs,
          watchdogMarkedAt: new Date().toISOString(),
        },
      })
      .eq('id', runId)
      .eq('status', 'running');

    if (updateError) {
      logger.warn('Failed to mark Hostinger polling run abandoned', { error: updateError, runId });
    }
  }

  return staleRunIds.length;
}

export async function getWatchdogSummary(staleAfterMs: number): Promise<{
  staleRunCount: number;
  runningRunCount: number;
  lastAbandonedRunAt: string | null;
}> {
  const db = supabaseAdminClient();
  const cutoffIso = new Date(Date.now() - staleAfterMs).toISOString();

  const [{ data: runningRows }, { data: abandonedRow }] = await Promise.all([
    db
      .from('hostinger_polling_runs')
      .select('id, started_at, last_heartbeat_at')
      .eq('provider', HOSTINGER_PROVIDER)
      .eq('status', 'running'),
    db
      .from('hostinger_polling_runs')
      .select('abandoned_at')
      .eq('provider', HOSTINGER_PROVIDER)
      .not('abandoned_at', 'is', null)
      .order('abandoned_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const staleRunCount = (runningRows || []).filter((row: any) => {
    const heartbeat = row.last_heartbeat_at || row.started_at;
    return heartbeat && String(heartbeat) < cutoffIso;
  }).length;

  return {
    staleRunCount,
    runningRunCount: (runningRows || []).length,
    lastAbandonedRunAt: abandonedRow?.abandoned_at || null,
  };
}