import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import {
  LastSessionRecordSchema,
  type AppSizeLane,
  type LastSessionRecord,
  type SessionAppSizeRecord,
} from "@/shared/app_size_telemetry";
import { getUserDataPath } from "../paths/paths";

const logger = log.scope("last_session_store");

const LAST_SESSION_FILE = "last-session.json";

/**
 * Persists the app sizes a session worked with, so they survive into the next
 * launch. Its own file rather than user-settings.json because writeSettings
 * re-encrypts every stored token on each call. Not the crash sentinel either:
 * that is deleted on clean exit, and clean exits are the denominator we need.
 */
function getLastSessionPath(): string {
  return path.join(getUserDataPath(), LAST_SESSION_FILE);
}

/**
 * Written atomically: the session this describes may be killed mid-write, and
 * a torn file would be read back at the next launch.
 */
export function writeLastSessionRecord(record: LastSessionRecord): void {
  try {
    const filePath = getLastSessionPath();
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(record));
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    logger.error("Error writing last session record:", error);
  }
}

/**
 * Returns null when the record is absent or unparseable. Both mean "no size to
 * report", which telemetry sends as absent fields rather than guessing.
 */
export function readLastSessionRecord(): LastSessionRecord | null {
  try {
    const filePath = getLastSessionPath();
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const parsed = LastSessionRecordSchema.safeParse(
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
 * doesn't report the previous session's numbers as its own.
 */
export function clearLastSessionRecord(): void {
  try {
    fs.unlinkSync(getLastSessionPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("Error clearing last session record:", error);
    }
  }
}

let previousSessionAppSize: LastSessionRecord | null = null;

/**
 * Takes over the record for this session, returning what the previous one
 * held. Read and clear are paired here, as with claimCrashSentinel, so the
 * clear can't end up ordered before the read.
 */
export function claimPreviousSessionAppSize(): LastSessionRecord | null {
  previousSessionAppSize = readLastSessionRecord();
  clearLastSessionRecord();
  return previousSessionAppSize;
}

/**
 * Kept in memory for the whole session, since the renderer asks for it on
 * app:initial-load rather than during startup.
 */
export function getPreviousSessionAppSize(): LastSessionRecord | null {
  return previousSessionAppSize;
}

/**
 * This session's measurements, mirrored to disk on every change. Memory is
 * authoritative so a write never has to read back and merge the file.
 */
const currentSession: LastSessionRecord = {};
const measuredAppIds: Record<AppSizeLane, Set<number>> = {
  viewed: new Set(),
  chatted: new Set(),
};

function isUnchanged(
  previous: SessionAppSizeRecord | undefined,
  next: Omit<SessionAppSizeRecord, "distinctApps" | "measuredAt">,
): boolean {
  return (
    previous !== undefined &&
    previous.appId === next.appId &&
    previous.fileCount === next.fileCount &&
    previous.totalBytes === next.totalBytes
  );
}

/**
 * Records the size of an app this session worked with. Each lane has one
 * writer: app selection for "viewed", chat turns for "chatted". An unchanged
 * measurement skips the write rather than just advancing the timestamp.
 */
export function recordAppSizeForSession({
  lane,
  appId,
  fileCount,
  totalBytes,
}: {
  lane: AppSizeLane;
  appId: number;
  fileCount: number;
  totalBytes: number;
}): void {
  const measurement = { fileCount, totalBytes, appId };
  if (isUnchanged(currentSession[lane], measurement)) {
    return;
  }

  measuredAppIds[lane].add(appId);
  currentSession[lane] = {
    ...measurement,
    distinctApps: measuredAppIds[lane].size,
    measuredAt: Date.now(),
  };
  writeLastSessionRecord(currentSession);
}

/** For tests: forget the session state accumulated in this module. */
export function resetSessionStateForTesting(): void {
  measuredAppIds.viewed.clear();
  measuredAppIds.chatted.clear();
  delete currentSession.viewed;
  delete currentSession.chatted;
  previousSessionAppSize = null;
}
