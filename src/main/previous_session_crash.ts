/**
 * The crash the previous session ended in, once this launch has told the
 * renderer about it, so a report started from the crash dialog can name the
 * dump that crash left.
 */

// undefined: no crash detected. null: a crash with no readable dump tied to it.
let crashDumpFile: string | null | undefined;

export function recordPreviousSessionCrash(dumpFile: string | null): void {
  crashDumpFile = dumpFile;
}

export function getPreviousSessionCrashDump(): string | null | undefined {
  return crashDumpFile;
}
