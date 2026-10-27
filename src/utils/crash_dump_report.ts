import fs from "node:fs/promises";
import path from "node:path";
import type { CrashDump } from "@/ipc/types/misc";
import { ALLOWED_ANNOTATION_KEYS } from "./crash_telemetry_fields";
import {
  listDumpFiles,
  listDumpFilesRecursive,
  MAX_RETAINED_DUMPS,
} from "./crash_dumps";
import { parseMinidumpBuffer } from "./minidump_summary";

// The newest dumps, each reduced to its crash details and scanned stacks for
// a session upload. `retainedDir` holds the dumps kept at startup (see
// processNativeCrashDumps); `crashpadDir` holds those written since, by
// child processes that crashed while the app kept running. Platform and arch
// default to this machine's, which wrote the dumps.
export async function collectCrashDumps(
  retainedDir: string,
  crashpadDir: string,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): Promise<CrashDump[]> {
  // Each dump's crash time is found before sorting, so one whose stat fails
  // ranks by the time in its name rather than falling out of the newest.
  // A file gone since the listing was pruned and is skipped. Any other
  // failure keeps the dump as unreadable, so it is not taken for absent,
  // except a dump in crashpadDir whose stat fails: its name holds no time,
  // so it has no crash time to list it under and is left out.
  const timed: { file: string; crashedAt: string }[] = [];
  for (const file of [
    ...listDumpFiles(retainedDir),
    ...listDumpFilesRecursive(crashpadDir),
  ]) {
    let crashedAt: string | undefined;
    try {
      crashedAt = (await fs.stat(file)).mtime.toISOString();
    } catch (error) {
      if (isMissing(error)) continue;
      crashedAt = timeFromRetainedName(path.basename(file));
    }
    if (crashedAt) timed.push({ file, crashedAt });
  }
  // ISO times in UTC sort as strings.
  timed.sort((a, b) => (a.crashedAt < b.crashedAt ? 1 : -1));

  const dumps: CrashDump[] = [];
  for (const { file, crashedAt } of timed.slice(0, MAX_RETAINED_DUMPS)) {
    let buf: Buffer;
    try {
      buf = await fs.readFile(file);
    } catch (error) {
      if (isMissing(error)) continue;
      dumps.push({ file: path.basename(file), crashedAt, readable: false });
      continue;
    }
    const summary = parseMinidumpBuffer(buf, platform, arch, {
      stackTrace: true,
    });
    const entry: CrashDump = {
      file: path.basename(file),
      crashedAt,
      readable: summary !== null,
    };
    if (summary) {
      Object.assign(entry, {
        ptype: summary.ptype,
        crashReason: summary.crashReason,
        exceptionCode: summary.exceptionCode,
        faultAddress: summary.faultAddress,
        accessType: summary.accessType,
        inPageErrorStatus: summary.inPageErrorStatus,
        oomAllocationSizeBytes: summary.oomAllocationSizeBytes,
        fastFailCode: summary.fastFailCode,
        annotations: allowedAnnotations(summary.annotations),
        stack: summary.stackTrace,
      });
    }
    dumps.push(entry);
  }
  return dumps;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

// The crash time a kept dump's name carries, as crashReportName in main.ts
// writes it: crash-2026-06-07T20-41-55-123Z-9ac4d4e8.dmp.
function timeFromRetainedName(name: string): string | undefined {
  const match =
    /^crash-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/.exec(name);
  if (!match) return undefined;
  const [, date, h, m, s, ms] = match;
  return `${date}T${h}:${m}:${s}.${ms}Z`;
}

// Other annotations hold command-line switches and URL chunks, which can
// carry paths and page addresses; the allowlisted keys are the ones that
// help with a crash.
function allowedAnnotations(
  annotations: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!annotations) return undefined;
  const kept = Object.fromEntries(
    Object.entries(annotations).filter(([key]) =>
      ALLOWED_ANNOTATION_KEYS.has(key),
    ),
  );
  return Object.keys(kept).length > 0 ? kept : undefined;
}
