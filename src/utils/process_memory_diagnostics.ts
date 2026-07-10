import { execFile } from "node:child_process";
import os from "node:os";
import v8 from "node:v8";
import log from "electron-log";
import type {
  AppProcessTree,
  AppProcessTreesResult,
  ElectronProcessMetricsResult,
  ProcessMemoryDiagnostics,
  SystemMemorySignals,
  TopProcessesResult,
  VmStatSummary,
} from "../ipc/types/misc";

const logger = log.scope("process_memory_diagnostics");

// All shell-outs are best-effort and must finish quickly: diagnostics run
// on-demand (session-export time), never on a hot path.
const EXEC_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;

const BYTES_PER_MB = 1024 * 1024;
const KB_PER_MB = 1024;

// Thresholds for deciding that the system is under genuine memory pressure
// (darwin only). Below 15% free+reclaimable, or more than 1GB of swap in use,
// we also capture the top system processes by RSS.
const PRESSURE_FREE_RATIO_THRESHOLD = 0.15;
const PRESSURE_SWAP_USED_MB_THRESHOLD = 1024;
const TOP_PROCESS_COUNT = 15;

/** One row of `ps -axo pid,ppid,rss,comm` output. rss is in KB. */
export interface PsProcessEntry {
  pid: number;
  ppid: number;
  rssKb: number;
  command: string;
}

// =============================================================================
// Pure parsers (exported for testing)
// =============================================================================

/**
 * Parses `ps -axo pid,ppid,rss,comm` output into structured entries.
 * Tolerates the header row and malformed lines. comm may contain spaces.
 */
export function parsePsProcessTable(output: string): PsProcessEntry[] {
  const entries: PsProcessEntry[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/);
    if (!match) continue;
    entries.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKb: Number(match[3]),
      command: match[4],
    });
  }
  return entries;
}

/**
 * Returns the process rooted at rootPid plus all of its descendants,
 * using the parent-pid links in the ps snapshot. The root entry itself is
 * included when present. Guards against ppid cycles.
 */
export function collectProcessTree(
  rootPid: number,
  entries: PsProcessEntry[],
): PsProcessEntry[] {
  const childrenByPpid = new Map<number, PsProcessEntry[]>();
  const byPid = new Map<number, PsProcessEntry>();
  for (const entry of entries) {
    byPid.set(entry.pid, entry);
    const siblings = childrenByPpid.get(entry.ppid);
    if (siblings) {
      siblings.push(entry);
    } else {
      childrenByPpid.set(entry.ppid, [entry]);
    }
  }

  const result: PsProcessEntry[] = [];
  const visited = new Set<number>();
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (visited.has(pid)) continue;
    visited.add(pid);
    const entry = byPid.get(pid);
    if (entry) {
      result.push(entry);
    }
    for (const child of childrenByPpid.get(pid) ?? []) {
      queue.push(child.pid);
    }
  }
  return result;
}

/**
 * Parses `vm_stat` output (macOS). Returns null when the output doesn't look
 * like vm_stat at all (no page size header and no page counters).
 */
export function parseVmStat(output: string): VmStatSummary | null {
  const pageSizeMatch = output.match(/page size of (\d+) bytes/);

  const counters = new Map<string, number>();
  for (const line of output.split("\n")) {
    // Lines look like: `Pages wired down:              112824.`
    const match = line.match(/^"?([^":]+)"?:\s+(\d+)\.?\s*$/);
    if (match) {
      counters.set(match[1].trim(), Number(match[2]));
    }
  }

  if (!pageSizeMatch && counters.size === 0) {
    return null;
  }

  const pages = (label: string) => counters.get(label) ?? 0;
  return {
    pageSizeBytes: pageSizeMatch ? Number(pageSizeMatch[1]) : 4096,
    freePages: pages("Pages free"),
    activePages: pages("Pages active"),
    inactivePages: pages("Pages inactive"),
    speculativePages: pages("Pages speculative"),
    wiredPages: pages("Pages wired down"),
    purgeablePages: pages("Pages purgeable"),
    compressorPages: pages("Pages occupied by compressor"),
    pageouts: pages("Pageouts"),
  };
}

/**
 * Parses `sysctl vm.swapusage` output (macOS), e.g.
 * `vm.swapusage: total = 2048.00M  used = 1017.75M  free = 1030.25M  (encrypted)`.
 * Returns sizes in MB, or null if the output doesn't match.
 */
export function parseSwapUsage(
  output: string,
): { totalMb: number; usedMb: number } | null {
  const parseSize = (name: string): number | null => {
    const match = output.match(
      new RegExp(`${name}\\s*=\\s*([\\d.]+)([KMGT]?)`, "i"),
    );
    if (!match) return null;
    const value = Number(match[1]);
    switch (match[2].toUpperCase()) {
      case "K":
        return value / 1024;
      case "G":
        return value * 1024;
      case "T":
        return value * 1024 * 1024;
      default:
        // sysctl reports M by default; treat missing suffix as MB too.
        return value;
    }
  };

  const totalMb = parseSize("total");
  const usedMb = parseSize("used");
  if (totalMb === null || usedMb === null) return null;
  return { totalMb: round2(totalMb), usedMb: round2(usedMb) };
}

/** Returns the top `limit` entries by RSS, descending. */
export function topProcessesByRss(
  entries: PsProcessEntry[],
  limit: number,
): { pid: number; rssKb: number; command: string }[] {
  return [...entries]
    .sort((a, b) => b.rssKb - a.rssKb)
    .slice(0, limit)
    .map(({ pid, rssKb, command }) => ({ pid, rssKb, command }));
}

// =============================================================================
// Collectors
// =============================================================================

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function bytesToMb(value: number): number {
  return round2(value / BYTES_PER_MB);
}

function pagesToMb(pages: number, pageSizeBytes: number): number {
  return Math.round((pages * pageSizeBytes) / BYTES_PER_MB);
}

function errorToString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs a command with a short timeout. Rejects on any failure. */
function execCommand(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

/**
 * Collects per-process metrics for every Electron process (Browser, Tab, GPU,
 * Utility) plus main-process heap statistics. Never throws.
 */
export async function collectElectronProcessMetrics(): Promise<ElectronProcessMetricsResult> {
  const result: ElectronProcessMetricsResult = {
    processes: [],
    totalWorkingSetSizeMb: 0,
    mainProcess: { rssMb: 0, heapTotalMb: 0, heapUsedMb: 0, externalMb: 0 },
    v8Heap: {
      heapSizeLimitMb: 0,
      totalHeapSizeMb: 0,
      usedHeapSizeMb: 0,
      mallocedMemoryMb: 0,
      externalMemoryMb: 0,
    },
  };

  try {
    const memoryUsage = process.memoryUsage();
    result.mainProcess = {
      rssMb: bytesToMb(memoryUsage.rss),
      heapTotalMb: bytesToMb(memoryUsage.heapTotal),
      heapUsedMb: bytesToMb(memoryUsage.heapUsed),
      externalMb: bytesToMb(memoryUsage.external),
    };
    const heapStats = v8.getHeapStatistics();
    result.v8Heap = {
      heapSizeLimitMb: bytesToMb(heapStats.heap_size_limit),
      totalHeapSizeMb: bytesToMb(heapStats.total_heap_size),
      usedHeapSizeMb: bytesToMb(heapStats.used_heap_size),
      mallocedMemoryMb: bytesToMb(heapStats.malloced_memory),
      externalMemoryMb: bytesToMb(heapStats.external_memory),
    };

    // Imported lazily so this module stays importable outside an Electron
    // runtime (unit tests exercise the pure parsers above).
    const { app } = await import("electron");
    if (!app?.getAppMetrics) {
      result.error = "app.getAppMetrics unavailable";
      return result;
    }
    for (const metric of app.getAppMetrics()) {
      result.processes.push({
        type: metric.type,
        pid: metric.pid,
        workingSetSizeKb: metric.memory.workingSetSize,
        creationTime: metric.creationTime,
        ...(metric.name ? { name: metric.name } : {}),
        ...(metric.serviceName ? { serviceName: metric.serviceName } : {}),
      });
      result.totalWorkingSetSizeMb += metric.memory.workingSetSize / KB_PER_MB;
    }
    result.totalWorkingSetSizeMb = round2(result.totalWorkingSetSizeMb);
  } catch (err) {
    result.error = `Failed to collect Electron process metrics: ${errorToString(err)}`;
  }
  return result;
}

/**
 * Takes a single `ps` snapshot of all processes (macOS/Linux). Returns null
 * on Windows or on any failure.
 */
async function snapshotPsTable(): Promise<PsProcessEntry[] | null> {
  if (process.platform === "win32") {
    return null;
  }
  const output = await execCommand("ps", ["-axo", "pid,ppid,rss,comm"]);
  return parsePsProcessTable(output);
}

/**
 * Builds the RSS process tree for each running preview app by walking
 * descendants of the spawned dev-server process in the ps snapshot.
 */
async function collectAppProcessTrees(
  psEntries: PsProcessEntry[] | null,
  psError: string | null,
): Promise<AppProcessTreesResult> {
  if (process.platform === "win32") {
    return {
      supported: false,
      trees: [],
      error: "Process tree collection is not supported on Windows",
    };
  }

  try {
    // Imported lazily: process_manager pulls in Electron-dependent modules
    // that must not load when this module is imported in unit tests.
    const { getRunningAppProcessPids } =
      await import("../ipc/utils/process_manager");
    const appPids = getRunningAppProcessPids();
    if (appPids.length === 0) {
      return { supported: true, trees: [] };
    }
    if (!psEntries) {
      return {
        supported: true,
        trees: [],
        error: psError ?? "ps snapshot unavailable",
      };
    }

    const trees: AppProcessTree[] = [];
    for (const { appId, pid } of appPids) {
      const treeEntries = collectProcessTree(pid, psEntries);
      const totalRssKb = treeEntries.reduce(
        (sum, entry) => sum + entry.rssKb,
        0,
      );
      trees.push({
        appId,
        rootPid: pid,
        processes: topProcessesByRss(treeEntries, treeEntries.length),
        totalRssMb: Math.round(totalRssKb / KB_PER_MB),
        ...(treeEntries.length === 0
          ? { note: "root pid not found in ps snapshot (process exited?)" }
          : {}),
      });
    }
    return { supported: true, trees };
  } catch (err) {
    return {
      supported: true,
      trees: [],
      error: `Failed to collect app process trees: ${errorToString(err)}`,
    };
  }
}

/**
 * Collects real memory-pressure signals on macOS via vm_stat and
 * sysctl vm.swapusage; falls back to os.totalmem/freemem elsewhere.
 */
export async function collectSystemMemorySignals(
  options: {
    platform?: NodeJS.Platform;
    totalMemoryBytes?: number;
    freeMemoryBytes?: number;
    runCommand?: typeof execCommand;
  } = {},
): Promise<SystemMemorySignals> {
  const platform = options.platform ?? process.platform;
  const totalMemoryBytes = options.totalMemoryBytes ?? os.totalmem();
  const freeMemoryBytes = options.freeMemoryBytes ?? os.freemem();
  const runCommand = options.runCommand ?? execCommand;
  const totalMemoryMb = Math.round(totalMemoryBytes / BYTES_PER_MB);
  const result: SystemMemorySignals = {
    platform,
    totalMemoryMb,
  };

  if (platform !== "darwin") {
    const usedMemory = totalMemoryBytes - freeMemoryBytes;
    result.fallback = {
      usedMemoryMb: Math.round(usedMemory / BYTES_PER_MB),
      freeMemoryMb: Math.round(freeMemoryBytes / BYTES_PER_MB),
      usagePercent: round2((usedMemory / totalMemoryBytes) * 100),
    };
    return result;
  }

  const [vmStatResult, swapResult] = await Promise.allSettled([
    runCommand("vm_stat", []),
    runCommand("sysctl", ["vm.swapusage"]),
  ]);

  if (vmStatResult.status === "fulfilled") {
    const vmStat = parseVmStat(vmStatResult.value);
    const swap =
      swapResult.status === "fulfilled"
        ? parseSwapUsage(swapResult.value)
        : null;
    if (!vmStat) {
      result.error = "Failed to parse vm_stat output";
      return result;
    }

    const { pageSizeBytes } = vmStat;
    result.vmStat = vmStat;
    // App memory: pages genuinely held (active + wired + compressor-resident),
    // minus purgeable pages the OS can drop on demand.
    result.appMemoryMb = Math.max(
      0,
      pagesToMb(
        vmStat.activePages + vmStat.wiredPages + vmStat.compressorPages,
        pageSizeBytes,
      ) - pagesToMb(vmStat.purgeablePages, pageSizeBytes),
    );
    // Reclaimable: inactive (mostly file cache), speculative, and purgeable
    // pages can all be reclaimed without swapping.
    result.reclaimableMb = pagesToMb(
      vmStat.inactivePages + vmStat.speculativePages + vmStat.purgeablePages,
      pageSizeBytes,
    );
    result.freeMb = pagesToMb(vmStat.freePages, pageSizeBytes);
    if (swap) {
      result.swapUsedMb = swap.usedMb;
      result.swapTotalMb = swap.totalMb;
    }

    const availableRatio =
      (result.freeMb + result.reclaimableMb) / totalMemoryMb;
    result.pressureDetected =
      availableRatio < PRESSURE_FREE_RATIO_THRESHOLD ||
      (result.swapUsedMb ?? 0) > PRESSURE_SWAP_USED_MB_THRESHOLD;
    if (swapResult.status === "rejected") {
      result.error = `Failed to collect swap usage: ${errorToString(swapResult.reason)}`;
    }
  } else {
    result.error = `Failed to collect vm_stat: ${errorToString(vmStatResult.reason)}`;
    // Still provide the (misleading, but better than nothing) os fallback.
    result.fallback = {
      usedMemoryMb: Math.round(
        (totalMemoryBytes - freeMemoryBytes) / BYTES_PER_MB,
      ),
      freeMemoryMb: Math.round(freeMemoryBytes / BYTES_PER_MB),
      usagePercent: round2(
        ((totalMemoryBytes - freeMemoryBytes) / totalMemoryBytes) * 100,
      ),
    };
  }
  return result;
}

/**
 * Collects all process-level memory diagnostics. Best-effort and read-only:
 * this function never throws and never blocks longer than the short exec
 * timeouts. Intended to run on-demand (e.g. at session-export time), not on
 * a periodic hot path.
 *
 * @param options.force When true, always capture the top-N processes by RSS
 * even if no memory pressure is detected.
 */
export async function collectProcessMemoryDiagnostics(
  options: { force?: boolean } = {},
): Promise<ProcessMemoryDiagnostics> {
  const collectedAt = new Date().toISOString();

  // ps snapshot is shared between the app process trees and the top-N view.
  let psEntries: PsProcessEntry[] | null = null;
  let psError: string | null = null;
  try {
    psEntries = await snapshotPsTable();
  } catch (err) {
    psError = `ps failed: ${errorToString(err)}`;
    logger.warn(psError);
  }

  const [electron, systemMemory, appProcessTrees] = await Promise.all([
    collectElectronProcessMetrics(),
    collectSystemMemorySignals(),
    collectAppProcessTrees(psEntries, psError),
  ]);

  let topProcesses: TopProcessesResult;
  const shouldCapture = options.force || systemMemory.pressureDetected;
  if (!shouldCapture) {
    topProcesses = {
      captured: false,
      reason: "no memory pressure detected",
    };
  } else if (process.platform === "win32") {
    topProcesses = {
      captured: false,
      reason: "not supported on Windows",
    };
  } else if (!psEntries) {
    topProcesses = {
      captured: false,
      reason: options.force ? "forced" : "memory pressure detected",
      error: psError ?? "ps snapshot unavailable",
    };
  } else {
    topProcesses = {
      captured: true,
      reason: options.force ? "forced" : "memory pressure detected",
      processes: topProcessesByRss(psEntries, TOP_PROCESS_COUNT),
    };
  }

  return {
    collectedAt,
    platform: process.platform,
    electron,
    appProcessTrees,
    systemMemory,
    topProcesses,
  };
}
