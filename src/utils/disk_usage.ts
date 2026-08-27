import fs from "node:fs";
import log from "electron-log";

const logger = log.scope("disk-usage");

const BYTES_PER_MB = 1024 * 1024;

// This runs every 30s, and getSystemDebugInfo shows only the last 20 warn+
// lines, so a repeating error would push the crash warnings out of view.
let hasLoggedFailure = false;

export interface DiskUsageMB {
  totalMB: number;
  usedMB: number;
  availableMB: number;
}

/**
 * Capacity of the filesystem holding `targetPath`, from one statfs syscall.
 * usedMB counts every allocated block, while availableMB is what this user
 * can actually write and is lower wherever the platform holds space back —
 * a root reserve, a per-user quota. Returns null when the path is unreadable
 * so callers can omit the fields rather than report a zero.
 */
export function getDiskUsageMB(targetPath: string): DiskUsageMB | null {
  try {
    const stats = fs.statfsSync(targetPath);
    const toMB = (blocks: number) =>
      Math.round((blocks * stats.bsize) / BYTES_PER_MB);
    return {
      totalMB: toMB(stats.blocks),
      usedMB: toMB(stats.blocks - stats.bfree),
      availableMB: toMB(stats.bavail),
    };
  } catch (error) {
    if (!hasLoggedFailure) {
      hasLoggedFailure = true;
      logger.error(`Failed to read disk usage for ${targetPath}:`, error);
    }
    return null;
  }
}
