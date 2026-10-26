import { supabaseAdminClient } from '../config/database';
import { createLogger } from '../utils/errorHandling';

const logger = createLogger('EmailReplyAuditService');

export const HOSTINGER_PROVIDER = 'hostinger-imap';
export const HOSTINGER_MAILBOX = 'INBOX';

// The run ledger tables keep their original Hostinger names; rows are keyed by provider + mailbox,
// so every IMAP mailbox poller (Hostinger, info@ intake, ...) shares them.
const POLLING_RUNS_TABLE = 'hostinger_polling_runs';
const POLLING_RUN_ITEMS_TABLE = 'hostinger_polling_run_items';

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
  uidValidity: string | null;
  lockOwner: string | null;
  lockExpiresAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PollingRunItemCreateArgs {
  runId: string;
  provider?: string;
  mailbox?: string;
  providerMessageId: string | null;
  externalMessageId: string | null;
  messageUid: number | null;
  attachmentCount: number;
  receivedAt: string | null;
}

export interface PollingRunItemCompleteArgs {
  runItemId: string;
  status: 'duplicate' | 'matched' | 'unmatched' | 'ingested' | 'skipped' | 'failed';
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
  provider?: string;
  mailbox?: string;
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
    uidValidity: row.uid_validity === null || row.uid_validity === undefined ? null : String(row.uid_validity),
    lockOwner: row.lock_owner || null,
    lockExpiresAt: row.lock_expires_at || null,
    metadata: (row.metadata as Record<string, unknown>) || {},
    createdAt: row.created_at || null,
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
    // Another poller created the row first; read the winner's row.
    if ((insertError as any).code === '23505') {
      const { data: existing, error: reselectError } = await db
        .from('mailbox_polling_checkpoints')
        .select('*')
        .eq('provider', provider)
        .eq('mailbox', mailbox)
        .single();
      if (reselectError) throw reselectError;
      return mapCheckpointRow(existing);
    }
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

/**
 * Set the checkpoint position explicitly (it may move backwards). Used for the first-run
 * boundary and when the server reports a new UIDVALIDITY (old UIDs no longer mean anything).
 */
export async function setMailboxCheckpointPosition(args: {
  provider: string;
  mailbox: string;
  lastSeenUid: number;
  uidValidity: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const existing = await getMailboxCheckpoint(args.provider, args.mailbox);
  const db = supabaseAdminClient();
  const { error } = await db
    .from('mailbox_polling_checkpoints')
    .update({
      last_seen_uid: Math.max(0, Math.floor(args.lastSeenUid)),
      uid_validity: Number(args.uidValidity),
      metadata: { ...(existing.metadata || {}), ...(args.metadata || {}) },
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);

  if (error) {
    throw error;
  }
}

export async function updateMailboxCheckpointMetadata(
  provider: string,
  mailbox: string,
  patch: Record<string, unknown>
): Promise<void> {
  const existing = await getMailboxCheckpoint(provider, mailbox);
  const db = supabaseAdminClient();
  const { error } = await db
    .from('mailbox_polling_checkpoints')
    .update({
      metadata: { ...(existing.metadata || {}), ...patch },
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);

  if (error) {
    throw error;
  }
}

/**
 * Lease-style lock in mailbox_polling_checkpoints (see migration 045). Returns true when this
 * owner now holds the lock; calling it again with the same owner renews the lease.
 */
export async function tryAcquireMailboxPollLock(args: {
  provider: string;
  mailbox: string;
  owner: string;
  ttlSeconds: number;
}): Promise<boolean> {
  const db = supabaseAdminClient();
  const { data, error } = await db.rpc('try_acquire_mailbox_poll_lock', {
    p_provider: args.provider,
    p_mailbox: args.mailbox,
    p_owner: args.owner,
    p_ttl_seconds: Math.max(30, Math.floor(args.ttlSeconds)),
  });

  if (error) {
    throw new Error(
      `Mailbox poll lock unavailable (${error.message}). Run migrations/045_generic_imap_mailbox_polling.sql in Supabase.`
    );
  }

  return data === true;
}

export async function releaseMailboxPollLock(args: { provider: string; mailbox: string; owner: string }): Promise<void> {
  const db = supabaseAdminClient();
  const { error } = await db.rpc('release_mailbox_poll_lock', {
    p_provider: args.provider,
    p_mailbox: args.mailbox,
    p_owner: args.owner,
  });

  if (error) {
    logger.warn('Failed to release mailbox poll lock', { error, provider: args.provider, mailbox: args.mailbox });
  }
}

export interface MailboxPollingRunRow {
  id: string;
  provider: string;
  mailbox: string;
  trigger: string;
  status: 'running' | 'completed' | 'completed_with_errors' | 'failed';
  worker_instance_id: string | null;
  started_at: string;
  completed_at: string | null;
  last_heartbeat_at: string | null;
  abandoned_at: string | null;
  messages_discovered: number;
  messages_processed: number;
  attachment_upload_success_count: number;
  attachment_upload_error_count: number;
  success_count: number;
  error_count: number;
  error_code: string | null;
  error_message: string | null;
  error_details: Record<string, unknown> | null;
}

const POLLING_RUN_COLUMNS =
  'id, provider, mailbox, trigger, status, worker_instance_id, started_at, completed_at, last_heartbeat_at, abandoned_at, ' +
  'messages_discovered, messages_processed, attachment_upload_success_count, attachment_upload_error_count, ' +
  'success_count, error_count, error_code, error_message, error_details';

export async function createMailboxPollingRun(args: {
  provider: string;
  mailbox: string;
  trigger: 'worker' | 'manual' | 'recovery' | 'backfill';
  workerInstanceId: string;
}): Promise<string | null> {
  try {
    const db = supabaseAdminClient();
    const now = new Date().toISOString();
    const { data, error } = await db
      .from(POLLING_RUNS_TABLE)
      .insert({
        provider: args.provider,
        mailbox: args.mailbox,
        trigger: args.trigger,
        status: 'running',
        worker_instance_id: args.workerInstanceId,
        started_at: now,
        last_heartbeat_at: now,
      })
      .select('id')
      .single();

    if (error) throw error;
    return data?.id || null;
  } catch (err) {
    logger.warn('Failed to create mailbox polling run record', { error: err, provider: args.provider, mailbox: args.mailbox });
    return null;
  }
}

export interface MailboxPollingRunCompletion {
  runId: string | null;
  status: 'completed' | 'completed_with_errors' | 'failed';
  startedAtMs: number;
  unreadCountBefore: number;
  unreadCountAfter: number;
  messagesDiscovered: number;
  messagesProcessed: number;
  messagesMatched: number;
  messagesUnmatched: number;
  attachmentUploadSuccessCount: number;
  attachmentUploadErrorCount: number;
  successCount: number;
  errorCount: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorDetails?: Record<string, unknown> | null;
}

export async function completeMailboxPollingRun(args: MailboxPollingRunCompletion): Promise<void> {
  if (!args.runId) return;

  try {
    const db = supabaseAdminClient();
    const now = new Date().toISOString();
    const { error } = await db
      .from(POLLING_RUNS_TABLE)
      .update({
        status: args.status,
        completed_at: now,
        last_heartbeat_at: now,
        duration_ms: Math.max(0, Date.now() - args.startedAtMs),
        unread_count_before: Math.max(0, args.unreadCountBefore),
        unread_count_after: Math.max(0, args.unreadCountAfter),
        messages_discovered: args.messagesDiscovered,
        messages_processed: args.messagesProcessed,
        messages_matched: args.messagesMatched,
        messages_unmatched: args.messagesUnmatched,
        attachment_upload_success_count: args.attachmentUploadSuccessCount,
        attachment_upload_error_count: args.attachmentUploadErrorCount,
        success_count: args.successCount,
        error_count: args.errorCount,
        error_code: args.errorCode || null,
        error_message: args.errorMessage || null,
        error_details: args.errorDetails || null,
      })
      .eq('id', args.runId);

    if (error) throw error;
  } catch (err) {
    logger.warn('Failed to complete mailbox polling run record', { runId: args.runId, error: err });
  }
}

export async function listRecentMailboxPollingRuns(
  provider: string,
  mailbox: string,
  limit = 10
): Promise<MailboxPollingRunRow[]> {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from(POLLING_RUNS_TABLE)
    .select(POLLING_RUN_COLUMNS)
    .eq('provider', provider)
    .eq('mailbox', mailbox)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as unknown as MailboxPollingRunRow[];
}

export async function getLastSuccessfulMailboxPollingRun(
  provider: string,
  mailbox: string
): Promise<MailboxPollingRunRow | null> {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from(POLLING_RUNS_TABLE)
    .select(POLLING_RUN_COLUMNS)
    .eq('provider', provider)
    .eq('mailbox', mailbox)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as MailboxPollingRunRow) || null;
}

export async function createPollingRunItem(args: PollingRunItemCreateArgs): Promise<string | null> {
  const db = supabaseAdminClient();
  const { data, error } = await db
    .from(POLLING_RUN_ITEMS_TABLE)
    .insert({
      run_id: args.runId,
      provider: args.provider || HOSTINGER_PROVIDER,
      mailbox: args.mailbox || HOSTINGER_MAILBOX,
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
    .from(POLLING_RUN_ITEMS_TABLE)
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
      provider: args.provider || HOSTINGER_PROVIDER,
      mailbox: args.mailbox || HOSTINGER_MAILBOX,
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
    .from(POLLING_RUNS_TABLE)
    .update({
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .eq('status', 'running');

  if (error) {
    logger.warn('Failed to heartbeat mailbox polling run', { error, runId });
  }
}

/**
 * Marks 'running' runs whose heartbeat is older than staleAfterMs as failed/abandoned.
 * Pass staleAfterMs = 0 while holding the mailbox lock: any other 'running' row is then dead.
 */
export async function markAbandonedPollingRuns(
  staleAfterMs: number,
  options: { provider?: string; mailbox?: string; excludeRunId?: string | null } = {}
): Promise<number> {
  const provider = options.provider || HOSTINGER_PROVIDER;
  const db = supabaseAdminClient();
  const cutoffMs = Date.now() - staleAfterMs;
  let query = db
    .from(POLLING_RUNS_TABLE)
    .select('id, started_at, last_heartbeat_at, worker_instance_id')
    .eq('provider', provider)
    .eq('status', 'running');
  if (options.mailbox) {
    query = query.eq('mailbox', options.mailbox);
  }
  const { data, error } = await query;

  if (error) {
    logger.warn('Failed to load running mailbox polling runs for watchdog', { error, provider });
    return 0;
  }

  const staleRunIds = (data || [])
    .filter((row: any) => {
      if (options.excludeRunId && String(row.id) === options.excludeRunId) return false;
      if (staleAfterMs <= 0) return true;
      const heartbeat = row.last_heartbeat_at || row.started_at;
      return !!heartbeat && new Date(heartbeat).getTime() < cutoffMs;
    })
    .map((row: any) => String(row.id));

  if (staleRunIds.length === 0) {
    return 0;
  }

  for (const runId of staleRunIds) {
    const { error: updateError } = await db
      .from(POLLING_RUNS_TABLE)
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
      logger.warn('Failed to mark mailbox polling run abandoned', { error: updateError, runId });
    }
  }

  return staleRunIds.length;
}

export async function getWatchdogSummary(staleAfterMs: number, provider = HOSTINGER_PROVIDER): Promise<{
  staleRunCount: number;
  runningRunCount: number;
  lastAbandonedRunAt: string | null;
}> {
  const db = supabaseAdminClient();
  const cutoffIso = new Date(Date.now() - staleAfterMs).toISOString();

  const [{ data: runningRows }, { data: abandonedRow }] = await Promise.all([
    db
      .from(POLLING_RUNS_TABLE)
      .select('id, started_at, last_heartbeat_at')
      .eq('provider', provider)
      .eq('status', 'running'),
    db
      .from(POLLING_RUNS_TABLE)
      .select('abandoned_at')
      .eq('provider', provider)
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