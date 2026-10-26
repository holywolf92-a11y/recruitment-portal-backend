/**
 * Generic IMAP mailbox poller.
 *
 * One engine serves every mailbox (Hostinger replies, info@ CV intake, ...). Each mailbox is a
 * MailboxDefinition with its own provider/mailbox key, so checkpoints, locks and run history
 * never mix. Per run:
 *
 *   1. take the mailbox lease lock in the DB (single runner across instances/replicas);
 *   2. mark any other 'running' run for this mailbox abandoned (the lock proves it is dead);
 *   3. open the folder (read-only for human inboxes), check UIDVALIDITY against the checkpoint;
 *   4. walk every UID above the checkpoint up to the newest mail, batch by batch;
 *   5. advance the checkpoint only after a message is fully handled. After a failure the
 *      checkpoint stays put, so the next run retries that message (handlers dedupe on Message-ID);
 *   6. alert by email after N consecutive failed runs or when no poll has succeeded for too long.
 */

import crypto from 'crypto';
import type { FetchMessageObject, ImapFlow } from 'imapflow';
import { createLogger } from '../utils/errorHandling';
import {
  ImapConnectionConfig,
  MailboxAttachmentHint,
  MailboxMessage,
  getEnvelopeAddressText,
  listAttachmentHints,
  normalizeMessageId,
  parseRawMailboxMessage,
} from '../services/imapMailboxService';
import type {
  MailboxCheckpoint,
  MailboxPollingRunCompletion,
  MailboxPollingRunRow,
  PollingRunItemCompleteArgs,
  PollingRunItemCreateArgs,
} from '../services/emailReplyAuditService';

const logger = createLogger('MailboxPollingEngine');

export type MailboxPollTrigger = 'worker' | 'manual' | 'recovery';

export interface MailboxMessageSummary {
  uid: number;
  messageId: string;
  subject: string;
  from: string;
  to: string;
  receivedAt: string | null;
  size: number;
  attachments: MailboxAttachmentHint[];
}

export interface MessageOutcome {
  status: 'duplicate' | 'matched' | 'unmatched' | 'ingested' | 'skipped';
  inboxMessageId?: string | null;
  candidateId?: string | null;
  matchedBy?: string | null;
  attachmentUploadSuccessCount?: number;
  attachmentUploadErrorCount?: number;
}

export interface MessageContext {
  definition: MailboxDefinition;
  summary: MailboxMessageSummary;
  trigger: MailboxPollTrigger;
  runId: string | null;
  runItemId: string | null;
  uidValidity: string;
  /** Downloads and parses the full message (cached per message). */
  loadFullMessage(): Promise<MailboxMessage>;
  /** Sets \Seen. Throws for read-only mailboxes. */
  markSeen(): Promise<void>;
}

export interface MailboxAlertConfig {
  email: string | null;
  failureThreshold: number;
  staleAfterHours: number;
}

export interface MailboxDefinition {
  /** URL-safe id used by the admin endpoints, e.g. 'info' or 'hostinger'. */
  id: string;
  /** Provider/mailbox key: one checkpoint, lock and run history per pair. */
  provider: string;
  mailbox: string;
  label: string;
  folder: string;
  /** Opens the folder with EXAMINE and never changes flags or moves mail. */
  readOnly: boolean;
  batchSize: number;
  intervalMinutes: number;
  heartbeatIntervalMs: number;
  /** Lock lease and abandoned-run threshold. */
  staleAfterMs: number;
  /** Never import mail received before this date; also the first-run boundary. */
  startDate: Date | null;
  /** Where a brand-new checkpoint starts when there is no startDate. */
  initialPosition: 'oldest' | 'newest';
  alert: MailboxAlertConfig;
  isConfigured(): boolean;
  getConnection(): ImapConnectionConfig;
  /** Cheap pre-filter on envelope + BODYSTRUCTURE. Messages it rejects are skipped without download. */
  wantsMessage(summary: MailboxMessageSummary): boolean;
  handleMessage(ctx: MessageContext): Promise<MessageOutcome>;
  onMessageFailed?(ctx: MessageContext, err: unknown): Promise<void>;
}

export interface MailboxPollingStore {
  tryAcquireLock(args: { provider: string; mailbox: string; owner: string; ttlSeconds: number }): Promise<boolean>;
  releaseLock(args: { provider: string; mailbox: string; owner: string }): Promise<void>;
  getCheckpoint(provider: string, mailbox: string): Promise<MailboxCheckpoint>;
  setCheckpointPosition(args: {
    provider: string;
    mailbox: string;
    lastSeenUid: number;
    uidValidity: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  advanceCheckpoint(args: {
    provider: string;
    mailbox: string;
    lastSeenUid: number;
    lastSeenMessageId?: string | null;
    lastSeenReceivedAt?: string | null;
    lastPollRunId?: string | null;
    lastPollStartedAt?: string | null;
    lastPollCompletedAt?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  updateCheckpointMetadata(provider: string, mailbox: string, patch: Record<string, unknown>): Promise<void>;
  markAbandonedRuns(args: { provider: string; mailbox: string; staleAfterMs: number; excludeRunId?: string | null }): Promise<number>;
  createRun(args: { provider: string; mailbox: string; trigger: MailboxPollTrigger; workerInstanceId: string }): Promise<string | null>;
  heartbeatRun(runId: string): Promise<void>;
  completeRun(args: MailboxPollingRunCompletion): Promise<void>;
  createRunItem(args: PollingRunItemCreateArgs): Promise<string | null>;
  completeRunItem(args: PollingRunItemCompleteArgs): Promise<void>;
  listRecentRuns(provider: string, mailbox: string, limit: number): Promise<MailboxPollingRunRow[]>;
  getLastSuccessfulRun(provider: string, mailbox: string): Promise<MailboxPollingRunRow | null>;
}

export interface MailboxPollingDeps {
  store: MailboxPollingStore;
  createImapClient(cfg: ImapConnectionConfig): ImapFlow;
  sendAlertEmail(args: { to: string; subject: string; html: string; text: string }): Promise<boolean>;
  now(): Date;
  workerInstanceId: string;
}

export interface MailboxPollResult {
  status: 'completed' | 'completed_with_errors' | 'failed' | 'skipped';
  skippedReason?: 'not_configured' | 'already_running' | 'locked';
  runId: string | null;
  messagesDiscovered: number;
  messagesHandled: number;
  messagesSkipped: number;
  messagesFailed: number;
  attachmentUploadSuccessCount: number;
  attachmentUploadErrorCount: number;
  lastSeenUid: number | null;
  successCount: number;
  errorCount: number;
  error?: string;
}

const MAX_CONSECUTIVE_MESSAGE_FAILURES = 3;
const UID_VALIDITY_RESCAN_MARGIN_MS = 2 * 24 * 60 * 60 * 1000;
const ALERT_REMINDER_MS = 24 * 60 * 60 * 1000;
const MAX_TIMER_MS = 20 * 24 * 60 * 60 * 1000;

export function buildWorkerInstanceId(): string {
  return [
    process.env.RAILWAY_REPLICA_ID,
    process.env.HOSTNAME,
    `pid:${process.pid}`,
    `boot:${crypto.randomBytes(4).toString('hex')}`,
  ]
    .filter(Boolean)
    .join('|');
}

class MailboxPollAbort extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'MailboxPollAbort';
  }
}

interface LocalMailboxState {
  running: boolean;
  lastResult: MailboxPollResult | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
}

const localStates = new Map<string, LocalMailboxState>();
const schedulers = new Map<string, { timer: NodeJS.Timeout; watchdog: NodeJS.Timeout; startedAt: Date }>();

function getLocalState(id: string): LocalMailboxState {
  let state = localStates.get(id);
  if (!state) {
    state = { running: false, lastResult: null, lastStartedAt: null, lastFinishedAt: null, lastHeartbeatAt: null, lastError: null };
    localStates.set(id, state);
  }
  return state;
}

export function getLocalMailboxState(id: string): LocalMailboxState {
  return { ...getLocalState(id) };
}

export function isMailboxPollerActive(id: string): boolean {
  return schedulers.has(id);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorDetails(err: unknown): Record<string, unknown> {
  return err instanceof Error ? { name: err.name, stack: err.stack || null } : { value: String(err) };
}

function emptyResult(status: MailboxPollResult['status'], skippedReason?: MailboxPollResult['skippedReason']): MailboxPollResult {
  return {
    status,
    skippedReason,
    runId: null,
    messagesDiscovered: 0,
    messagesHandled: 0,
    messagesSkipped: 0,
    messagesFailed: 0,
    attachmentUploadSuccessCount: 0,
    attachmentUploadErrorCount: 0,
    lastSeenUid: null,
    successCount: 0,
    errorCount: 0,
  };
}

function toSummary(message: FetchMessageObject, uidValidity: string): MailboxMessageSummary {
  const internalDate = message.internalDate ? new Date(message.internalDate) : null;
  return {
    uid: message.uid,
    messageId: normalizeMessageId(message.envelope?.messageId) || `uid-${uidValidity}-${message.uid}`,
    subject: message.envelope?.subject || '',
    from: getEnvelopeAddressText(message.envelope?.from),
    to: getEnvelopeAddressText(message.envelope?.to),
    receivedAt: internalDate && !Number.isNaN(internalDate.getTime()) ? internalDate.toISOString() : null,
    size: Number(message.size || 0),
    attachments: listAttachmentHints(message.bodyStructure),
  };
}

async function readUnseenCount(client: ImapFlow, folder: string): Promise<number> {
  try {
    const status = await client.status(folder, { unseen: true });
    return Number(status?.unseen || 0);
  } catch {
    return 0;
  }
}

/**
 * Decide where this run starts. Persists the decision whenever it differs from the stored
 * checkpoint (first run, legacy checkpoint without UIDVALIDITY, or a UIDVALIDITY change).
 */
async function resolveStartUid(args: {
  def: MailboxDefinition;
  deps: MailboxPollingDeps;
  client: ImapFlow;
  checkpoint: MailboxCheckpoint;
  uidValidity: string;
  uidNext: number;
}): Promise<number> {
  const { def, deps, client, checkpoint, uidValidity, uidNext } = args;
  const nowIso = deps.now().toISOString();

  if (checkpoint.uidValidity === uidValidity) {
    return checkpoint.lastSeenUid;
  }

  if (!checkpoint.uidValidity && checkpoint.lastSeenUid > 0) {
    // Checkpoint written before UIDVALIDITY was tracked (legacy Hostinger): adopt it as-is.
    await deps.store.setCheckpointPosition({
      provider: def.provider,
      mailbox: def.mailbox,
      lastSeenUid: checkpoint.lastSeenUid,
      uidValidity,
      metadata: { uidValidityAdoptedAt: nowIso },
    });
    return checkpoint.lastSeenUid;
  }

  const uidValidityChanged = !!checkpoint.uidValidity && checkpoint.uidValidity !== uidValidity;
  let since: Date | null = def.startDate;
  if (uidValidityChanged && checkpoint.lastSeenReceivedAt) {
    // UIDs were renumbered. Rescan from just before the last message we handled; Message-ID
    // dedupe in the handlers skips anything already imported.
    const rescanFrom = new Date(new Date(checkpoint.lastSeenReceivedAt).getTime() - UID_VALIDITY_RESCAN_MARGIN_MS);
    since = def.startDate && def.startDate > rescanFrom ? def.startDate : rescanFrom;
  }

  let lastSeenUid: number;
  if (since) {
    const found = (await client.search({ since }, { uid: true })) || [];
    const firstUid = found.reduce((min, uid) => (uid < min ? uid : min), Number.POSITIVE_INFINITY);
    lastSeenUid = Number.isFinite(firstUid) ? firstUid - 1 : Math.max(0, uidNext - 1);
  } else {
    lastSeenUid = def.initialPosition === 'newest' ? Math.max(0, uidNext - 1) : 0;
  }

  await deps.store.setCheckpointPosition({
    provider: def.provider,
    mailbox: def.mailbox,
    lastSeenUid,
    uidValidity,
    metadata: uidValidityChanged
      ? { uidValidityChangedAt: nowIso, previousUidValidity: checkpoint.uidValidity, rescanSince: since?.toISOString() || null }
      : { initializedAt: nowIso, initialBoundarySince: since?.toISOString() || null, initialPosition: def.initialPosition },
  });

  logger.info('Mailbox checkpoint (re)initialized', {
    mailbox: def.label,
    reason: uidValidityChanged ? 'uid_validity_changed' : 'first_run',
    lastSeenUid,
    uidValidity,
    since: since?.toISOString() || null,
  });

  return lastSeenUid;
}

/** One poll of one mailbox. Never throws; failures are recorded on the run and returned. */
export async function pollMailbox(
  def: MailboxDefinition,
  trigger: MailboxPollTrigger,
  deps: MailboxPollingDeps
): Promise<MailboxPollResult> {
  if (!def.isConfigured()) {
    return emptyResult('skipped', 'not_configured');
  }

  const local = getLocalState(def.id);
  if (local.running) {
    return emptyResult('skipped', 'already_running');
  }
  local.running = true;

  const owner = deps.workerInstanceId;
  const ttlSeconds = Math.ceil(def.staleAfterMs / 1000);
  const lockKey = { provider: def.provider, mailbox: def.mailbox, owner };

  try {
    let acquired: boolean;
    try {
      acquired = await deps.store.tryAcquireLock({ ...lockKey, ttlSeconds });
    } catch (err) {
      local.lastError = errorMessage(err);
      logger.error('Mailbox poll could not take its lock', err, { mailbox: def.label });
      const result = { ...emptyResult('failed'), errorCount: 1, error: local.lastError };
      local.lastResult = result;
      return result;
    }

    if (!acquired) {
      logger.info('Mailbox poll skipped: another instance holds the lock', { mailbox: def.label, trigger });
      return emptyResult('skipped', 'locked');
    }

    try {
      return await runLockedPoll(def, trigger, deps, local, lockKey, ttlSeconds);
    } finally {
      await deps.store.releaseLock(lockKey).catch((err) => {
        logger.warn('Failed to release mailbox poll lock', { mailbox: def.label, error: err });
      });
    }
  } finally {
    local.running = false;
    await evaluateMailboxAlerts(def, deps).catch((err) => {
      logger.warn('Mailbox alert evaluation failed', { mailbox: def.label, error: err });
    });
  }
}

async function runLockedPoll(
  def: MailboxDefinition,
  trigger: MailboxPollTrigger,
  deps: MailboxPollingDeps,
  local: LocalMailboxState,
  lockKey: { provider: string; mailbox: string; owner: string },
  ttlSeconds: number
): Promise<MailboxPollResult> {
  const startedAtMs = deps.now().getTime();
  const startedAtIso = new Date(startedAtMs).toISOString();
  local.lastStartedAt = startedAtIso;
  local.lastHeartbeatAt = startedAtIso;
  local.lastError = null;

  // We hold the lock, so any other 'running' row for this mailbox belongs to a dead process.
  const recoveredRuns = await deps.store
    .markAbandonedRuns({ provider: def.provider, mailbox: def.mailbox, staleAfterMs: 0 })
    .catch(() => 0);
  if (recoveredRuns > 0) {
    logger.warn('Recovered abandoned mailbox poll runs; resuming from checkpoint', { mailbox: def.label, recoveredRuns });
  }

  const runId = await deps.store.createRun({
    provider: def.provider,
    mailbox: def.mailbox,
    trigger,
    workerInstanceId: deps.workerInstanceId,
  });

  let lockLost = false;
  const heartbeat = setInterval(() => {
    void (async () => {
      local.lastHeartbeatAt = deps.now().toISOString();
      if (runId) await deps.store.heartbeatRun(runId).catch(() => undefined);
      const renewed = await deps.store.tryAcquireLock({ ...lockKey, ttlSeconds }).catch(() => true);
      if (!renewed) lockLost = true;
    })();
  }, def.heartbeatIntervalMs);
  heartbeat.unref?.();

  const result = emptyResult('completed');
  result.runId = runId;
  let unreadCountBefore = 0;
  let unreadCountAfter = 0;
  let messagesMatched = 0;
  let messagesUnmatched = 0;
  const failures: Array<{ uid: number; messageId: string; subject: string; error: string }> = [];
  let fatal: unknown = null;

  const client = deps.createImapClient(def.getConnection());
  client.on('error', (err: Error) => {
    logger.warn('IMAP connection error', { mailbox: def.label, error: err?.message });
  });

  try {
    await client.connect();
    unreadCountBefore = await readUnseenCount(client, def.folder);

    const lock = await client.getMailboxLock(def.folder, { readOnly: def.readOnly });
    try {
      const mailboxInfo = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox : null;
      if (!mailboxInfo) throw new Error(`IMAP folder ${def.folder} did not open`);
      const uidValidity = String(mailboxInfo.uidValidity);
      const uidNextAtStart = Number(mailboxInfo.uidNext || 0);

      const checkpoint = await deps.store.getCheckpoint(def.provider, def.mailbox);
      let lastSeenUid = await resolveStartUid({ def, deps, client, checkpoint, uidValidity, uidNext: uidNextAtStart });
      result.lastSeenUid = lastSeenUid;

      // Everything above the checkpoint that existed when the run started (newer mail waits for the next run).
      let uids: number[] = [];
      if (!(uidNextAtStart > 0 && lastSeenUid + 1 >= uidNextAtStart)) {
        const found = (await client.search({ uid: `${lastSeenUid + 1}:*` }, { uid: true })) || [];
        uids = found
          .filter((uid) => uid > lastSeenUid && (uidNextAtStart <= 0 || uid < uidNextAtStart))
          .sort((a, b) => a - b);
      }
      result.messagesDiscovered = uids.length;

      let checkpointFrozen = false;
      let pendingSkipUid: { uid: number; messageId: string; receivedAt: string | null } | null = null;
      let consecutiveFailures = 0;

      const advance = async (uid: number, messageId: string, receivedAt: string | null) => {
        await deps.store.advanceCheckpoint({
          provider: def.provider,
          mailbox: def.mailbox,
          lastSeenUid: uid,
          lastSeenMessageId: messageId,
          lastSeenReceivedAt: receivedAt,
          lastPollRunId: runId,
          lastPollStartedAt: startedAtIso,
          metadata: { lastTrigger: trigger, lastWorkerInstanceId: deps.workerInstanceId },
        });
        lastSeenUid = Math.max(lastSeenUid, uid);
        result.lastSeenUid = lastSeenUid;
      };

      const flushSkips = async () => {
        if (pendingSkipUid && !checkpointFrozen) {
          const skip = pendingSkipUid;
          pendingSkipUid = null;
          await advance(skip.uid, skip.messageId, skip.receivedAt);
        }
      };

      for (let offset = 0; offset < uids.length; offset += def.batchSize) {
        if (lockLost) throw new MailboxPollAbort('LOCK_LOST', 'Mailbox lock lease was lost; stopping this run');
        const batch = uids.slice(offset, offset + def.batchSize);
        const fetched = await client.fetchAll(
          batch,
          { uid: true, envelope: true, bodyStructure: true, internalDate: true, size: true },
          { uid: true }
        );
        fetched.sort((a, b) => a.uid - b.uid);

        for (const fetchedMessage of fetched) {
          if (lockLost) throw new MailboxPollAbort('LOCK_LOST', 'Mailbox lock lease was lost; stopping this run');
          const summary = toSummary(fetchedMessage, uidValidity);

          const beforeStart =
            !!def.startDate && !!summary.receivedAt && new Date(summary.receivedAt).getTime() < def.startDate.getTime();
          if (beforeStart || !def.wantsMessage(summary)) {
            result.messagesSkipped++;
            if (!checkpointFrozen) {
              pendingSkipUid = { uid: summary.uid, messageId: summary.messageId, receivedAt: summary.receivedAt };
            }
            continue;
          }

          await flushSkips();

          const runItemId = runId
            ? await deps.store.createRunItem({
                runId,
                provider: def.provider,
                mailbox: def.mailbox,
                providerMessageId: summary.messageId,
                externalMessageId: null,
                messageUid: summary.uid,
                attachmentCount: summary.attachments.length,
                receivedAt: summary.receivedAt,
              })
            : null;

          let fullMessage: MailboxMessage | null = null;
          const ctx: MessageContext = {
            definition: def,
            summary,
            trigger,
            runId,
            runItemId,
            uidValidity,
            loadFullMessage: async () => {
              if (fullMessage) return fullMessage;
              const fetchedSource = await client.fetchOne(String(summary.uid), { uid: true, source: true }, { uid: true });
              if (!fetchedSource || !fetchedSource.source) {
                throw new Error(`Message UID ${summary.uid} could not be downloaded`);
              }
              fullMessage = await parseRawMailboxMessage(summary.uid, fetchedSource.source, {
                envelopeMessageId: summary.messageId,
                fallbackMessageId: `uid-${uidValidity}-${summary.uid}`,
              });
              return fullMessage;
            },
            markSeen: async () => {
              if (def.readOnly) {
                throw new Error(`${def.label} is read-only; refusing to change message flags`);
              }
              await client.messageFlagsAdd(String(summary.uid), ['\\Seen'], { uid: true });
            },
          };

          try {
            const outcome = await def.handleMessage(ctx);
            consecutiveFailures = 0;
            result.messagesHandled++;
            result.successCount++;
            result.attachmentUploadSuccessCount += outcome.attachmentUploadSuccessCount || 0;
            result.attachmentUploadErrorCount += outcome.attachmentUploadErrorCount || 0;
            if (outcome.status === 'matched') messagesMatched++;
            if (outcome.status === 'unmatched') messagesUnmatched++;

            if (runItemId) {
              await deps.store.completeRunItem({
                runItemId,
                status: outcome.status,
                inboxMessageId: outcome.inboxMessageId,
                candidateId: outcome.candidateId,
                matchedBy: outcome.matchedBy,
                attachmentUploadSuccessCount: outcome.attachmentUploadSuccessCount,
                attachmentUploadErrorCount: outcome.attachmentUploadErrorCount,
              });
            }

            if (!checkpointFrozen) {
              await advance(summary.uid, summary.messageId, summary.receivedAt);
            }
          } catch (err) {
            consecutiveFailures++;
            checkpointFrozen = true;
            pendingSkipUid = null;
            result.messagesFailed++;
            result.errorCount++;
            failures.push({ uid: summary.uid, messageId: summary.messageId, subject: summary.subject, error: errorMessage(err) });
            local.lastError = errorMessage(err);
            logger.error('Failed to process mailbox message; checkpoint held for retry', err, {
              mailbox: def.label,
              uid: summary.uid,
              messageId: summary.messageId,
            });

            if (runItemId) {
              await deps.store.completeRunItem({
                runItemId,
                status: 'failed',
                errorCode: 'MAILBOX_MESSAGE_PROCESS_FAILED',
                errorMessage: errorMessage(err),
                errorDetails: errorDetails(err),
              });
            }
            await def.onMessageFailed?.(ctx, err).catch(() => undefined);

            if (consecutiveFailures >= MAX_CONSECUTIVE_MESSAGE_FAILURES) {
              throw new MailboxPollAbort(
                'TOO_MANY_MESSAGE_FAILURES',
                `${consecutiveFailures} messages in a row failed; stopping this run (last error: ${errorMessage(err)})`
              );
            }
          }
        }

        await flushSkips();
      }

      await flushSkips();
    } finally {
      lock.release();
    }

    unreadCountAfter = await readUnseenCount(client, def.folder);
  } catch (err) {
    fatal = err;
    local.lastError = errorMessage(err);
    logger.error('Mailbox poll failed', err, { mailbox: def.label, trigger });
  } finally {
    clearInterval(heartbeat);
    await client.logout().catch(() => {
      try {
        client.close();
      } catch {
        // already closed
      }
    });
  }

  result.status = fatal ? 'failed' : failures.length > 0 ? 'completed_with_errors' : 'completed';
  if (fatal) {
    result.errorCount = Math.max(1, result.errorCount);
    result.error = errorMessage(fatal);
  } else if (failures.length > 0) {
    result.error = failures[failures.length - 1].error;
  }

  const completedAtIso = deps.now().toISOString();
  await deps.store
    .advanceCheckpoint({
      provider: def.provider,
      mailbox: def.mailbox,
      lastSeenUid: result.lastSeenUid ?? 0,
      lastPollRunId: runId,
      lastPollStartedAt: startedAtIso,
      lastPollCompletedAt: completedAtIso,
      metadata: {
        lastTrigger: trigger,
        lastRunStatus: result.status,
        lastRecoveredAbandonedRuns: recoveredRuns,
        lastPollMessageCount: result.messagesHandled,
        lastPollErrorCount: result.errorCount,
      },
    })
    .catch((err) => logger.warn('Failed to finalize mailbox checkpoint', { mailbox: def.label, error: err }));

  await deps.store.completeRun({
    runId,
    status: result.status as 'completed' | 'completed_with_errors' | 'failed',
    startedAtMs,
    unreadCountBefore,
    unreadCountAfter,
    messagesDiscovered: result.messagesDiscovered,
    messagesProcessed: result.messagesHandled + result.messagesFailed,
    messagesMatched,
    messagesUnmatched,
    attachmentUploadSuccessCount: result.attachmentUploadSuccessCount,
    attachmentUploadErrorCount: result.attachmentUploadErrorCount,
    successCount: result.successCount,
    errorCount: result.errorCount,
    errorCode: fatal ? (fatal instanceof MailboxPollAbort ? fatal.code : 'MAILBOX_POLL_FAILED') : failures.length ? 'MESSAGE_FAILURES' : null,
    errorMessage: result.error || null,
    errorDetails: fatal || failures.length
      ? { ...(fatal ? errorDetails(fatal) : {}), failedMessages: failures.slice(0, 10), messagesSkipped: result.messagesSkipped }
      : { messagesSkipped: result.messagesSkipped },
  });

  local.lastFinishedAt = completedAtIso;
  local.lastResult = result;
  logger.info('Mailbox poll finished', {
    mailbox: def.label,
    trigger,
    status: result.status,
    discovered: result.messagesDiscovered,
    handled: result.messagesHandled,
    skipped: result.messagesSkipped,
    failed: result.messagesFailed,
    lastSeenUid: result.lastSeenUid,
  });
  return result;
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}

function isFailedRun(run: MailboxPollingRunRow): boolean {
  return run.status === 'failed' || run.status === 'completed_with_errors';
}

/**
 * Sends one alert per incident (with a daily reminder while it lasts) and one "resolved" note.
 * State lives in the checkpoint metadata so restarts and other replicas share it.
 */
export async function evaluateMailboxAlerts(def: MailboxDefinition, deps: MailboxPollingDeps): Promise<void> {
  if (!def.alert.email || !def.isConfigured()) return;

  const now = deps.now();
  const threshold = Math.max(1, def.alert.failureThreshold);
  const staleMs = Math.max(def.alert.staleAfterHours * 3600_000, def.intervalMinutes * 60_000 + 2 * 3600_000);

  const [recentRuns, lastSuccess, checkpoint] = await Promise.all([
    deps.store.listRecentRuns(def.provider, def.mailbox, threshold + 5),
    deps.store.getLastSuccessfulRun(def.provider, def.mailbox),
    deps.store.getCheckpoint(def.provider, def.mailbox),
  ]);

  const finishedRuns = recentRuns.filter((run) => run.status !== 'running');
  let consecutiveFailures = 0;
  for (const run of finishedRuns) {
    if (!isFailedRun(run)) break;
    consecutiveFailures++;
  }

  const schedulerStartedAt = schedulers.get(def.id)?.startedAt || null;
  const referenceIso = lastSuccess?.completed_at || checkpoint.createdAt || schedulerStartedAt?.toISOString() || null;
  const referenceMs = referenceIso ? new Date(referenceIso).getTime() : now.getTime();
  const sinceSuccessMs = now.getTime() - referenceMs;

  const reasons: string[] = [];
  if (consecutiveFailures >= threshold) reasons.push('consecutive_failures');
  if (sinceSuccessMs > staleMs) reasons.push('no_recent_success');

  const alertState = ((checkpoint.metadata || {}).alert || {}) as {
    open?: boolean;
    reasonKey?: string;
    openedAt?: string;
    lastSentAt?: string;
  };

  if (reasons.length === 0) {
    if (alertState.open) {
      const subject = `Resolved: ${def.label} mailbox polling is working again`;
      const text = `${def.label} completed a successful poll at ${lastSuccess?.completed_at || now.toISOString()}. The alert opened at ${alertState.openedAt || 'unknown'} is resolved.`;
      const sent = await deps.sendAlertEmail({ to: def.alert.email, subject, text, html: `<p>${escapeHtml(text)}</p>` });
      await deps.store.updateCheckpointMetadata(def.provider, def.mailbox, {
        alert: { open: false, resolvedAt: now.toISOString(), resolvedNoticeSent: sent, openedAt: alertState.openedAt || null },
      });
    }
    return;
  }

  const reasonKey = reasons.join('+');
  const lastSentMs = alertState.lastSentAt ? new Date(alertState.lastSentAt).getTime() : 0;
  const shouldSend = !alertState.open || alertState.reasonKey !== reasonKey || now.getTime() - lastSentMs >= ALERT_REMINDER_MS;
  if (!shouldSend) return;

  const lastFailed = finishedRuns.find(isFailedRun) || null;
  const failedMessages = Array.isArray((lastFailed?.error_details as any)?.failedMessages)
    ? ((lastFailed?.error_details as any).failedMessages as Array<{ uid: number; subject: string; error: string }>)
    : [];
  const hoursSinceSuccess = Math.round(sinceSuccessMs / 3600_000);

  const lines = [
    `Mailbox: ${def.label} (${def.folder})`,
    reasons.includes('consecutive_failures') ? `Consecutive failed runs: ${consecutiveFailures}` : null,
    reasons.includes('no_recent_success')
      ? `No successful poll for about ${hoursSinceSuccess} hours (last success: ${lastSuccess?.completed_at || 'never'})`
      : null,
    lastFailed ? `Last error (${lastFailed.error_code || 'unknown'}): ${lastFailed.error_message || 'n/a'}` : null,
    ...failedMessages.slice(0, 5).map((m) => `Stuck message UID ${m.uid} "${m.subject}": ${m.error}`),
    `Checkpoint: last imported UID ${checkpoint.lastSeenUid} (UIDVALIDITY ${checkpoint.uidValidity || 'unset'})`,
    `Status: GET /api/mailbox-admin/${def.id}/status  ·  Retry now: POST /api/mailbox-admin/${def.id}/poll`,
  ].filter(Boolean) as string[];

  const subject = `⚠️ ${def.label}: CV mailbox polling needs attention`;
  const text = lines.join('\n');
  const html = `<div style="font-family: Arial, sans-serif; max-width: 640px;">
  <h2 style="color: #b91c1c;">Mailbox polling needs attention</h2>
  <ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
  <p style="color: #6b7280; font-size: 13px;">The poller resumes from its checkpoint on the next successful run, so no mail is lost while this is open.
  A wrong or revoked app password is the most common cause.</p>
</div>`;

  const sent = await deps.sendAlertEmail({ to: def.alert.email, subject, text, html });
  logger.warn('Mailbox polling alert evaluated', { mailbox: def.label, reasons, sent });
  await deps.store.updateCheckpointMetadata(def.provider, def.mailbox, {
    alert: {
      open: true,
      reasonKey,
      openedAt: alertState.open ? alertState.openedAt || now.toISOString() : now.toISOString(),
      lastSentAt: sent ? now.toISOString() : alertState.lastSentAt || null,
      lastSendFailedAt: sent ? null : now.toISOString(),
      consecutiveFailures,
      hoursSinceSuccess,
    },
  });
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

/**
 * Starts the interval poller for one mailbox. Runs a recovery poll right away (abandoned runs
 * are closed and the checkpoint resumes). Returns false when not configured or already started.
 */
export function startMailboxPoller(def: MailboxDefinition, deps: MailboxPollingDeps): boolean {
  if (!def.isConfigured() || schedulers.has(def.id)) {
    return false;
  }

  const intervalMs = Math.min(MAX_TIMER_MS, Math.max(60_000, def.intervalMinutes * 60_000));
  const watchdogMs = Math.min(intervalMs, 60 * 60_000);

  const timer = setInterval(() => {
    void pollMailbox(def, 'worker', deps);
  }, intervalMs);
  timer.unref?.();

  const watchdog = setInterval(() => {
    void evaluateMailboxAlerts(def, deps).catch((err) => {
      logger.warn('Mailbox alert watchdog failed', { mailbox: def.label, error: err });
    });
  }, watchdogMs);
  watchdog.unref?.();

  schedulers.set(def.id, { timer, watchdog, startedAt: deps.now() });
  logger.info('Mailbox poller started', {
    mailbox: def.label,
    provider: def.provider,
    readOnly: def.readOnly,
    intervalMinutes: def.intervalMinutes,
    startDate: def.startDate?.toISOString() || null,
  });

  void pollMailbox(def, 'recovery', deps).then((result) => {
    if (result.status === 'skipped' && result.skippedReason === 'locked') {
      // A previous process may still hold the lease; try again once it has expired.
      const retry = setTimeout(() => void pollMailbox(def, 'recovery', deps), def.staleAfterMs + 60_000);
      retry.unref?.();
    }
  });

  return true;
}

export function stopMailboxPoller(id: string): void {
  const scheduler = schedulers.get(id);
  if (!scheduler) return;
  clearInterval(scheduler.timer);
  clearInterval(scheduler.watchdog);
  schedulers.delete(id);
}

export async function getMailboxPollerStatus(def: MailboxDefinition, deps: MailboxPollingDeps) {
  const configured = def.isConfigured();
  const local = getLocalMailboxState(def.id);
  const base = {
    id: def.id,
    label: def.label,
    provider: def.provider,
    mailbox: def.mailbox,
    folder: def.folder,
    readOnly: def.readOnly,
    configured,
    schedulerActive: isMailboxPollerActive(def.id),
    intervalMinutes: def.intervalMinutes,
    startDate: def.startDate?.toISOString() || null,
    alertEmail: def.alert.email,
    runningInThisProcess: local.running,
    local,
  };
  if (!configured) return base;

  const [checkpoint, recentRuns, lastSuccess] = await Promise.all([
    deps.store.getCheckpoint(def.provider, def.mailbox),
    deps.store.listRecentRuns(def.provider, def.mailbox, 10),
    deps.store.getLastSuccessfulRun(def.provider, def.mailbox),
  ]);

  let consecutiveFailedRuns = 0;
  for (const run of recentRuns.filter((r) => r.status !== 'running')) {
    if (!isFailedRun(run)) break;
    consecutiveFailedRuns++;
  }

  return {
    ...base,
    checkpoint: {
      lastSeenUid: checkpoint.lastSeenUid,
      uidValidity: checkpoint.uidValidity,
      lastSeenMessageId: checkpoint.lastSeenMessageId,
      lastSeenReceivedAt: checkpoint.lastSeenReceivedAt,
      lastPollStartedAt: checkpoint.lastPollStartedAt,
      lastPollCompletedAt: checkpoint.lastPollCompletedAt,
      lock: {
        owner: checkpoint.lockOwner,
        expiresAt: checkpoint.lockExpiresAt,
        heldByThisProcess: checkpoint.lockOwner === deps.workerInstanceId,
      },
      alert: (checkpoint.metadata || {}).alert || null,
    },
    lastSuccessfulRunAt: lastSuccess?.completed_at || null,
    consecutiveFailedRuns,
    recentRuns,
  };
}
