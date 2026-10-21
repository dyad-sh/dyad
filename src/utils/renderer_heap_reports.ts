// The renderer's V8 heap, as reported by each product window's preload every
// 30s. The main process cannot read another process's heap, so the renderer
// pushes it, and the heartbeat picks up the latest report here.

export interface RendererHeapReport {
  heapUsedMB: number;
  heapLimitMB: number;
}

interface StoredReport extends RendererHeapReport {
  receivedAt: number;
}

// Three missed reports and a window's figure is dropped: a renderer that has
// stopped reporting is hung, reloading, or gone, and a stale number would
// read as current at crash time.
const REPORT_TTL_MS = 90_000;

const reports = new Map<number, StoredReport>();

export function recordRendererHeapReport(
  webContentsId: number,
  report: RendererHeapReport,
  now = Date.now(),
): void {
  reports.set(webContentsId, { ...report, receivedAt: now });
}

export function clearRendererHeapReport(webContentsId: number): void {
  reports.delete(webContentsId);
}

function heapRatio(report: RendererHeapReport): number {
  return report.heapLimitMB > 0 ? report.heapUsedMB / report.heapLimitMB : 0;
}

/**
 * The fresh report nearest its heap limit. Several product windows can be
 * open; the one closest to running out is the one that matters for a
 * crash. Compared as a ratio in case windows ever get different limits.
 */
export function getLatestRendererHeapReport(
  now = Date.now(),
): RendererHeapReport | null {
  let best: StoredReport | null = null;
  for (const [id, report] of reports) {
    if (now - report.receivedAt > REPORT_TTL_MS) {
      reports.delete(id);
      continue;
    }
    if (!best || heapRatio(report) > heapRatio(best)) {
      best = report;
    }
  }
  return best
    ? { heapUsedMB: best.heapUsedMB, heapLimitMB: best.heapLimitMB }
    : null;
}

export function resetRendererHeapReportsForTesting(): void {
  reports.clear();
}
