/**
 * Mailbox polling admin API (IMAP pollers: info@ intake, Hostinger replies, ...)
 *
 * All endpoints require the internal admin token (X-Admin-Token header).
 *
 * Endpoints:
 *   GET  /api/mailbox-admin/status             — every mailbox: checkpoint, lock, recent runs, alert state
 *   GET  /api/mailbox-admin/:id/status         — one mailbox (id: "info", "hostinger", ...)
 *   POST /api/mailbox-admin/:id/poll           — poll now (background; ?wait=true waits for the result)
 *   POST /api/mailbox-admin/:id/checkpoint     — body { lastSeenUid }: move the checkpoint forward past a stuck message
 */

import { Router, Request, Response } from 'express';
import { asyncHandler, createLogger } from '../utils/errorHandling';
import {
  getLocalMailboxState,
  getMailboxPollerStatus,
  MailboxDefinition,
  pollMailbox,
} from '../workers/mailboxPollingEngine';
import { getMailboxPollingDeps } from '../workers/mailboxPollingDeps';
import { getIntakeMailboxDefinitions } from '../workers/mailboxIntakePollingWorker';
import { getHostingerMailboxDefinition } from '../workers/hostingerPollingWorker';

const router = Router();
const logger = createLogger('MailboxAdminRoute');

// ── Simple token-based guard for admin endpoints ───────────────────────────────
function requireAdminToken(req: Request, res: Response, next: () => void) {
  const token = req.headers['x-admin-token'] || req.query.token;
  const expected = process.env.ADMIN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function listMailboxes(): MailboxDefinition[] {
  return [...getIntakeMailboxDefinitions(), getHostingerMailboxDefinition()];
}

function findMailbox(id: string): MailboxDefinition | null {
  return listMailboxes().find((def) => def.id === String(id || '').toLowerCase()) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/mailbox-admin/status
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/status',
  requireAdminToken,
  asyncHandler(async (_req: Request, res: Response) => {
    const deps = getMailboxPollingDeps();
    const mailboxes = await Promise.all(
      listMailboxes().map((def) =>
        getMailboxPollerStatus(def, deps).catch((err: Error) => ({ id: def.id, label: def.label, error: err.message }))
      )
    );
    return res.json({ workerInstanceId: deps.workerInstanceId, mailboxes });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/mailbox-admin/:id/status
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/:id/status',
  requireAdminToken,
  asyncHandler(async (req: Request, res: Response) => {
    const def = findMailbox(req.params.id);
    if (!def) return res.status(404).json({ error: `Unknown mailbox "${req.params.id}"` });
    return res.json(await getMailboxPollerStatus(def, getMailboxPollingDeps()));
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mailbox-admin/:id/poll
// One catch-up poll now (same as the scheduled poll). Fire-and-forget unless ?wait=true.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/:id/poll',
  requireAdminToken,
  asyncHandler(async (req: Request, res: Response) => {
    const def = findMailbox(req.params.id);
    if (!def) return res.status(404).json({ error: `Unknown mailbox "${req.params.id}"` });
    if (!def.isConfigured()) return res.status(400).json({ error: `${def.label} is not configured` });
    if (getLocalMailboxState(def.id).running) {
      return res.status(409).json({ status: 'already_running', message: 'A poll of this mailbox is already running in this instance' });
    }

    logger.info('Manual mailbox poll triggered by admin', { mailbox: def.label });
    const pollPromise = pollMailbox(def, 'manual', getMailboxPollingDeps());

    if (String(req.query.wait || '') === 'true') {
      return res.json({ status: 'poll_finished', result: await pollPromise });
    }

    pollPromise
      .then((result) => logger.info('Manual mailbox poll finished', { mailbox: def.label, status: result.status }))
      .catch((err) => logger.error('Manual mailbox poll failed', err, { mailbox: def.label }));

    return res.status(202).json({
      status: 'poll_triggered',
      message: 'Poll started in background',
      tip: `GET /api/mailbox-admin/${def.id}/status to follow it`,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/mailbox-admin/:id/checkpoint
// Body: { lastSeenUid: number } — forward only. For a message that keeps failing: everything up
// to and including this UID is treated as done.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/:id/checkpoint',
  requireAdminToken,
  asyncHandler(async (req: Request, res: Response) => {
    const def = findMailbox(req.params.id);
    if (!def) return res.status(404).json({ error: `Unknown mailbox "${req.params.id}"` });

    const lastSeenUid = Number(req.body?.lastSeenUid);
    if (!Number.isInteger(lastSeenUid) || lastSeenUid <= 0) {
      return res.status(400).json({ error: 'lastSeenUid must be a positive integer' });
    }

    const deps = getMailboxPollingDeps();
    const lockKey = { provider: def.provider, mailbox: def.mailbox, owner: `${deps.workerInstanceId}|admin` };
    const acquired = await deps.store.tryAcquireLock({ ...lockKey, ttlSeconds: 60 });
    if (!acquired) {
      return res.status(409).json({ error: 'A poll holds the mailbox lock; try again when it finishes' });
    }

    try {
      const before = await deps.store.getCheckpoint(def.provider, def.mailbox);
      if (lastSeenUid <= before.lastSeenUid) {
        return res.status(400).json({ error: `Checkpoint is already at UID ${before.lastSeenUid}; it only moves forward` });
      }
      await deps.store.advanceCheckpoint({
        provider: def.provider,
        mailbox: def.mailbox,
        lastSeenUid,
        metadata: { manualAdvance: { from: before.lastSeenUid, to: lastSeenUid, at: new Date().toISOString() } },
      });
      logger.warn('Mailbox checkpoint advanced manually by admin', { mailbox: def.label, from: before.lastSeenUid, to: lastSeenUid });
      return res.json({ status: 'checkpoint_advanced', from: before.lastSeenUid, to: lastSeenUid });
    } finally {
      await deps.store.releaseLock(lockKey);
    }
  })
);

export default router;
