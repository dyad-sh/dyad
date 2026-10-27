import fs from "node:fs/promises";
import path from "node:path";
import type { CrashDump } from "@/ipc/types/misc";
import { ALLOWED_ANNOTATION_KEYS } from "./crash_telemetry_fields";
import {
  listDumpFiles,
  listDumpFilesRecursive,
  MAX_RETAINED_DUMPS,
  sortNewestFirst,
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
  const files = sortNewestFirst([
    ...listDumpFiles(retainedDir),
    ...listDumpFilesRecursive(crashpadDir),
  ]).slice(0, MAX_RETAINED_DUMPS);
  const dumps: CrashDump[] = [];
  for (const file of files) {
    let buf: Buffer;
    let crashedAt: string;
    try {
      buf = await fs.readFile(file);
      crashedAt = (await fs.stat(file)).mtime.toISOString();
    } catch {
      // Pruned or removed between the listing and the read.
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
