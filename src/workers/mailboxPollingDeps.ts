import { emailService } from '../services/emailService';
import {
  completeMailboxPollingRun,
  completePollingRunItem,
  createMailboxPollingRun,
  createPollingRunItem,
  getLastSuccessfulMailboxPollingRun,
  getMailboxCheckpoint,
  heartbeatPollingRun,
  listRecentMailboxPollingRuns,
  markAbandonedPollingRuns,
  releaseMailboxPollLock,
  setMailboxCheckpointPosition,
  tryAcquireMailboxPollLock,
  updateMailboxCheckpoint,
  updateMailboxCheckpointMetadata,
} from '../services/emailReplyAuditService';
import { createImapClient } from '../services/imapMailboxService';
import { createLogger } from '../utils/errorHandling';
import { buildWorkerInstanceId, MailboxPollingDeps } from './mailboxPollingEngine';

const logger = createLogger('MailboxPollingDeps');

let productionDeps: MailboxPollingDeps | null = null;

/** Real Supabase/IMAP/email wiring for the mailbox poller; one instance id per process. */
export function getMailboxPollingDeps(): MailboxPollingDeps {
  if (productionDeps) return productionDeps;

  productionDeps = {
    store: {
      tryAcquireLock: tryAcquireMailboxPollLock,
      releaseLock: releaseMailboxPollLock,
      getCheckpoint: getMailboxCheckpoint,
      setCheckpointPosition: setMailboxCheckpointPosition,
      advanceCheckpoint: updateMailboxCheckpoint,
      updateCheckpointMetadata: updateMailboxCheckpointMetadata,
      markAbandonedRuns: ({ provider, mailbox, staleAfterMs, excludeRunId }) =>
        markAbandonedPollingRuns(staleAfterMs, { provider, mailbox, excludeRunId }),
      createRun: createMailboxPollingRun,
      heartbeatRun: heartbeatPollingRun,
      completeRun: completeMailboxPollingRun,
      createRunItem: createPollingRunItem,
      completeRunItem: completePollingRunItem,
      listRecentRuns: listRecentMailboxPollingRuns,
      getLastSuccessfulRun: getLastSuccessfulMailboxPollingRun,
    },
    createImapClient,
    sendAlertEmail: async (args) => {
      try {
        return await emailService.sendEmail(args);
      } catch (err) {
        logger.error('Failed to send mailbox polling alert email', err, { to: args.to, subject: args.subject });
        return false;
      }
    },
    now: () => new Date(),
    workerInstanceId: buildWorkerInstanceId(),
  };

  return productionDeps;
}
