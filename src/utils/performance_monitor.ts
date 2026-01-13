import log from "electron-log";
import { writeSettings } from "../main/settings";
import os from "node:os";

const logger = log.scope("performance-monitor");

// Constants
const MONITOR_INTERVAL_MS = 30000; // 30 seconds
const BYTES_PER_MB = 1024 * 1024;

let monitorInterval: NodeJS.Timeout | null = null;
let lastCpuUsage: NodeJS.CpuUsage | null = null;
let lastTimestamp: number | null = null;
let lastSystemCpuInfo: os.CpuInfo[] | null = null;
let lastSystemTimestamp: number | null = null;

/**
 * Get current memory usage in MB
 */
function getMemoryUsageMB(): number {
  const memoryUsage = process.memoryUsage();
  // Use RSS (Resident Set Size) for total memory used by the process
  return Math.round(memoryUsage.rss / BYTES_PER_MB);
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
    const cpuUsagePercent = getCpuUsagePercent();
    const systemMemory = getSystemMemoryUsage();
    const systemCpuPercent = getSystemCpuUsagePercent();

    // Skip saving if CPU is null (first call for either metric)
    if (cpuUsagePercent === null || systemCpuPercent === null) {
      logger.debug(
        `Performance: Memory=${memoryUsageMB}MB, CPU=initializing, System Memory=${systemMemory.usagePercent}%, System CPU=initializing`,
      );
      return;
    }

    logger.debug(
      `Performance: Memory=${memoryUsageMB}MB, CPU=${cpuUsagePercent}%, System Memory=${systemMemory.usedMemoryMB}/${systemMemory.totalMemoryMB}MB (${systemMemory.usagePercent}%), System CPU=${systemCpuPercent}%`,
    );

    writeSettings({
      lastKnownPerformance: {
        timestamp: Date.now(),
        memoryUsageMB,
        cpuUsagePercent,
        systemMemoryUsageMB: systemMemory.usedMemoryMB,
        systemMemoryTotalMB: systemMemory.totalMemoryMB,
        systemCpuPercent,
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
export function startPerformanceMonitoring() {
  if (monitorInterval) {
    logger.warn("Performance monitoring already started");
    return;
  }

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
