// Heap monitor + burst diagnostics for OOM investigation.
//
// The continuous leak is fixed (steady state is a flat ~240MB plateau). What
// remains is an occasional BURST: something allocates ~150-170MB over ~30 min,
// tips past the 512MB V8 cap, and OOMs. The previous /tmp heap snapshot was
// lost because the crash recycles the container before it can be downloaded.
//
// So instead of relying on the giant snapshot, this logs a RICH memory
// breakdown every 30s while heapUsed is in the "burst zone" (>300MB, above the
// 250MB plateau). These logs persist in Railway logs regardless of the crash,
// and the three signals below usually name the culprit outright:
//   • v8 heap-space breakdown — is the growth in `large_object_space`
//     (big Buffers/strings/arrays: file data, base64, huge query results) or
//     `old_space` (many small objects: accumulated rows/messages)?
//   • active handles grouped by constructor — catches leaked Sockets / TLS /
//     streams / timers (a classic connection leak).
//   • inbox fallback store sizes — rules the bounded fallback in or out.
//
// A best-effort full snapshot is still written to /tmp at 400MB in case the
// window is caught, but the logs are the primary diagnostic.

import { writeHeapSnapshot, getHeapSpaceStatistics } from 'v8';
import { createLogger } from './errorHandling';
import { getInboxMemoryStats } from '../services/inboxMemory';

const logger = createLogger('HeapWatcher');

const BURST_ZONE_BYTES = 300 * 1024 * 1024;       // above the ~250MB plateau
const SNAPSHOT_THRESHOLD_BYTES = 400 * 1024 * 1024; // best-effort full snapshot
const BASELINE_LOG_EVERY_MS = 5 * 60 * 1000;       // steady-state heartbeat
const CHECK_INTERVAL_MS = 30 * 1000;

let snapshotTaken = false;
let lastBaselineLogAt = 0;
const mb = (n: number) => Math.round(n / 1024 / 1024);

function activeHandleBreakdown(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    // Undocumented but stable; guarded so a runtime change can't crash the app.
    const handles: any[] = (process as any)._getActiveHandles?.() ?? [];
    for (const h of handles) {
      const name = h?.constructor?.name || typeof h;
      out[name] = (out[name] || 0) + 1;
    }
  } catch {
    /* ignore */
  }
  return out;
}

function heapSpaceBreakdown(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    for (const s of getHeapSpaceStatistics()) {
      out[s.space_name] = mb(s.space_used_size);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function logBurstDiagnostics(mem: NodeJS.MemoryUsage): void {
  let activeRequests = 0;
  try {
    activeRequests = ((process as any)._getActiveRequests?.() ?? []).length;
  } catch {
    /* ignore */
  }
  logger.warn('BURST diagnostics', {
    heapUsedMB: mb(mem.heapUsed),
    rssMB: mb(mem.rss),
    externalMB: mb(mem.external),
    arrayBuffersMB: mb((mem as any).arrayBuffers ?? 0),
    heapSpacesMB: heapSpaceBreakdown(),   // watch large_object_space vs old_space
    activeHandles: activeHandleBreakdown(), // watch Socket/TLSSocket/Stream/Timeout growth
    activeRequests,
    inboxMemory: getInboxMemoryStats(),
  });
}

export function startHeapWatcher(): void {
  logger.info('Heap watcher started', {
    burstZoneMB: mb(BURST_ZONE_BYTES),
    snapshotMB: mb(SNAPSHOT_THRESHOLD_BYTES),
  });

  setInterval(() => {
    let mem: NodeJS.MemoryUsage;
    try {
      mem = process.memoryUsage();
    } catch {
      return;
    }

    if (mem.heapUsed > BURST_ZONE_BYTES) {
      // In the danger zone — log the full breakdown every tick so we get a
      // time-series of WHAT is growing as the burst unfolds.
      logBurstDiagnostics(mem);
    } else {
      const now = Date.now();
      if (now - lastBaselineLogAt >= BASELINE_LOG_EVERY_MS) {
        lastBaselineLogAt = now;
        logger.info('memory', {
          heapUsedMB: mb(mem.heapUsed),
          heapTotalMB: mb(mem.heapTotal),
          rssMB: mb(mem.rss),
          externalMB: mb(mem.external),
        });
      }
    }

    if (!snapshotTaken && mem.heapUsed > SNAPSHOT_THRESHOLD_BYTES) {
      snapshotTaken = true;
      const path = `/tmp/heap-${Date.now()}.heapsnapshot`;
      const startedAt = Date.now();
      logger.warn('Heap crossed snapshot threshold — writing snapshot (best effort)', {
        heapUsedMB: mb(mem.heapUsed),
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
