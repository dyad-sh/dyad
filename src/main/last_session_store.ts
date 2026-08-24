import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import {
  SessionAppSizeRecordSchema,
  type SessionAppSizeRecord,
} from "@/shared/app_size_telemetry";
import { getUserDataPath } from "../paths/paths";

const logger = log.scope("last_session_store");

const LAST_SESSION_FILE = "last-session.json";

/**
 * Persists the app size a session worked in, so it survives into the next
 * launch. Its own file rather than user-settings.json because writeSettings
 * re-encrypts every stored token on each call. Not the crash sentinel either:
 * that is deleted on clean exit, and clean exits are the denominator we need.
 */
function getLastSessionPath(): string {
  return path.join(getUserDataPath(), LAST_SESSION_FILE);
}

/**
 * Written atomically: the session this describes may be killed mid-write, and
 * a torn file would be read back at the next launch. Returns whether the
 * record reached disk, so callers can avoid treating it as persisted.
 */
export function writeLastSessionRecord(record: SessionAppSizeRecord): boolean {
  let tmpPath: string | undefined;
  try {
    const filePath = getLastSessionPath();
    tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(record));
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (error) {
    logger.error("Error writing last session record:", error);
    // A rename that failed leaves the temp file sitting in userData.
    try {
      if (tmpPath) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Nothing to clean up, or it cannot be removed either.
    }
    return false;
  }
}

/**
 * Returns null when the record is absent or unparseable. Both mean "no size to
 * report", which telemetry sends as absent fields rather than guessing.
 */
export function readLastSessionRecord(): SessionAppSizeRecord | null {
  try {
    const filePath = getLastSessionPath();
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const parsed = SessionAppSizeRecordSchema.safeParse(
      JSON.parse(fs.readFileSync(filePath, "utf-8")),
    );
    if (!parsed.success) {
      logger.warn("Discarding malformed last session record");
      return null;
    }
    return parsed.data;
  } catch (error) {
    logger.error("Error reading last session record:", error);
    return null;
  }
}

/**
 * Clears the record once consumed, so a session that never measures an app
 * doesn't report the previous session's numbers as its own. Returns whether
 * the record is gone; an already-absent record counts as cleared.
 */
export function clearLastSessionRecord(): boolean {
  // A process killed between the write and the rename leaves the temp file
  // behind, and only startup is in a position to notice.
  try {
    fs.unlinkSync(`${getLastSessionPath()}.tmp`);
  } catch {
    // Absent, which is the normal case, or not removable.
  }

  try {
    fs.unlinkSync(getLastSessionPath());
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    logger.error("Error clearing last session record:", error);
    return false;
  }
}

let previousSessionAppSize: SessionAppSizeRecord | null = null;

/**
 * Takes over the record for this session, returning what the previous one
 * held. Read and clear are paired here, as with claimCrashSentinel, so the
 * clear can't end up ordered before the read.
 */
export function claimPreviousSessionAppSize(): SessionAppSizeRecord | null {
  const previous = readLastSessionRecord();
  // A record that cannot be deleted would be reported again on every later
  // launch, so it only counts as claimed once it is gone.
  previousSessionAppSize = clearLastSessionRecord() ? previous : null;
  return previousSessionAppSize;
}

/**
 * Kept in memory for the whole session, since the renderer asks for it on
 * app:initial-load rather than during startup.
 */
export function getPreviousSessionAppSize(): SessionAppSizeRecord | null {
  return previousSessionAppSize;
}

/**
 * What this session has seen. These are facts about the session, so they are
 * updated on every measurement whether or not it reaches disk — a failed write
 * that erased them would make a later successful record claim the session had
 * only ever seen one app.
 */
let largestMeasurement: { fileCount: number; totalBytes: number } | null = null;
const measuredAppIds = new Set<number>();

/**
 * What is actually on disk, which is what a repeat measurement is compared
 * against so a failed write is retried rather than skipped as unchanged.
 */
let lastWrittenRecord: SessionAppSizeRecord | null = null;

/**
 * Compares the whole record, not just the measurement. A failed write leaves
 * lastWrittenRecord behind the session accumulators, so the same app at the
 * same size can still owe the disk a larger max or a higher distinctApps.
 */
function isUnchanged(
  previous: SessionAppSizeRecord | null,
  next: SessionAppSizeRecord,
): boolean {
  return (
    previous !== null &&
    previous.appId === next.appId &&
    previous.fileCount === next.fileCount &&
    previous.totalBytes === next.totalBytes &&
    previous.maxFileCount === next.maxFileCount &&
    previous.maxTotalBytes === next.maxTotalBytes &&
    previous.distinctApps === next.distinctApps
  );
}

/**
 * Records the size of the app a chat turn just ran against, keeping both the
 * most recent measurement and the largest one the session has seen. An
 * unchanged record skips the write entirely.
 */
export function recordAppSizeForSession({
  appId,
  fileCount,
  totalBytes,
}: {
  appId: number;
  fileCount: number;
  totalBytes: number;
}): void {
  measuredAppIds.add(appId);
  // Chosen on bytes, and the pair moves together, so it stays a description of
  // one real app.
  if (
    largestMeasurement === null ||
    totalBytes > largestMeasurement.totalBytes
  ) {
    largestMeasurement = { fileCount, totalBytes };
  }

  const next: SessionAppSizeRecord = {
    fileCount,
    totalBytes,
    appId,
    maxFileCount: largestMeasurement.fileCount,
    maxTotalBytes: largestMeasurement.totalBytes,
    distinctApps: measuredAppIds.size,
  };

  if (isUnchanged(lastWrittenRecord, next)) {
    return;
  }

  if (writeLastSessionRecord(next)) {
    lastWrittenRecord = next;
  }
}

/** For tests: forget the session state accumulated in this module. */
export function resetSessionStateForTesting(): void {
  measuredAppIds.clear();
  largestMeasurement = null;
  lastWrittenRecord = null;
  previousSessionAppSize = null;
}
