// Windows commit charge. When a program asks for memory, Windows promises it
// a place to live, in RAM or in the pagefile. The limit is the most it can
// promise across the whole machine (RAM plus the pagefile's current size);
// available is how much of that has not been promised yet, to any program.
//
// Electron's process.getSystemMemoryInfo() surfaces these through Chromium's
// SystemMemoryInfoKB, which on Windows fills swap_total from
// MEMORYSTATUSEX.ullTotalPageFile (the commit limit) and swap_free from
// ullAvailPageFile (available commit), despite the "swap" names. That
// mapping comes from reading Chromium's process_metrics_win.cc; it still
// needs one check against Task Manager's "Committed X / Y" figures on a
// real Windows machine before the numbers are relied on.

const KB_PER_MB = 1024;

export interface SystemCommitInfo {
  commitLimitMB: number;
  commitAvailableMB: number;
}

type SystemMemoryInfoReader = () => { swapTotal: number; swapFree: number };

export function getSystemCommitInfoMB(
  options: {
    platform?: NodeJS.Platform;
    getSystemMemoryInfo?: SystemMemoryInfoReader;
  } = {},
): SystemCommitInfo | null {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return null;
  }
  try {
    const read =
      options.getSystemMemoryInfo ??
      (process.getSystemMemoryInfo as SystemMemoryInfoReader | undefined);
    if (!read) {
      return null;
    }
    const info = read();
    if (!(info.swapTotal > 0)) {
      return null;
    }
    return {
      commitLimitMB: Math.round(info.swapTotal / KB_PER_MB),
      commitAvailableMB: Math.round(info.swapFree / KB_PER_MB),
    };
  } catch {
    return null;
  }
}
