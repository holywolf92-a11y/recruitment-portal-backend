/**
 * CV intake mailboxes polled over IMAP (read-only), e.g. info@falishamanpower.com on Google Workspace.
 *
 * Mailboxes come from env: IMAP_INTAKE_MAILBOXES (default "INFO") lists ids; each id reads
 * <ID>_IMAP_* variables, e.g. for INFO:
 *   INFO_IMAP_USER, INFO_IMAP_PASSWORD (Google app password)  — required
 *   INFO_IMAP_HOST (imap.gmail.com), INFO_IMAP_PORT (993), INFO_IMAP_SECURE (true)
 *   INFO_IMAP_POLL_INTERVAL_MINUTES (60; 1440 = daily)
 *   INFO_IMAP_START_DATE (YYYY-MM-DD; mail received before it is never imported; unset = only new mail)
 *   INFO_IMAP_ALERT_EMAIL (defaults to the mailbox itself), INFO_IMAP_ALERT_FAILURE_THRESHOLD (3),
 *   INFO_IMAP_ALERT_STALE_HOURS (26), INFO_IMAP_BATCH_SIZE (50)
 *   RUN_INFO_IMAP_POLLING=true|false (unset: runs whenever USER and PASSWORD are set)
 */

import { supabaseAdminClient } from '../config/database';
import { createInboxMessage } from '../services/inboxService';
import { createAttachment, enqueueCvParsingJobForAttachment } from '../services/inboxAttachmentService';
import { createCvIntakeMessageHandler, CvIntakeDeps } from '../services/cvIntakeMailboxHandler';
import { mayContainIntakeCvAttachment } from '../services/imapMailboxService';
import { AppError, ErrorType, createLogger } from '../utils/errorHandling';
import { MailboxDefinition, startMailboxPoller } from './mailboxPollingEngine';
import { getMailboxPollingDeps } from './mailboxPollingDeps';

const logger = createLogger('MailboxIntakePollingWorker');

export const INTAKE_PROVIDER = 'imap-intake';
const INTAKE_FOLDER = 'INBOX';

const intakeDeps: CvIntakeDeps = {
  async findInboxMessageByExternalId(externalMessageId) {
    const { data, error } = await supabaseAdminClient()
      .from('inbox_messages')
      .select('id, status, payload')
      .eq('external_message_id', externalMessageId)
      .maybeSingle();
    if (error) throw error;
    return data ? { id: data.id, status: data.status ?? null, payload: data.payload ?? null } : null;
  },
  createInboxMessage: (input) => createInboxMessage(input),
  async updateInboxMessage(id, update) {
    const { error } = await supabaseAdminClient()
      .from('inbox_messages')
      .update({ status: update.status, payload: update.payload })
      .eq('id', id);
    if (error) throw error;
  },
  createAttachment: (input) => createAttachment(input),
  async findCvAttachmentBySha256(sha256) {
    const { data, error } = await supabaseAdminClient()
      .from('inbox_attachments')
      .select('id, inbox_message_id')
      .eq('sha256', sha256)
      .eq('attachment_type', 'cv')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },
  enqueueCvParsingJob: (attachmentId) =>
    enqueueCvParsingJobForAttachment(attachmentId, { force: false, expiresInSeconds: 3600 }),
  isDuplicateError: (err) =>
    (err instanceof AppError && err.type === ErrorType.DUPLICATE) ||
    /already exists|duplicate/i.test(String((err as any)?.message || '')),
};

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStartDate(value: string, envName: string): Date | null {
  if (!value) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) {
    logger.warn(`${envName} is not a valid date; importing only new mail`, { value });
    return null;
  }
  return parsed;
}

export function listIntakeMailboxIds(): string[] {
  return String(process.env.IMAP_INTAKE_MAILBOXES || 'INFO')
    .split(',')
    .map((id) => id.trim().toUpperCase())
    .filter((id) => /^[A-Z0-9_]+$/.test(id));
}

const definitionCache = new Map<string, MailboxDefinition>();

export function buildIntakeMailboxDefinition(envId: string): MailboxDefinition {
  const cached = definitionCache.get(envId);
  if (cached) return cached;

  const prefix = `${envId}_IMAP_`;
  const env = (key: string) => String(process.env[`${prefix}${key}`] || '').trim();

  const host = env('HOST') || 'imap.gmail.com';
  const user = env('USER').toLowerCase();
  const rawPassword = process.env[`${prefix}PASSWORD`] || '';
  // Google shows app passwords in groups of four; the spaces are not part of the password.
  const password = /(^|\.)(gmail|googlemail)\.com$/i.test(host) ? rawPassword.replace(/\s+/g, '') : rawPassword;
  const id = envId.toLowerCase();
  const mailbox = `${user || id}/${INTAKE_FOLDER}`;

  const definition: MailboxDefinition = {
    id,
    provider: INTAKE_PROVIDER,
    mailbox,
    label: user || id,
    folder: INTAKE_FOLDER,
    readOnly: true,
    batchSize: parsePositiveInt(env('BATCH_SIZE'), 50),
    intervalMinutes: parsePositiveInt(env('POLL_INTERVAL_MINUTES'), 60),
    heartbeatIntervalMs: 15000,
    staleAfterMs: 15 * 60 * 1000,
    startDate: parseStartDate(env('START_DATE'), `${prefix}START_DATE`),
    initialPosition: 'newest',
    alert: {
      email: env('ALERT_EMAIL') || user || null,
      failureThreshold: parsePositiveInt(env('ALERT_FAILURE_THRESHOLD'), 3),
      staleAfterHours: parsePositiveInt(env('ALERT_STALE_HOURS'), 26),
    },
    isConfigured: () => !!(user && password),
    getConnection: () => ({
      host,
      port: parsePositiveInt(env('PORT'), 993),
      secure: env('SECURE').toLowerCase() !== 'false',
      user,
      pass: password,
    }),
    wantsMessage: (summary) => mayContainIntakeCvAttachment(summary.attachments),
    handleMessage: createCvIntakeMessageHandler({
      inboxSource: 'email',
      provider: INTAKE_PROVIDER,
      mailbox,
      account: user,
      deps: intakeDeps,
    }),
  };

  definitionCache.set(envId, definition);
  return definition;
}

export function isIntakeMailboxEnabled(envId: string): boolean {
  const flag = String(process.env[`RUN_${envId}_IMAP_POLLING`] || '').trim().toLowerCase();
  if (flag === 'false') return false;
  return buildIntakeMailboxDefinition(envId).isConfigured();
}

export function getIntakeMailboxDefinitions(): MailboxDefinition[] {
  return listIntakeMailboxIds().map(buildIntakeMailboxDefinition);
}

/** Starts every enabled intake mailbox. Returns the ids that were started. */
export function startIntakeMailboxPolling(): string[] {
  const started: string[] = [];
  for (const envId of listIntakeMailboxIds()) {
    const definition = buildIntakeMailboxDefinition(envId);
    if (!isIntakeMailboxEnabled(envId)) {
      logger.info('Intake mailbox polling disabled or not configured', { id: definition.id });
      continue;
    }
    if (startMailboxPoller(definition, getMailboxPollingDeps())) {
      started.push(definition.id);
    }
  }
  return started;
}
