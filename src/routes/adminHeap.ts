// Admin-only endpoints to retrieve heap snapshots dropped by heapWatcher.
// Same auth pattern as gmailAdmin: X-Admin-Token header (or ?token=) matched
// against ADMIN_SECRET (fallback: SUPABASE_SERVICE_ROLE_KEY).

import { Router, Request, Response } from 'express';
import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import { asyncHandler, createLogger } from '../utils/errorHandling';

const router = Router();
const logger = createLogger('AdminHeap');

const SNAPSHOT_DIR = '/tmp';
const SNAPSHOT_NAME = /^heap-\d+\.heapsnapshot$/;

function requireAdminToken(req: Request, res: Response, next: () => void) {
  const token = (req.headers['x-admin-token'] as string) || (req.query.token as string);
  const expected = process.env.ADMIN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// GET /api/admin-heap/status — current process memory (no auth needed to peek;
// nothing sensitive). Useful to check growth without downloading a snapshot.
router.get('/status', asyncHandler(async (_req: Request, res: Response) => {
  const m = process.memoryUsage();
  return res.json({
    heapUsedMB: Math.round(m.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(m.heapTotal / 1024 / 1024),
    rssMB: Math.round(m.rss / 1024 / 1024),
    externalMB: Math.round(m.external / 1024 / 1024),
    uptimeSec: Math.round(process.uptime()),
  });
}));

// GET /api/admin-heap/list — list heap snapshot files in /tmp
router.get('/list', requireAdminToken, asyncHandler(async (_req: Request, res: Response) => {
  const files = await fs.readdir(SNAPSHOT_DIR);
  const heaps = files.filter((f) => SNAPSHOT_NAME.test(f));
  const stats = await Promise.all(
    heaps.map(async (f) => {
      const s = await fs.stat(path.join(SNAPSHOT_DIR, f));
      return { name: f, sizeMB: Math.round(s.size / 1024 / 1024), mtime: s.mtime.toISOString() };
    })
  );
  return res.json({ dir: SNAPSHOT_DIR, files: stats });
}));

// GET /api/admin-heap/download/:name — stream the .heapsnapshot file
router.get('/download/:name', requireAdminToken, asyncHandler(async (req: Request, res: Response) => {
  const name = req.params.name;
  if (!SNAPSHOT_NAME.test(name)) return res.status(400).json({ error: 'invalid snapshot name' });
  const full = path.join(SNAPSHOT_DIR, name);
  try {
    const s = await fs.stat(full);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(s.size));
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    const stream = createReadStream(full);
    stream.on('error', (err) => {
      logger.error('heap snapshot stream error', { name, error: err.message });
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (e) {
    return res.status(404).json({ error: 'snapshot not found', name });
  }
}));

export default router;
