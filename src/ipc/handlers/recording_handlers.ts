import crypto from "node:crypto";
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
import {
  appOperationCoordinator,
  readAppResource,
} from "../services/app_operation_coordinator";
import { safeSend } from "../utils/safe_sender";
import {
  prepareIsolatedTestDatabase,
  type IsolationAuthSetup,
  type PreparedIsolation,
  type TeardownOptions,
} from "../services/isolated_test_db";
import {
  activeRecordings,
  isRecordingActive,
  type EndRecordingOptions,
  type RecordingEndReason,
  type RecordingEndSummary,
} from "../services/recording_registry";
import {
  clearRecordedTestDraft,
  setRecordedTestDraft,
} from "../services/recorded_test_drafts";
import { isTestRunActive } from "./tests_handlers";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { markAppPointedAtTestBranch } from "@/ipc/services/test_isolation_recovery";

const logger = log.scope("recording_handlers");

/**
 * Absolute cap on a session so its hold on the app's resources can't leak
 * forever if the renderer forgets to stop. A hard limit, not an inactivity
 * timer: actions are
 * buffered in the renderer, so the main process sees no signal to reset against.
 */
const MAX_SESSION_MS = 30 * 60 * 1000;

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
      if (!runningApps.get(appId)?.proxyUrl) {
        return infraResult(
          appId,
          "Start the app before recording — the dev server isn't running.",
        );
      }

      const sessionId = crypto.randomUUID();
      const emit = (message: string) =>
        safeSend(event.sender, "recording:setup-progress", { appId, message });

      // A recording owns the same resources as a test run for its whole
      // lifecycle (prepare → record → teardown): both swap `.env.local` and
      // restart the dev server, so neither may interleave with the other or
      // with startup reconciliation.
      const recordingResources = [
        readAppResource("app-path"),
        "repository",
        "provider",
        "runtime",
        "runtime-config",
        "test-files",
      ] as const;

      if (appOperationCoordinator.isBusy(appId, recordingResources)) {
        emit("Waiting for a previous app operation to finish…\n");
      }

      const runtimeMode = readSettings().runtimeMode2 ?? "host";

      const ready = deferred<StartRecordingResult>();
      const stopped = deferred<RecordingEndReason>();
      const controller = new AbortController();
      let settled = false;
      // Set by whoever ends the session, read by teardown below.
      let teardownOptions: TeardownOptions = {};
      const stop = (
        reason: RecordingEndReason,
        options?: EndRecordingOptions,
      ) => {
        if (settled) return;
        settled = true;
        if (options?.skipRestart) {
          teardownOptions = { ...teardownOptions, skipRestart: true };
        }
        controller.abort();
        stopped.resolve(reason);
      };

      // Safety nets so the long-held resource claim can never leak if the
      // renderer dies.
      const onDestroyed = () => stop("app-stopped");
      event.sender.once?.("destroyed", onDestroyed);
      const sessionTimer = setTimeout(() => stop("timed-out"), MAX_SESSION_MS);

      // Hold the app's resources across the whole session. The handler resolves
      // on `ready`; they are released only when the session is stopped.
      // Filled in by the session's teardown and read by whoever ended it. A
      // shared object rather than the callback's return value so the early
      // setup-failure exits below don't each have to invent one.
      const summary: RecordingEndSummary = { envRestored: true };
      const done = appOperationCoordinator
        .run(
          {
            appId,
            operation: "start-recording",
            resources: recordingResources,
          },
          async () => {
            let prepared: PreparedIsolation | undefined;
            let started = false;
            let endReason: RecordingEndReason = "stopped";
            let endMessage: string | undefined;
            try {
              prepared = await prepareIsolatedTestDatabase({
                app,
                // No `event`: the local `emit` already closes over `event.sender`,
                // and the parameter doesn't exist on this function (the tests
                // handler calls it the same way).
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

              // Re-read rather than trusting the check above: isolation setup takes
              // seconds, and if the preview stopped meanwhile, arming the recorder
              // would point it at nothing.
              const runningApp = runningApps.get(appId);
              const proxyUrl = runningApp?.proxyUrl;
              if (!proxyUrl) {
                ready.resolve(
                  infraResult(
                    appId,
                    "The app stopped while the recording environment was being set up. Start it again and retry.",
                  ),
                );
                return;
              }

              // Start from the same pristine, logged-out state the generated test
              // replays from: the CoW branch copied the real users, so a stale
              // cookie could still look valid.
              //
              // The preview shares the app's normal browser session, so this also
              // signs the user out of their own preview and drops whatever it had in
              // localStorage. Announced rather than done quietly — it is the one
              // thing here that touches state the user didn't hand us.
              //
              // TODO: give the recorder its own `session.fromPartition()` so the
              // user's preview session is left alone entirely. That reaches into the
              // preview stack well outside this feature, so it lands separately.
              let warning: string | undefined;
              emit(
                "Clearing the preview's cookies and local storage so the recording starts signed out…\n",
              );
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
                // Not fatal — the recording is still usable — but a leftover session
                // means what gets recorded may not be reproducible from a clean
                // start, and only the user can judge that.
                warning =
                  "Couldn't clear the preview's stored session, so this recording may start already signed in. The generated test replays from a clean browser.";
              }

              started = true;
              ready.resolve({
                appId,
                sessionId,
                isolation: prepared.isolation,
                auth: toRecordingAuth(prepared.authSetup),
                authBootstrapToken: runningApp?.authBootstrapToken,
                warning,
              });

              // Hold the lock and isolation until the session is stopped.
              endReason = await stopped.promise;
              if (endReason === "timed-out") {
                endMessage =
                  "Recording stopped after reaching the 30-minute session limit.";
              }
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              logger.error(
                `Recording session for app ${appId} failed: ${message}`,
              );
              endReason = "error";
              endMessage = message;
              // Resolve is idempotent: this only matters when setup failed before
              // `ready` was resolved.
              ready.resolve(
                infraResult(appId, "Couldn't set up the recording session."),
              );
            } finally {
              if (prepared) {
                // Fail closed for the duration of the call: a teardown that THROWS
                // has told us nothing about whether `.env.local` came back, and
                // "unknown" has to fail the same way "no" does or the gate below is
                // decorative (see `recording_registry`). Only a teardown that
                // returns gets to say the environment is restored.
                summary.envRestored = false;
                try {
                  summary.envRestored = (
                    await prepared.teardown(teardownOptions)
                  ).envRestored;
                } catch (error) {
                  logger.error(
                    `Recording teardown failed for app ${appId}: ${error}`,
                  );
                }
              }
              if (!summary.envRestored) {
                // Main owns this recovery fact. The recorder-bar Stop/Cancel,
                // timeout, and renderer-destruction paths never pass through
                // app_handlers, so relying on stopApp/restartApp to mark it
                // leaves later Run attempts unaware of the swapped env.
                markAppPointedAtTestBranch(appId);
                // The app is still pointed at the temporary test branch. The
                // recorder bar is the only surface still listening, and this
                // reaches the user as an error toast — the alternative is their app
                // quietly serving isolated data from here on.
                endReason = "error";
                endMessage =
                  "Dyad couldn't restore your app's real database settings after recording. Restore .env.local before running the app again.";
              }
              // Only retire our own entry: teardown runs for seconds, so a
              // registration made meanwhile must survive. The per-session `stop`
              // closure is the session's identity.
              if (activeRecordings.get(appId)?.stop === stop) {
                activeRecordings.delete(appId);
              }
              clearTimeout(sessionTimer);
              event.sender.removeListener?.("destroyed", onDestroyed);
              if (started) {
                safeSend(event.sender, "recording:ended", {
                  appId,
                  sessionId,
                  reason: endReason,
                  message: endMessage,
                });
              }
            }
          },
        )
        .then(() => summary);

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

  createTypedHandler(
    recordingContracts.saveRecordedTestDraft,
    async (_event, params) => {
      setRecordedTestDraft(params.appId, params.draft);
      logger.info(
        `Parked a recorded test draft for app ${params.appId} with ${params.draft.actions.length} action(s)`,
      );
      return { ok: true as const };
    },
  );

  createTypedHandler(
    recordingContracts.discardRecordedTestDraft,
    async (_event, params) => {
      clearRecordedTestDraft(params.appId, params.draftId);
      return { ok: true as const };
    },
  );

  logger.debug("Registered recording IPC handlers");
}
