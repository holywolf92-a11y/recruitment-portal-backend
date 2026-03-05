/**
 * Gmail Admin API Routes
 *
 * All endpoints require the internal admin token (X-Admin-Token header).
 *
 * Endpoints:
 *   GET  /api/gmail-admin/status          — Gmail connection test + queue health
 *   POST /api/gmail-admin/poll            — Trigger one manual poll cycle
 *   POST /api/gmail-admin/backfill/start  — Start historical backfill
 *   GET  /api/gmail-admin/backfill/status — Current backfill progress
 *   POST /api/gmail-admin/backfill/cancel — Cancel running backfill
 *   POST /api/gmail-admin/queue/pause     — Pause cv-parsing worker (queued jobs stay, won't be picked up)
 *   POST /api/gmail-admin/queue/resume    — Resume cv-parsing worker
 *   POST /api/gmail-admin/queue/drain     — Delete ALL waiting jobs from cv-parsing queue
 */

import { Router, Request, Response } from 'express';
import { asyncHandler, createLogger } from '../utils/errorHandling';
import {
  testConnection,
  createOAuth2ClientWithToken,
  createOAuth2ClientForAccount2,
  isAccount2Configured,
} from '../services/gmailService';

async function testConnection2() {
  if (!isAccount2Configured()) return { ok: false, error: 'GMAIL2_REFRESH_TOKEN not set' };
  try {
    const { google } = await import('googleapis');
    const auth = createOAuth2ClientForAccount2();
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.getProfile({ userId: 'me' });
    return { ok: true, email: res.data.emailAddress };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
import { triggerManualPoll } from '../workers/gmailPollingWorker';
import {
  startGmailBackfill,
  cancelBackfill,
  getBackfillState,
} from '../workers/gmailBackfillWorker';
import { cvParsingQueue } from '../config/queue';
import { supabaseAdminClient } from '../config/database';

const router = Router();
const logger = createLogger('GmailAdminRoute');

// ── Simple token-based guard for admin endpoints ───────────────────────────────
function requireAdminToken(req: Request, res: Response, next: () => void) {
  const token = req.headers['x-admin-token'] || req.query.token;
  const expected = process.env.ADMIN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/gmail-admin/status
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/status',
  requireAdminToken,
  asyncHandler(async (_req: Request, res: Response) => {
    const [conn1, conn2] = await Promise.all([testConnection(), testConnection2()]);
    const backfill = getBackfillState();

    return res.json({
      account1: { ...conn1, purpose: 'candidate email replies (falishamanpower4035@gmail.com)' },
      account2: { ...conn2, purpose: 'new CV intake (falishaoep4035@gmail.com)' },
      gmail: conn1, // keep for backward compat
      credentials: {
        account1: {
          clientId:     process.env.GMAIL_CLIENT_ID      ? 'configured' : 'MISSING',
          clientSecret: process.env.GMAIL_CLIENT_SECRET  ? 'configured' : 'MISSING',
          refreshToken: process.env.GMAIL_REFRESH_TOKEN  ? 'configured' : 'MISSING',
        },
        account2: {
          clientId:     (process.env.GMAIL2_CLIENT_ID     ?? process.env.GMAIL_CLIENT_ID)     ? 'configured' : 'MISSING',
          clientSecret: (process.env.GMAIL2_CLIENT_SECRET ?? process.env.GMAIL_CLIENT_SECRET) ? 'configured' : 'MISSING',
          refreshToken: process.env.GMAIL2_REFRESH_TOKEN ? 'configured' : 'MISSING',
          usingSharedClientCredentials: !process.env.GMAIL2_CLIENT_ID,
        },
      },
      polling: {
        enabled: process.env.RUN_GMAIL_POLLING === 'true',
        intervalMinutes: 5,
      },
      backfill,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/gmail-admin/poll
// Trigger one manual poll cycle (same as automatic 5-min poll)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/poll',
  requireAdminToken,
  asyncHandler(async (_req: Request, res: Response) => {
    logger.info('Manual Gmail poll triggered by admin');

    // Fire-and-forget — ACK immediately, poll runs in background
    triggerManualPoll()
      .then((r) => logger.info('Manual poll finished', r))
      .catch((err) => logger.error('Manual poll failed', err));

    return res.json({ status: 'poll_triggered', message: 'One poll cycle started in background' });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/gmail-admin/backfill/start
// Body: { afterDate?: "2024-01-01", beforeDate?: "2026-01-01", batchSize?: 100, maxTotal?: 5000, delayMs?: 200 }
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/backfill/start',
  requireAdminToken,
  asyncHandler(async (req: Request, res: Response) => {
    const {
      afterDate: afterStr,
      beforeDate: beforeStr,
      batchSize,
      maxTotal,
      delayMs,
      account,
    } = req.body || {};

    const afterDate = afterStr ? new Date(afterStr) : undefined;
    const beforeDate = beforeStr ? new Date(beforeStr) : undefined;

    // Support account=2 to backfill the second Gmail account
    let authClient: ReturnType<typeof createOAuth2ClientWithToken> | undefined;
    if (account === 2 || account === '2') {
      if (!isAccount2Configured()) {
        return res.status(400).json({ error: 'GMAIL2_REFRESH_TOKEN not configured' });
      }
      authClient = createOAuth2ClientForAccount2();
      logger.info('Backfill using account 2 (falishaoep4035@gmail.com)');
    }

    if (afterDate && isNaN(afterDate.getTime())) {
      return res.status(400).json({ error: 'Invalid afterDate — use ISO format e.g. 2024-01-01' });
    }
    if (beforeDate && isNaN(beforeDate.getTime())) {
      return res.status(400).json({ error: 'Invalid beforeDate — use ISO format e.g. 2026-01-01' });
    }

    logger.info('Gmail backfill start requested', { afterDate, beforeDate, batchSize, maxTotal });

    const initialState = await startGmailBackfill({
      afterDate,
      beforeDate,
      batchSize: batchSize ? Number(batchSize) : undefined,
      maxTotal: maxTotal ? Number(maxTotal) : undefined,
      delayMs: delayMs !== undefined ? Number(delayMs) : undefined,
      account: (account === 2 || account === '2') ? 2 : 1,
      authClient,
    }).catch((err: Error) => {
      return res.status(409).json({ error: err.message });
    });

    if (res.headersSent) return;

    return res.json({
      status: 'backfill_started',
      state: initialState,
      tip: 'Poll GET /api/gmail-admin/backfill/status to track progress',
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/gmail-admin/backfill/status
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/backfill/status',
  requireAdminToken,
  asyncHandler(async (_req: Request, res: Response) => {
    const s = getBackfillState();

    const pct =
      s.discovered > 0
        ? Math.round(((s.processed + s.skipped) / s.discovered) * 100)
        : null;

    return res.json({
      ...s,
      progressPct: pct,
      eta: s.running && s.discovered > 0 && s.processed + s.skipped > 0
        ? estimateEta(s)
        : null,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/gmail-admin/backfill/cancel
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/backfill/cancel',
  requireAdminToken,
  asyncHandler(async (_req: Request, res: Response) => {
    cancelBackfill();
    return res.json({ status: 'cancel_requested', state: getBackfillState() });
  })
);

// POST /api/gmail-admin/queue/pause
// Pauses the cv-parsing worker — queued jobs stay in Redis but won't be picked up.
router.post(
  '/queue/pause',
  requireAdminToken,
  asyncHandler(async (_req: Request, res: Response) => {
    await cvParsingQueue.pause();
    const counts = await cvParsingQueue.getJobCounts('waiting', 'active', 'delayed');
    logger.info('cv-parsing queue paused by admin');
    return res.json({ status: 'paused', counts });
  })
);

// POST /api/gmail-admin/queue/resume
// Resumes the cv-parsing worker after a pause.
router.post(
  '/queue/resume',
  requireAdminToken,
  asyncHandler(async (_req: Request, res: Response) => {
    await cvParsingQueue.resume();
    const counts = await cvParsingQueue.getJobCounts('waiting', 'active', 'delayed');
    logger.info('cv-parsing queue resumed by admin');
    return res.json({ status: 'resumed', counts });
  })
);

// POST /api/gmail-admin/queue/drain
// Removes ALL waiting (queued but not yet active) jobs from the cv-parsing queue.
// Active jobs that are already being processed are NOT interrupted.
router.post(
  '/queue/drain',
  requireAdminToken,
  asyncHandler(async (_req: Request, res: Response) => {
    const before = await cvParsingQueue.getJobCounts('waiting', 'active', 'delayed');
    await cvParsingQueue.drain();
    const after = await cvParsingQueue.getJobCounts('waiting', 'active', 'delayed');
    logger.info('cv-parsing queue drained by admin', { before, after });
    return res.json({ status: 'drained', before, after });
  })
);

// POST /api/gmail-admin/queue/retry-all
// Re-enqueues ALL cv inbox_attachments that have no candidate_id yet (not yet parsed).
// Runs entirely server-side — no need for 797 individual HTTP calls from the client.
// The date guard in the worker will still skip pre-2024 attachments automatically.
router.post(
  '/queue/retry-all',
  requireAdminToken,
  asyncHandler(async (req: Request, res: Response) => {
    const db = supabaseAdminClient();
    const { enqueueCvParsingJobForAttachment } = await import('../services/inboxAttachmentService');

    const limit = parseInt(String(req.query.limit ?? '1000'), 10);

    // Fetch all CV attachments that don't have a candidate yet
    const { data: attachments, error } = await db
      .from('inbox_attachments')
      .select('id')
      .eq('attachment_kind', 'cv')
      .is('candidate_id', null)
      .limit(limit);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    let ok = 0;
    let fail = 0;
    const errors: string[] = [];

    for (const att of attachments ?? []) {
      try {
        await enqueueCvParsingJobForAttachment(att.id, { force: false });
        ok++;
      } catch (err: any) {
        fail++;
        if (errors.length < 10) errors.push(`${att.id}: ${err?.message}`);
      }
    }

    logger.info('Bulk retry-all completed', { ok, fail, total: attachments?.length });
    return res.json({ status: 'done', ok, fail, total: attachments?.length, sampleErrors: errors });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function estimateEta(s: ReturnType<typeof getBackfillState>): string | null {
  if (!s.startedAt || s.discovered === 0) return null;
  const elapsed = Date.now() - new Date(s.startedAt).getTime();
  const done = s.processed + s.skipped;
  if (done === 0) return null;
  const ratePerMs = done / elapsed;
  const remaining = s.discovered - done;
  const etaMs = remaining / ratePerMs;
  const etaDate = new Date(Date.now() + etaMs);
  return etaDate.toISOString();
}

export default router;
