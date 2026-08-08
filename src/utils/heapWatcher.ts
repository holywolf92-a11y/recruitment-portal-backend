// Lightweight heap monitor + one-shot snapshot dumper for OOM diagnostics.
//
// The container is capped at 512MB RAM / heap. The process crashes with
// "Ineffective mark-compacts near heap limit" around ~505MB. We want the heap
// snapshot BEFORE that so we can identify the retainer, but taking a snapshot
// itself allocates memory (~= current heap size). So we trigger at a
// conservative 400MB — plenty of headroom for the copy and the write, but late
// enough that the leaking objects are present.
//
// Fires ONCE per process lifetime. Snapshot is written to /tmp. Retrieve via
// GET /api/admin-heap/list + /api/admin-heap/download/:name (auth-gated by
// ADMIN_SECRET header, same pattern as gmailAdmin).

import { writeHeapSnapshot } from 'v8';
import { createLogger } from './errorHandling';

const logger = createLogger('HeapWatcher');

const SNAPSHOT_THRESHOLD_BYTES = 400 * 1024 * 1024; // 400 MB
const LOG_EVERY_MS = 5 * 60 * 1000; // log memory every 5 min for baseline visibility
const CHECK_INTERVAL_MS = 30 * 1000;

let snapshotTaken = false;
let lastLogAt = 0;

export function startHeapWatcher(): void {
  logger.info('Heap watcher started', {
    thresholdMB: SNAPSHOT_THRESHOLD_BYTES / 1024 / 1024,
    intervalSec: CHECK_INTERVAL_MS / 1000,
  });

  setInterval(() => {
    let mem: NodeJS.MemoryUsage;
    try {
      mem = process.memoryUsage();
    } catch {
      return;
    }

    const now = Date.now();
    if (now - lastLogAt >= LOG_EVERY_MS) {
      lastLogAt = now;
      logger.info('memory', {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
      });
    }

    if (!snapshotTaken && mem.heapUsed > SNAPSHOT_THRESHOLD_BYTES) {
      snapshotTaken = true;
      const path = `/tmp/heap-${now}.heapsnapshot`;
      const startedAt = Date.now();
      logger.warn('Heap crossed threshold — writing snapshot', {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        thresholdMB: SNAPSHOT_THRESHOLD_BYTES / 1024 / 1024,
        path,
      });
      try {
        writeHeapSnapshot(path);
        logger.warn('Heap snapshot written', {
          path,
          durationMs: Date.now() - startedAt,
          fetchWith: 'GET /api/admin-heap/download/' + path.split('/').pop(),
        });
      } catch (e) {
        logger.error('Failed to write heap snapshot', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }, CHECK_INTERVAL_MS).unref();
}
