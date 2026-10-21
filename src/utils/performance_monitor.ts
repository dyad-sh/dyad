import log from "electron-log";
import { app, BrowserWindow } from "electron";
import { writeSettings } from "../main/settings";
import os from "node:os";
import v8 from "node:v8";
import {
  isExtractCodebaseActive,
  type ActivitySnapshot,
} from "./memory_activity";
import { getActiveStreamCount } from "../ipc/handlers/chat_stream_handlers";
import {
  getRunningAppProcessPids,
  runningApps,
} from "../ipc/utils/process_manager";
import { typescriptUtilityProcessScheduler } from "../ipc/processors/typescript_utility_process_scheduler";
import { getUserDataPath } from "../paths/paths";
import { getDiskUsageMB } from "./disk_usage";
import { getSystemCommitInfoMB } from "./system_commit_info";
import { getCachedPagefileSettings } from "./windows_pagefile";
import { getLatestRendererHeapReport } from "./renderer_heap_reports";
import { getDevServerMemorySample } from "./dev_server_memory";
import { getPreviewViewOSProcessIds } from "../main/preview_web_contents_view";

// Tells a registered product window from any other BrowserWindow (preview
// popups, for one). Supplied by main.ts at start-up; the registry itself
// stays inside main-only modules.
let isProductWebContents: (webContentsId: number) => boolean = () => false;

const logger = log.scope("performance-monitor");

// Constants
const MONITOR_INTERVAL_MS = 30000; // 30 seconds
const BYTES_PER_MB = 1024 * 1024;

let monitorInterval: NodeJS.Timeout | null = null;
let lastCpuUsage: NodeJS.CpuUsage | null = null;
let lastTimestamp: number | null = null;
let lastSystemCpuInfo: os.CpuInfo[] | null = null;
let lastSystemTimestamp: number | null = null;

// Session memory highs. peakRssMB comes from the kernel and is exact; the
// others are maxima over sampled values and can miss short spikes.
let peakHeapUsedMB = 0;
let peakHeapPct = 0;
let peakRssMB = 0;
const peakProcessWorkingSetsMB: Record<string, number> = {};
let peakActivity: ActivitySnapshot | null = null;
let peakTimestamp: number | null = null;

/**
 * Get current memory usage in MB
 */
function getMemoryUsageMB(): number {
  const memoryUsage = process.memoryUsage();
  // Use RSS (Resident Set Size) for total memory used by the process
  return Math.round(memoryUsage.rss / BYTES_PER_MB);
}

/**
 * Get main process V8 heap usage and limit in MB
 */
function getHeapStatsMB(): { heapUsedMB: number; heapLimitMB: number } {
  const stats = v8.getHeapStatistics();
  return {
    heapUsedMB: Math.round(stats.used_heap_size / BYTES_PER_MB),
    heapLimitMB: Math.round(stats.heap_size_limit / BYTES_PER_MB),
  };
}

interface RendererSplitMB {
  uiWorkingSetMB: number;
  previewWorkingSetMB: number;
  uiCommitMB: number | null;
  previewCommitMB: number | null;
}

interface ProcessMemoryMetrics {
  // Working set per Electron process type, e.g.
  // { browser: 400, tab: 900, gpu: 120, utility: 300 }.
  workingSetsMB: Record<string, number>;
  // Private commit per type. Windows only; null elsewhere.
  commitMB: Record<string, number> | null;
  // The "tab" line above, split by what each renderer process hosts.
  rendererSplit: RendererSplitMB | null;
}

/**
 * Which renderer processes host Dyad's own UI and which host an app
 * preview. Electron labels both "tab", so they are told apart by pid: a
 * registered product window's main frame is UI; a frame in that window
 * running in another process (an out-of-process preview iframe), or a
 * preview WebContentsView, is a preview. Other windows, such as popups
 * the preview opened, land in neither bucket.
 *
 * A preview iframe that shares the UI's process (same-site with the UI,
 * which only happens in development) is counted as UI.
 */
function getRendererPidGroups(): {
  uiPids: Set<number>;
  previewPids: Set<number>;
} {
  const uiPids = new Set<number>();
  const previewPids = new Set<number>();
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      const contents = window.webContents;
      if (contents.isDestroyed() || !isProductWebContents(contents.id)) {
        continue;
      }
      const mainPid = contents.getOSProcessId();
      uiPids.add(mainPid);
      for (const frame of contents.mainFrame.framesInSubtree) {
        if (frame.osProcessId !== mainPid) {
          previewPids.add(frame.osProcessId);
        }
      }
    } catch {
      // A window mid-teardown; its process will be missing from the
      // metrics anyway.
    }
  }
  for (const pid of getPreviewViewOSProcessIds()) {
    previewPids.add(pid);
  }
  return { uiPids, previewPids };
}

/**
 * Memory per Electron process type. Main process RSS alone dramatically
 * understates real usage. Cheap (no shell-outs); safe for periodic capture.
 */
function getProcessMemoryMetrics(): ProcessMemoryMetrics | null {
  try {
    const metrics = app.getAppMetrics();
    const { uiPids, previewPids } = getRendererPidGroups();
    const workingSetsMB: Record<string, number> = {};
    const commitMB: Record<string, number> = {};
    let sawCommit = false;
    let matchedRenderer = false;
    let uiWorkingSet = 0;
    let previewWorkingSet = 0;
    let uiCommit = 0;
    let previewCommit = 0;
    for (const metric of metrics) {
      const key = metric.type.toLowerCase();
      const workingSet = metric.memory.workingSetSize / 1024;
      workingSetsMB[key] = (workingSetsMB[key] ?? 0) + workingSet;
      // privateBytes is only reported on Windows.
      const privateBytes = metric.memory.privateBytes;
      const commit = typeof privateBytes === "number" ? privateBytes / 1024 : 0;
      if (typeof privateBytes === "number") {
        sawCommit = true;
        commitMB[key] = (commitMB[key] ?? 0) + commit;
      }
      if (key !== "tab") {
        continue;
      }
      if (uiPids.has(metric.pid)) {
        matchedRenderer = true;
        uiWorkingSet += workingSet;
        uiCommit += commit;
      } else if (previewPids.has(metric.pid)) {
        matchedRenderer = true;
        previewWorkingSet += workingSet;
        previewCommit += commit;
      }
    }
    for (const key of Object.keys(workingSetsMB)) {
      workingSetsMB[key] = Math.round(workingSetsMB[key]);
    }
    for (const key of Object.keys(commitMB)) {
      commitMB[key] = Math.round(commitMB[key]);
    }
    return {
      workingSetsMB,
      commitMB: sawCommit ? commitMB : null,
      // Omitted rather than zero when no renderer process was matched, as
      // during a renderer reload: zero would read as a real measurement.
      rendererSplit: matchedRenderer
        ? {
            uiWorkingSetMB: Math.round(uiWorkingSet),
            previewWorkingSetMB: Math.round(previewWorkingSet),
            uiCommitMB: sawCommit ? Math.round(uiCommit) : null,
            previewCommitMB: sawCommit ? Math.round(previewCommit) : null,
          }
        : null,
    };
  } catch {
    return null;
  }
}

/**
 * Main process memory outside the V8 heap that JS objects still own:
 * Buffers, ArrayBuffers, file reads. Not all native memory (SQLite's own
 * allocations are not in here), but it covers the case where the heap
 * looked fine and memory did not.
 */
function getMainExternalMB(): { externalMB: number; arrayBuffersMB: number } {
  const usage = process.memoryUsage();
  return {
    externalMB: Math.round(usage.external / BYTES_PER_MB),
    arrayBuffersMB: Math.round(usage.arrayBuffers / BYTES_PER_MB),
  };
}

/**
 * Get the kernel-tracked peak RSS of the main process in MB.
 * Exact for the whole process lifetime, even between samples.
 */
function getKernelPeakRssMB(): number {
  // maxRSS is reported in kilobytes
  return Math.round(process.resourceUsage().maxRSS / 1024);
}

/**
 * What the main process is doing right now
 */
function snapshotActivity(): ActivitySnapshot {
  return {
    activeStreams: getActiveStreamCount(),
    runningApps: runningApps.size,
    extractCodebase: isExtractCodebaseActive(),
    tsUtilityProcess: typescriptUtilityProcessScheduler.activeOperationKind(),
  };
}

/**
 * Get CPU usage percentage
 * This measures CPU time used by this process relative to wall clock time
 */
function getCpuUsagePercent(): number | null {
  const currentCpuUsage = process.cpuUsage();
  const currentTimestamp = Date.now();

  // On first call, just initialize and return null
  if (lastCpuUsage === null || lastTimestamp === null) {
    lastCpuUsage = currentCpuUsage;
    lastTimestamp = currentTimestamp;
    return null;
  }

  // Calculate elapsed wall clock time in microseconds
  const elapsedTimeMs = currentTimestamp - lastTimestamp;
  const elapsedTimeMicros = elapsedTimeMs * 1000;

  // Calculate CPU time used (user + system) in microseconds
  const cpuTimeMicros =
    currentCpuUsage.user -
    lastCpuUsage.user +
    (currentCpuUsage.system - lastCpuUsage.system);

  // CPU percentage = (CPU time / wall clock time) * 100
  // This gives percentage across all cores (can exceed 100% on multi-core systems)
  const cpuPercent = (cpuTimeMicros / elapsedTimeMicros) * 100;

  // Update for next calculation
  lastCpuUsage = currentCpuUsage;
  lastTimestamp = currentTimestamp;

  return Math.round(cpuPercent * 100) / 100; // Round to 2 decimal places
}

/**
 * Get system memory usage
 */
function getSystemMemoryUsage(): {
  totalMemoryMB: number;
  usedMemoryMB: number;
  freeMemoryMB: number;
  usagePercent: number;
} {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;

  return {
    totalMemoryMB: Math.round(totalMemory / BYTES_PER_MB),
    usedMemoryMB: Math.round(usedMemory / BYTES_PER_MB),
    freeMemoryMB: Math.round(freeMemory / BYTES_PER_MB),
    usagePercent: Math.round((usedMemory / totalMemory) * 100 * 100) / 100,
  };
}

/**
 * Get system CPU usage percentage
 */
function getSystemCpuUsagePercent(): number | null {
  const cpus = os.cpus();
  const currentTimestamp = Date.now();

  // On first call, just initialize and return null
  if (lastSystemCpuInfo === null || lastSystemTimestamp === null) {
    lastSystemCpuInfo = cpus;
    lastSystemTimestamp = currentTimestamp;
    return null;
  }

  // Calculate total CPU time for all cores
  let totalIdle = 0;
  let totalTick = 0;
  let lastTotalIdle = 0;
  let lastTotalTick = 0;

  // Current CPU times
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  }

  // Last CPU times
  for (const cpu of lastSystemCpuInfo) {
    for (const type in cpu.times) {
      lastTotalTick += cpu.times[type as keyof typeof cpu.times];
    }
    lastTotalIdle += cpu.times.idle;
  }

  // Calculate differences
  const totalTickDiff = totalTick - lastTotalTick;
  const idleDiff = totalIdle - lastTotalIdle;

  // Calculate usage percentage
  const usage = 100 - (100 * idleDiff) / totalTickDiff;

  // Update for next calculation
  lastSystemCpuInfo = cpus;
  lastSystemTimestamp = currentTimestamp;

  return Math.round(usage * 100) / 100;
}

/**
 * Capture and save current performance metrics
 */
function capturePerformanceMetrics() {
  try {
    const memoryUsageMB = getMemoryUsageMB();
    const processMetrics = getProcessMemoryMetrics();
    const processWorkingSetsMB = processMetrics?.workingSetsMB ?? null;
    const allProcessesMemoryMB = processWorkingSetsMB
      ? Object.values(processWorkingSetsMB).reduce((sum, mb) => sum + mb, 0)
      : null;
    const cpuUsagePercent = getCpuUsagePercent();
    const systemMemory = getSystemMemoryUsage();
    const systemCpuPercent = getSystemCpuUsagePercent();

    // Skip saving if CPU is null (first call for either metric)
    if (cpuUsagePercent === null || systemCpuPercent === null) {
      logger.debug(
        `Performance: Memory=${memoryUsageMB}MB, All Processes=${allProcessesMemoryMB ?? "?"}MB, CPU=initializing, System Memory=${systemMemory.usagePercent}%, System CPU=initializing`,
      );
      return;
    }

    const { heapUsedMB, heapLimitMB } = getHeapStatsMB();
    const heapPct =
      heapLimitMB > 0
        ? Math.round((heapUsedMB / heapLimitMB) * 10000) / 100
        : 0;
    const kernelPeakRssMB = getKernelPeakRssMB();
    const activity = snapshotActivity();
    // The user data volume is the system volume, which is the disk we want
    // to measure. The apps folder is user-configurable and can sit on a
    // different drive entirely.
    const diskUsage = getDiskUsageMB(getUserDataPath());
    const commit = getSystemCommitInfoMB();
    const pagefile = getCachedPagefileSettings();
    const mainExternal = getMainExternalMB();
    const rendererHeap = getLatestRendererHeapReport();
    const rendererSplit = processMetrics?.rendererSplit ?? null;
    // Dev servers are sampled on their own, slower cadence (a shell-out
    // each time); this returns the latest sample for the current set.
    const devServers = getDevServerMemorySample({
      rootPids: getRunningAppProcessPids().map(({ pid }) => pid),
      now: Date.now(),
    });

    logger.debug(
      `Performance: Memory=${memoryUsageMB}MB, Heap=${heapUsedMB}/${heapLimitMB}MB, All Processes=${allProcessesMemoryMB ?? "?"}MB, CPU=${cpuUsagePercent}%, System Memory=${systemMemory.usedMemoryMB}/${systemMemory.totalMemoryMB}MB (${systemMemory.usagePercent}%), System CPU=${systemCpuPercent}%`,
    );

    // Child process working sets drift constantly, so only main process
    // peaks (heap, RSS) stamp peakActivity and peakTimestamp.
    let mainPeakAdvanced = false;
    if (heapUsedMB > peakHeapUsedMB) {
      peakHeapUsedMB = heapUsedMB;
      mainPeakAdvanced = true;
    }
    if (heapPct > peakHeapPct) {
      peakHeapPct = heapPct;
      mainPeakAdvanced = true;
    }
    if (kernelPeakRssMB > peakRssMB) {
      peakRssMB = kernelPeakRssMB;
      mainPeakAdvanced = true;
    }
    if (processWorkingSetsMB) {
      for (const [key, value] of Object.entries(processWorkingSetsMB)) {
        if (value > (peakProcessWorkingSetsMB[key] ?? 0)) {
          peakProcessWorkingSetsMB[key] = value;
        }
      }
    }
    if (mainPeakAdvanced) {
      peakActivity = activity;
      peakTimestamp = Date.now();
    }

    writeSettings({
      lastKnownPerformance: {
        timestamp: Date.now(),
        memoryUsageMB,
        cpuUsagePercent,
        systemMemoryUsageMB: systemMemory.usedMemoryMB,
        systemMemoryTotalMB: systemMemory.totalMemoryMB,
        systemCpuPercent,
        ...(diskUsage && {
          diskTotalMB: diskUsage.totalMB,
          diskUsedMB: diskUsage.usedMB,
          diskAvailableMB: diskUsage.availableMB,
        }),
        heapUsedMB,
        heapLimitMB,
        ...(processWorkingSetsMB && { processWorkingSetsMB }),
        ...(commit && {
          commitLimitMB: commit.commitLimitMB,
          commitAvailableMB: commit.commitAvailableMB,
        }),
        ...(pagefile && {
          pagefileMode: pagefile.mode,
          ...(pagefile.maxMB !== undefined && {
            pagefileMaxMB: pagefile.maxMB,
          }),
        }),
        ...(processMetrics?.commitMB && {
          processCommitMB: processMetrics.commitMB,
        }),
        ...(rendererSplit && {
          uiRendererWorkingSetMB: rendererSplit.uiWorkingSetMB,
          previewRendererWorkingSetMB: rendererSplit.previewWorkingSetMB,
          ...(rendererSplit.uiCommitMB !== null && {
            uiRendererCommitMB: rendererSplit.uiCommitMB,
          }),
          ...(rendererSplit.previewCommitMB !== null && {
            previewRendererCommitMB: rendererSplit.previewCommitMB,
          }),
        }),
        mainExternalMB: mainExternal.externalMB,
        mainArrayBuffersMB: mainExternal.arrayBuffersMB,
        ...(rendererHeap && {
          rendererHeapUsedMB: rendererHeap.heapUsedMB,
          rendererHeapLimitMB: rendererHeap.heapLimitMB,
        }),
        ...(devServers && {
          devServerCount: devServers.count,
          devServerTotalMB: devServers.totalMB,
          devServerMaxMB: devServers.maxMB,
          devServerMaxProcessCount: devServers.maxProcessCount,
          devServerSampledAt: devServers.sampledAt,
        }),
        activity,
        peakHeapUsedMB,
        peakHeapPct,
        peakRssMB,
        peakProcessWorkingSetsMB: { ...peakProcessWorkingSetsMB },
        ...(peakActivity && { peakActivity }),
        ...(peakTimestamp !== null && { peakTimestamp }),
      },
    });
  } catch (error) {
    logger.error("Error capturing performance metrics:", error);
  }
}

/**
 * Start monitoring performance metrics
 * Captures metrics every 30 seconds
 */
export function startPerformanceMonitoring(options: {
  isProductWebContents: (webContentsId: number) => boolean;
}) {
  if (monitorInterval) {
    logger.warn("Performance monitoring already started");
    return;
  }
  isProductWebContents = options.isProductWebContents;

  logger.info("Starting performance monitoring");

  // Capture initial metrics
  capturePerformanceMetrics();

  // Capture every 30 seconds
  monitorInterval = setInterval(capturePerformanceMetrics, MONITOR_INTERVAL_MS);
}

/**
 * Stop monitoring performance metrics
 */
export function stopPerformanceMonitoring() {
  if (monitorInterval) {
    logger.info("Stopping performance monitoring");
    clearInterval(monitorInterval);
    monitorInterval = null;

    // Capture final metrics before stopping
    capturePerformanceMetrics();
  }
}
