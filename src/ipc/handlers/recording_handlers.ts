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
  endRecordingForApp,
  recordingStartBlockReason,
  reserveRecordingStart,
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
import {
  isTestBranchCleanupOnly,
  restoreAppFromTestBranch,
} from "../utils/neon_test_branch";

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

/**
 * Drop everything the preview's browser session holds for the app's origin.
 *
 * Called at both ends of a recording. Setup uses it to start capture from the
 * pristine, signed-out state the generated test replays from; teardown uses it
 * to take the temporary identity back out. The auth bootstrap seeds that
 * identity into storage the preview keeps — a Supabase session under
 * `sb-<ref>-auth-token`, a Better Auth cookie — and deleting the test user is a
 * server-side change an already-issued JWT does not see. Left behind, the
 * preview goes on acting as a user Dyad has disowned, against the real project.
 *
 * The `origin` filter is honest for localStorage/IndexedDB/service workers,
 * which are genuinely origin-keyed, but NOT for cookies: cookies have never been
 * port-scoped on the web, so clearing `http://localhost:<proxyPort>` clears
 * cookies for every other `localhost` origin in this session too — other
 * previews included. There is no API that narrows it, and `session.clearData`'s
 * `origins` filter is wider still (Electron deletes cookies at the registrable
 * domain there). Only the dedicated `session.fromPartition()` noted below would
 * actually contain it; until then the confirmation dialog says so out loud.
 */
async function clearPreviewStorage(origin: string): Promise<void> {
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

      const startReservation = reserveRecordingStart(appId);
      if (!startReservation) {
        // A destructive operation can hold the app against new sessions while
        // it runs (a restore cancels streams before it can take the repository
        // claim). Naming it beats "already in progress", which would be simply
        // untrue.
        const blockedBy = recordingStartBlockReason(appId);
        return infraResult(
          appId,
          blockedBy
            ? `Wait for Dyad to ${blockedBy} before starting a recording.`
            : "A recording session is already in progress for this app.",
        );
      }

      // Stop/Run/Restart/Delete end this app's recording, but until the session
      // below is published there is nothing for them to stop — they mark the
      // reservation instead. Checked after every await in that window: giving up
      // late means preparing an isolated database for an app the user has
      // already stopped, and then restarting it to serve one.
      const cancelledDuringSetup = () =>
        infraResult(
          appId,
          "The recording session ended before its environment was ready.",
        );

      try {
        let app = await getApp(appId);
        if (startReservation.cancelled) {
          return cancelledDuringSetup();
        }
        if (!app.testingEnabled) {
          return infraResult(
            appId,
            "Testing isn't enabled for this app. Enable it in the Tests panel before recording.",
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

        // A prior failed teardown leaves a raw durable marker while `.env.local`
        // may still target that branch. Snapshotting it as the next recording's
        // "real" env would make teardown restore a deleted database URL and then
        // clear the replacement marker. Recover (or refuse) before isolation can
        // take its snapshot.
        if (app.neonTestBranchId) {
          let restored = false;
          try {
            restored = await restoreAppFromTestBranch(app);
          } catch (error) {
            logger.error(
              `App ${appId}: failed to recover the prior test branch before recording: ${error}`,
            );
          }
          if (!restored) {
            return infraResult(
              appId,
              "Dyad couldn't restore this app's real database settings from the previous session. Retry after checking the Neon connection.",
            );
          }
          // Recovery may clear the marker or leave a cleanup-only marker. Give
          // isolation the current row rather than the stale raw branch id.
          app = await getApp(appId);
        }
        // Recovery reaches Neon and can take seconds — the widest window in
        // which Stop can arrive while this start is still invisible to it.
        if (startReservation.cancelled) {
          return cancelledDuringSetup();
        }

        const sessionId = crypto.randomUUID();
        const emit = (message: string) =>
          safeSend(event.sender, "recording:setup-progress", {
            appId,
            message,
          });

        // A recording owns the same resources as a test run for its whole
        // lifecycle (prepare → record → teardown): both swap `.env.local` and
        // restart the dev server, so neither may interleave with the other or
        // with startup reconciliation.
        const recordingResources = [
          readAppResource("app-path"),
          readAppResource("repository-ref"),
          "repository-worktree",
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
        // `destroyed` fires once, and the app lookup and prior-branch recovery
        // above are awaits the window can close during — in which case the
        // listener just registered will never hear it. The flag is state rather
        // than an event, so it still reports an owner that is already gone;
        // without this the session would swap the app onto an isolated database
        // and hold every claim until the 30-minute cap, with no recorder UI
        // anywhere able to end it.
        if (event.sender.isDestroyed?.()) {
          stop("app-stopped");
        }
        const sessionTimer = setTimeout(
          () => stop("timed-out"),
          MAX_SESSION_MS,
        );
        const clearRegistration = () => {
          // Only retire our own entry: teardown can overlap another attempted
          // registration, and its newer owner must survive.
          if (activeRecordings.get(appId)?.stop === stop) {
            activeRecordings.delete(appId);
          }
          clearTimeout(sessionTimer);
          event.sender.removeListener?.("destroyed", onDestroyed);
        };

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
              allowCompatibleQueueBypass: true,
            },
            async () => {
              let prepared: PreparedIsolation | undefined;
              // Set once the preview's storage has been cleared for capture, so
              // teardown knows where this session's credentials ended up.
              let previewOrigin: string | undefined;
              let started = false;
              let endReason: RecordingEndReason = "stopped";
              let endMessage: string | undefined;
              // Whether the throwaway branch/test user this recording created
              // is actually gone. Fails closed for the same reason
              // `envRestored` does: a teardown that never returned has told us
              // nothing, and "unknown" must not read as "cleaned up".
              let remoteCleanupCompleted = true;
              try {
                // The session was already ended before admission — the owning
                // window closed, or Stop was pressed while this waited behind
                // another app operation. Nothing has been swapped yet, so bail
                // before isolation setup rather than preparing a temporary
                // database for a session with no one left to record it.
                if (controller.signal.aborted) {
                  ready.resolve(
                    infraResult(
                      appId,
                      "The recording session ended before its environment was ready.",
                    ),
                  );
                  return;
                }
                // The request can wait behind rename, relocation, or provider
                // work. Re-read only after app-path admission so isolation never
                // snapshots or rewrites the app's former directory/provider.
                const admittedApp = await getApp(appId);
                if (!admittedApp.testingEnabled) {
                  ready.resolve(
                    infraResult(
                      appId,
                      "Testing was disabled while the recording was waiting to start.",
                    ),
                  );
                  return;
                }
                if (
                  admittedApp.neonTestBranchId &&
                  !isTestBranchCleanupOnly(admittedApp.neonTestBranchId)
                ) {
                  ready.resolve(
                    infraResult(
                      appId,
                      "Dyad couldn't restore this app's real database settings from the previous operation. Retry after checking the Neon connection.",
                    ),
                  );
                  return;
                }
                prepared = await prepareIsolatedTestDatabase({
                  app: admittedApp,
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
                  // Remembered before the clear, not after it and not
                  // re-derived at teardown. After it, a clear that throws would
                  // also disable the teardown clear — and this session goes on
                  // to seed a temporary user's credentials under this origin
                  // whether or not the setup clear worked, so the one at the
                  // end is exactly the one that must still run. Re-deriving is
                  // no good either: the app may have been stopped by then.
                  previewOrigin = origin;
                  await clearPreviewStorage(origin);
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
                // Before isolation teardown, which is what deletes the test user
                // this credential belongs to: whichever way that goes, the
                // preview must not be left holding it.
                if (previewOrigin) {
                  try {
                    await clearPreviewStorage(previewOrigin);
                  } catch (error) {
                    logger.error(
                      `Couldn't clear the recording's preview session for app ${appId}; the preview may still hold the temporary test user's credentials: ${error}`,
                    );
                  }
                }
                if (prepared) {
                  // Fail closed for the duration of the call: a teardown that THROWS
                  // has told us nothing about whether `.env.local` came back, and
                  // "unknown" has to fail the same way "no" does or the gate below is
                  // decorative (see `recording_registry`). Only a teardown that
                  // returns gets to say the environment is restored.
                  summary.envRestored = false;
                  try {
                    const teardownResult =
                      await prepared.teardown(teardownOptions);
                    summary.envRestored = teardownResult.envRestored;
                    remoteCleanupCompleted =
                      teardownResult.remoteCleanupCompleted;
                  } catch (error) {
                    remoteCleanupCompleted = false;
                    logger.error(
                      `Recording teardown failed for app ${appId}: ${error}`,
                    );
                  }
                }
                if (!summary.envRestored) {
                  // The app is still pointed at the temporary test branch. The
                  // durable app-row branch id is the relaunch/startup recovery
                  // gate. The recorder bar is the surface still listening, and
                  // this reaches the user as an error toast.
                  endReason = "error";
                  endMessage =
                    "Dyad couldn't restore your app's real database settings after recording. Restore .env.local before running the app again.";
                } else if (!remoteCleanupCompleted) {
                  // The env came back, so the app is usable — but something the
                  // recording created is still in the user's account: a
                  // temporary Neon branch, or a test user in their Supabase
                  // project. The test-run path reports this and the recorder
                  // was silently dropping it, which is how a leak becomes
                  // invisible until the user finds it themselves.
                  endReason = "error";
                  endMessage =
                    "Dyad couldn't finish cleaning up the temporary database it created for this recording. Your app settings were restored; Dyad will retry the cleanup on next startup.";
                }
                clearRegistration();
                // A setup failure normally has no live recorder to notify. The
                // exception is failed teardown: even before capture started,
                // the app may still point at its temporary database branch and
                // the renderer must surface that recovery error.
                if (started || !summary.envRestored) {
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
          .then(
            () => summary,
            (error) => {
              // A deletion fence rejects coordinator admission without invoking
              // the callback above. Settle the IPC ask and retire the provisional
              // registry/timer instead of leaving Record permanently spinning.
              logger.warn(
                `Recording admission was refused for app ${appId}: ${error}`,
              );
              settled = true;
              controller.abort();
              ready.resolve(
                infraResult(
                  appId,
                  "This app is temporarily unavailable. Wait for the current app operation to finish, then try recording again.",
                ),
              );
              clearRegistration();
              return summary;
            },
          );

        activeRecordings.set(appId, { appId, stop, done });

        return ready.promise;
      } finally {
        // Successful setup has already published activeRecordings; every early
        // return or throw must instead make the app immediately startable.
        startReservation.release();
      }
    },
  );

  createTypedHandler(
    recordingContracts.stopRecording,
    async (_event, params) => {
      // Via the registry rather than `activeRecordings` directly: a start still
      // inside its setup awaits owns no published session, so reading the map
      // here would find nothing and report success while that start went on to
      // clear preview storage, swap `.env.local`, and restart the dev server
      // for a session the user has already cancelled. `endRecordingForApp` sets
      // the reservation tombstone the start re-reads after each await.
      await endRecordingForApp(params.appId, "stopped");
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
