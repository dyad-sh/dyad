import log from "electron-log";
import { session } from "electron";
import { eq } from "drizzle-orm";

import { db } from "../../db";
import { apps } from "../../db/schema";
import { createTypedHandler } from "./base";
import {
  recordingContracts,
  type RecordingAuth,
  type StartRecordingResult,
} from "../types/recording";
import { runningApps } from "../utils/process_manager";
import { isLockHeld, withLock } from "../utils/lock_utils";
import { safeSend } from "../utils/safe_sender";
import {
  prepareIsolatedTestDatabase,
  type IsolationAuthSetup,
  type PreparedIsolation,
} from "../services/isolated_test_db";
import {
  activeRecordings,
  isRecordingActive,
  type RecordingEndReason,
} from "../services/recording_registry";
import { isTestRunActive } from "./tests_handlers";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("recording_handlers");

/** Auto-stop a forgotten recording session so its lock can't leak forever. */
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

const NO_AUTH: RecordingAuth = { mode: "none" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function getApp(appId: number) {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError(
      `App with id ${appId} not found`,
      DyadErrorKind.NotFound,
    );
  }
  return app;
}

/** The isolation's auth setup and the renderer-facing auth shape are identical. */
function toRecordingAuth(setup: IsolationAuthSetup | undefined): RecordingAuth {
  return setup ?? NO_AUTH;
}

function infraResult(appId: number, message: string): StartRecordingResult {
  return {
    appId,
    isolation: { mode: "none" },
    auth: NO_AUTH,
    infraError: { message },
  };
}

export function registerRecordingHandlers() {
  createTypedHandler(
    recordingContracts.startRecording,
    async (event, params): Promise<StartRecordingResult> => {
      const { appId } = params;

      const app = await getApp(appId);
      if (!app.testingEnabled) {
        return infraResult(
          appId,
          "Testing isn't enabled for this app. Enable it in the Tests panel before recording.",
        );
      }
      if (isRecordingActive(appId)) {
        return infraResult(
          appId,
          "A recording session is already in progress for this app.",
        );
      }
      // Recording and a test run both restart the dev server and share the
      // per-app Neon test-branch slot, so they must never overlap.
      if (isTestRunActive(appId)) {
        return infraResult(
          appId,
          "Stop the running tests before starting a recording session.",
        );
      }
      const proxyUrl = runningApps.get(appId)?.proxyUrl;
      if (!proxyUrl) {
        return infraResult(
          appId,
          "Start the app before recording — the dev server isn't running.",
        );
      }

      const emit = (message: string) =>
        safeSend(event.sender, "recording:setup-progress", { appId, message });

      if (isLockHeld(appId)) {
        emit("Waiting for a previous app operation to finish…\n");
      }

      const runtimeMode = readSettings().runtimeMode2 ?? "host";

      const ready = deferred<StartRecordingResult>();
      const stopped = deferred<RecordingEndReason>();
      const controller = new AbortController();
      let settled = false;
      const stop = (reason: RecordingEndReason) => {
        if (settled) return;
        settled = true;
        controller.abort();
        stopped.resolve(reason);
      };

      // Safety nets so the long-held lock can never leak if the renderer dies.
      const onDestroyed = () => stop("app-stopped");
      event.sender.once?.("destroyed", onDestroyed);
      const inactivityTimer = setTimeout(
        () => stop("stopped"),
        INACTIVITY_TIMEOUT_MS,
      );

      // Hold the per-app lock across the whole session (prepare → record →
      // teardown). The handler resolves on `ready` (set once isolation is up);
      // the lock is only released when the session is stopped.
      const done = withLock(appId, async () => {
        let prepared: PreparedIsolation | undefined;
        let started = false;
        let endReason: RecordingEndReason = "stopped";
        let endMessage: string | undefined;
        try {
          prepared = await prepareIsolatedTestDatabase({
            app,
            event,
            emit: (chunk) => emit(chunk),
            runtimeMode,
            signal: controller.signal,
          });

          if (prepared.infraError) {
            ready.resolve({
              appId,
              isolation: prepared.isolation,
              auth: NO_AUTH,
              infraError: prepared.infraError,
            });
            return;
          }

          // Start recording from the same pristine, logged-out state the
          // generated test replays from: clear any preview session left over
          // from the real database (the CoW branch copied the real users, so a
          // stale cookie could still look valid).
          try {
            const origin = new URL(proxyUrl).origin;
            await session.defaultSession.clearStorageData({
              origin,
              storages: [
                "cookies",
                "localstorage",
                "indexdb",
                "serviceworkers",
                "cachestorage",
              ],
            });
          } catch (error) {
            logger.warn(
              `Couldn't clear preview storage for app ${appId}: ${error}`,
            );
          }

          started = true;
          ready.resolve({
            appId,
            isolation: prepared.isolation,
            auth: toRecordingAuth(prepared.authSetup),
          });

          // Hold the lock and isolation until the session is stopped.
          endReason = await stopped.promise;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Recording session for app ${appId} failed: ${message}`);
          endReason = "error";
          endMessage = message;
          // Resolve is idempotent: this only matters when setup failed before
          // `ready` was resolved.
          ready.resolve(
            infraResult(appId, "Couldn't set up the recording session."),
          );
        } finally {
          if (prepared) {
            try {
              await prepared.teardown();
            } catch (error) {
              logger.error(
                `Recording teardown failed for app ${appId}: ${error}`,
              );
            }
          }
          activeRecordings.delete(appId);
          clearTimeout(inactivityTimer);
          event.sender.removeListener?.("destroyed", onDestroyed);
          if (started) {
            safeSend(event.sender, "recording:ended", {
              appId,
              reason: endReason,
              message: endMessage,
            });
          }
        }
      });

      activeRecordings.set(appId, { appId, stop, done });

      return ready.promise;
    },
  );

  createTypedHandler(
    recordingContracts.stopRecording,
    async (_event, params) => {
      const recording = activeRecordings.get(params.appId);
      if (recording) {
        recording.stop("stopped");
        await recording.done.catch(() => {});
      }
      return { ok: true as const };
    },
  );

  logger.debug("Registered recording IPC handlers");
}
