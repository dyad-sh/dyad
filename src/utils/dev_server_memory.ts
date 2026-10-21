import { execFile } from "node:child_process";
import path from "node:path";
import log from "electron-log";
import {
  collectProcessTree,
  parsePsProcessTable,
  type PsProcessEntry,
} from "./process_memory_diagnostics";

const logger = log.scope("dev_server_memory");

const KB_PER_MB = 1024;
const BYTES_PER_KB = 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
// `ps` returns at once; PowerShell needs a few seconds just to start.
const PS_TIMEOUT_MS = 3_000;
const POWERSHELL_TIMEOUT_MS = 15_000;

// A full process-table snapshot costs a shell-out (and on Windows a
// PowerShell start-up), so it is taken every few minutes rather than on
// every 30s heartbeat, and more often once memory is running short.
export const DEV_SERVER_SAMPLE_INTERVAL_MS = 5 * 60_000;
export const DEV_SERVER_PRESSURE_SAMPLE_INTERVAL_MS = 60_000;

/**
 * Memory of the dev servers Dyad launched, each measured as the whole
 * process tree under the spawned root (npm, node, vite, esbuild, ...).
 * On Windows the metric is private commit (Win32_Process.PrivatePageCount);
 * on macOS and Linux it is RSS, the closest analog ps offers.
 */
export interface DevServerMemorySample {
  sampledAt: number;
  // Dev servers with a live root pid at sample time.
  count: number;
  totalMB: number;
  // The largest single dev server, and how many processes it had grown to.
  maxMB: number;
  maxProcessCount: number;
}

// =============================================================================
// Pure helpers (exported for testing)
// =============================================================================

/**
 * Parses `<pid> <ppid> <privateBytes>` lines, the shape the PowerShell
 * Win32_Process query below prints. Tolerates blank and malformed lines.
 */
export function parseWindowsProcessTable(output: string): PsProcessEntry[] {
  const entries: PsProcessEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/);
    if (!match) continue;
    entries.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      // Reuse the ps entry shape; rssKb holds private commit here.
      rssKb: Math.round(Number(match[3]) / BYTES_PER_KB),
      command: "",
    });
  }
  return entries;
}

export function summarizeDevServerMemory(
  rootPids: number[],
  entries: PsProcessEntry[],
  sampledAt: number,
): DevServerMemorySample {
  let count = 0;
  let totalKb = 0;
  let maxKb = 0;
  let maxProcessCount = 0;
  for (const pid of rootPids) {
    const tree = collectProcessTree(pid, entries);
    if (tree.length === 0) {
      // Root not in the snapshot: it exited between the pid list and the
      // snapshot, so it is not a running dev server any more.
      continue;
    }
    count++;
    const treeKb = tree.reduce((sum, entry) => sum + entry.rssKb, 0);
    totalKb += treeKb;
    if (treeKb > maxKb) {
      maxKb = treeKb;
      maxProcessCount = tree.length;
    }
  }
  return {
    sampledAt,
    count,
    totalMB: Math.round(totalKb / KB_PER_MB),
    maxMB: Math.round(maxKb / KB_PER_MB),
    maxProcessCount,
  };
}

// =============================================================================
// Collector
// =============================================================================

function execCapture(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
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

async function snapshotProcessTable(): Promise<PsProcessEntry[]> {
  if (process.platform === "win32") {
    const systemRoot =
      process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
    const powershell = path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    // No quotes inside the command: the array `-join` keeps it a single
    // token so nothing needs escaping on the way to PowerShell.
    const output = await execCapture(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,PrivatePageCount | ForEach-Object { $_.ProcessId, $_.ParentProcessId, $_.PrivatePageCount -join ' ' }",
      ],
      POWERSHELL_TIMEOUT_MS,
    );
    return parseWindowsProcessTable(output);
  }
  const output = await execCapture(
    "ps",
    ["-axo", "pid,ppid,rss,comm"],
    PS_TIMEOUT_MS,
  );
  return parsePsProcessTable(output);
}

let latestSample: DevServerMemorySample | null = null;
let sampleInFlight = false;
let lastSampleStartedAt = 0;

/**
 * The most recent dev-server memory sample, starting a new one in the
 * background when the previous is old enough. Never blocks the heartbeat:
 * the shell-out runs asynchronously and lands in a later heartbeat.
 *
 * With no dev server running, the answer is immediate and no process is
 * spawned.
 */
export function getDevServerMemorySample(input: {
  rootPids: number[];
  now: number;
  underMemoryPressure: boolean;
}): DevServerMemorySample | null {
  const { rootPids, now, underMemoryPressure } = input;
  if (rootPids.length === 0) {
    latestSample = {
      sampledAt: now,
      count: 0,
      totalMB: 0,
      maxMB: 0,
      maxProcessCount: 0,
    };
    return latestSample;
  }

  const interval = underMemoryPressure
    ? DEV_SERVER_PRESSURE_SAMPLE_INTERVAL_MS
    : DEV_SERVER_SAMPLE_INTERVAL_MS;
  if (!sampleInFlight && now - lastSampleStartedAt >= interval) {
    sampleInFlight = true;
    lastSampleStartedAt = now;
    void snapshotProcessTable()
      .then((entries) => {
        latestSample = summarizeDevServerMemory(rootPids, entries, now);
        logger.debug("Dev server memory:", latestSample);
      })
      .catch((error) => {
        logger.warn("Failed to sample dev server memory:", error);
      })
      .finally(() => {
        sampleInFlight = false;
      });
  }
  return latestSample;
}

export function resetDevServerMemoryForTesting(): void {
  latestSample = null;
  sampleInFlight = false;
  lastSampleStartedAt = 0;
}
