import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { previewIframeRefAtom } from "@/atoms/previewAtoms";
import { currentAppUrlAtom } from "@/atoms/previewRuntimeAtoms";
import {
  appendRecordedEntryAtom,
  clearRecordedEntriesForAppAtom,
  currentRecordedEntriesAtom,
  currentRecordingStateAtom,
  recordingStartRequestAtom,
  RECORDING_REQUEST_TTL_MS,
  setRecordingStateForAppAtom,
  type RecordingState,
} from "@/atoms/recorderAtoms";
import { collapseActions } from "@/lib/test_recorder/merge";
import {
  actionToCodeLine,
  recordedBodyStatements,
} from "@/lib/test_recorder/codegen";
import {
  RECORDED_TEST_DRAFT_VERSION,
  type RecordedTestDraft,
} from "@/lib/test_recorder/draft";
import { parseRecorderAction } from "@/lib/test_recorder/types";
import type { RecordingAuth } from "@/ipc/types";

const AUTH_READY_TIMEOUT_MS = 30_000;

/** Convert a preview URL/path to an app-relative path (`/foo?x`). */
function toAppPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const url = new URL(raw, "http://dyad.preview");
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return null;
  }
}

/**
 * Drives a preview recording session: starts isolation + auto sign-in, arms the
 * injected recorder, and buffers observed actions.
 *
 * Stopping does NOT write a file. It hands the collapsed actions to the main
 * process as a draft and moves to the review phase, where the user sees the
 * steps and can ask for assertions. The spec is generated later — from that
 * same draft — either by approving the assertion card or by saving as-is.
 *
 * Incoming iframe messages (recorder actions, auth readiness, SPA navigations)
 * are handled here so the Record UI stays thin. Meant to be mounted once inside
 * the preview panel.
 */
export function useTestRecorder({
  reloadPreview,
}: {
  /** Remount the iframe so authentication always starts in a live document. */
  reloadPreview: () => void;
}) {
  const appId = useAtomValue(selectedAppIdAtom);
  const iframeEl = useAtomValue(previewIframeRefAtom);
  const appUrl = useAtomValue(currentAppUrlAtom).appUrl;
  const recordingState = useAtomValue(currentRecordingStateAtom);
  const entries = useAtomValue(currentRecordedEntriesAtom);
  const startRequest = useAtomValue(recordingStartRequestAtom);

  const setStartRequest = useSetAtom(recordingStartRequestAtom);
  const setRecordingState = useSetAtom(setRecordingStateForAppAtom);
  const appendEntry = useSetAtom(appendRecordedEntryAtom);
  const clearEntries = useSetAtom(clearRecordedEntriesForAppAtom);
  const queryClient = useQueryClient();

  // Refs so the stable message listener/callbacks read live values.
  const iframeElRef = useRef(iframeEl);
  const phaseRef = useRef(recordingState.phase);
  const stateRef = useRef(recordingState);
  const entriesRef = useRef(entries);
  const appIdRef = useRef(appId);
  const appUrlRef = useRef(appUrl);
  const authReadyRef = useRef<
    ((data: { ok?: boolean; error?: string }) => void) | null
  >(null);
  // The auth to (re)send while we're waiting for the in-iframe sign-in; set for
  // the duration of `authenticate` so a bootstrap that (re)loads mid-flow can be
  // handed the credentials as soon as it announces itself. Tagged with the app it
  // belongs to: the iframe ref follows the *selected* app, so an unqualified
  // resend would hand one app's test credentials to another app's preview.
  // `nonce` names this sign-in attempt. The bootstrap's own state has to cross a
  // document navigation via sessionStorage, which outlives the attempt, so it
  // reports back which attempt its leftover marker came from and we answer with
  // the one we're actually waiting on.
  const pendingAuthRef = useRef<{
    appId: number;
    auth: RecordingAuth;
    nonce: string;
  } | null>(null);
  // Apps whose main-process session this hook started and hasn't stopped yet.
  // The session outlives the renderer's state (it holds an isolated database and
  // the per-app lock), so every path that walks away from one — an app switch, a
  // preview unmount — has to hand it back explicitly.
  const ownedSessionsRef = useRef(new Set<number>());
  // Distinguishes a real unmount from the app-change re-run of the release
  // effect below. `startRecording` consults it after each await: refs survive
  // unmount, so an app-id comparison alone still looks satisfied.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    iframeElRef.current = iframeEl;
  }, [iframeEl]);
  useEffect(() => {
    phaseRef.current = recordingState.phase;
    stateRef.current = recordingState;
  }, [recordingState]);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    appIdRef.current = appId;
  }, [appId]);
  useEffect(() => {
    appUrlRef.current = appUrl;
  }, [appUrl]);

  // Collapse the raw stream into what the spec will actually replay: typing
  // "hello" arrives as five growing fills but becomes one step. Drives both the
  // step count and the live code the recording banner shows.
  const collapsedActions = useMemo(() => collapseActions(entries), [entries]);
  const entryCount = collapsedActions.length;
  // The Playwright statement generated for each collapsed step, in order. The
  // last entry is the most recent action the user performed.
  const steps = useMemo(
    () => collapsedActions.map(actionToCodeLine),
    [collapsedActions],
  );

  const postToIframe = useCallback((message: unknown, targetOrigin = "*") => {
    iframeElRef.current?.contentWindow?.postMessage(message, targetOrigin);
  }, []);

  // Credentials must only be delivered to the running app's own origin. Pinning
  // the targetOrigin means a preview that has navigated cross-origin (an
  // external link, an OAuth redirect) can never receive the test user's login.
  // Falls back to "*" only when the app URL isn't known yet (never during an
  // active session, since recording requires the dev server to be running).
  const previewOrigin = useCallback(() => {
    const url = appUrlRef.current;
    if (url) {
      try {
        return new URL(url).origin;
      } catch {
        // fall through to the wildcard
      }
    }
    return "*";
  }, []);

  const patchState = useCallback(
    (
      targetAppId: number,
      update: RecordingState | ((prev: RecordingState) => RecordingState),
    ) => setRecordingState({ appId: targetAppId, update }),
    [setRecordingState],
  );

  // Handle messages coming up from the preview iframe.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const iframe = iframeElRef.current;
      if (!iframe || e.source !== iframe.contentWindow) return;
      const data = e.data as { type?: string; [k: string]: unknown };
      if (!data || typeof data.type !== "string") return;
      const currentAppId = appIdRef.current;

      switch (data.type) {
        case "dyad-recorder-action": {
          if (phaseRef.current !== "recording" || currentAppId == null) return;
          const action = parseRecorderAction(data.action);
          if (action) {
            appendEntry({
              appId: currentAppId,
              entry: { action, at: Date.now() },
            });
          }
          break;
        }
        case "dyad-recorder-initialized": {
          // Re-arm after a dev-server restart / HMR reload swapped the iframe.
          if (phaseRef.current === "recording") {
            postToIframe({ type: "activate-dyad-recorder" });
          }
          break;
        }
        case "dyad-auth-bootstrap-ready": {
          // The (possibly reloaded/restarted) bootstrap is listening — hand it
          // the credentials. This closes the race where our first send lands in
          // the gap during a dev-server restart and would otherwise be lost.
          // Only for the app the credentials were minted for: after an app
          // switch this iframe belongs to someone else.
          const pending = pendingAuthRef.current;
          if (pending && pending.appId === currentAppId) {
            postToIframe(
              {
                type: "dyad-auth-login",
                auth: pending.auth,
                nonce: pending.nonce,
              },
              previewOrigin(),
            );
          }
          break;
        }
        case "dyad-auth-ready": {
          authReadyRef.current?.({
            ok: Boolean(data.ok),
            error: typeof data.error === "string" ? data.error : undefined,
          });
          break;
        }
        case "pushState":
        case "replaceState": {
          if (phaseRef.current !== "recording" || currentAppId == null) return;
          // The shim (and the auth bootstrap) nest history changes under
          // `payload`, unlike every other message this handler consumes.
          const payload = data.payload as { newUrl?: unknown } | undefined;
          const path = toAppPath(payload?.newUrl);
          if (path) {
            appendEntry({
              appId: currentAppId,
              entry: { action: { kind: "navigate", path }, at: Date.now() },
            });
          }
          break;
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [appendEntry, postToIframe, previewOrigin]);

  // Reset the UI if a session ends outside our control (app stopped / crash /
  // hitting the session cap). A failure reason is surfaced as a toast — the
  // recording bar unmounts on idle, so a state field alone would go unseen.
  useEffect(() => {
    const unsub = ipc.events.recording.onEnded(
      ({ appId: endedAppId, reason, message }) => {
        if (endedAppId == null) return;
        ownedSessionsRef.current.delete(endedAppId);
        const failureMessage =
          reason === "error" || reason === "timed-out"
            ? (message ?? "The recording session ended unexpectedly.")
            : undefined;
        // The user-driven stops (stopAndReview / cancelRecording) disarm the
        // in-page recorder themselves. On every other ending the iframe is
        // usually still alive, so without this the injected client keeps its
        // capture-phase listeners attached and keeps painting the red hover
        // highlight — with no recording bar left to explain it.
        if (reason !== "stopped" && endedAppId === appIdRef.current) {
          postToIframe({ type: "deactivate-dyad-recorder" });
        }
        patchState(endedAppId, (prev) =>
          prev.phase === "idle"
            ? prev
            : { phase: "idle", error: failureMessage },
        );
        if (failureMessage) showError(failureMessage);
      },
    );
    return unsub;
  }, [patchState, postToIframe]);

  /**
   * Hand a still-running session back to the main process and reset the app's
   * recorder state. Used when we're walking away from a session rather than
   * finishing it: only apps in `ownedSessionsRef` are touched, so a captured
   * draft in review is never disturbed.
   */
  const releaseSession = useCallback(
    (targetAppId: number) => {
      if (!ownedSessionsRef.current.delete(targetAppId)) return;
      if (pendingAuthRef.current?.appId === targetAppId) {
        pendingAuthRef.current = null;
        authReadyRef.current = null;
      }
      if (targetAppId === appIdRef.current) {
        postToIframe({ type: "deactivate-dyad-recorder" });
      }
      void ipc.recording.stopRecording({ appId: targetAppId }).catch(() => {});
      clearEntries(targetAppId);
      patchState(targetAppId, { phase: "idle" });
    },
    [clearEntries, patchState, postToIframe],
  );

  // A recording only exists while the preview that can stop it is on screen.
  // Switching to the Code tab, or to another app, unmounts (or re-points) this
  // hook and would otherwise leave the main-process session alive until the
  // 30-minute cap: the app keeps serving the isolated test database and keeps
  // rejecting test runs and further recordings, with no UI left to end it.
  useEffect(() => {
    return () => {
      // Snapshot: releaseSession removes from the set as it goes.
      for (const owned of Array.from(ownedSessionsRef.current)) {
        releaseSession(owned);
      }
    };
  }, [appId, releaseSession]);

  // (Re)activate the in-page recorder whenever we're in the recording phase.
  // The activate posted inside startRecording can be lost if the iframe is
  // mid-load (fresh load after auth / dev-server restart); this effect plus the
  // re-arm on `dyad-recorder-initialized` make activation reliable. The client
  // treats repeat activations as no-ops.
  useEffect(() => {
    if (recordingState.phase === "recording") {
      postToIframe({ type: "activate-dyad-recorder" });
    }
  }, [recordingState.phase, postToIframe]);

  // Surface isolation/sign-in setup progress.
  useEffect(() => {
    const unsub = ipc.events.recording.onSetupProgress(
      ({ appId: progressAppId, message }) => {
        if (progressAppId == null) return;
        patchState(progressAppId, (prev) =>
          prev.phase === "idle" ? prev : { ...prev, progress: message.trim() },
        );
      },
    );
    return unsub;
  }, [patchState]);

  const authenticate = useCallback(
    (targetAppId: number, auth: RecordingAuth) =>
      new Promise<{ ok: boolean; error?: string }>((resolve) => {
        let done = false;
        const finish = (ok: boolean, error?: string) => {
          if (done) return;
          done = true;
          pendingAuthRef.current = null;
          authReadyRef.current = null;
          clearTimeout(timer);
          resolve({ ok, error });
        };
        const timer = setTimeout(
          () => finish(false, "timed out waiting for the preview to sign in"),
          AUTH_READY_TIMEOUT_MS,
        );
        // Register the creds FIRST so the fresh load's bootstrap announce
        // triggers a (re)send, then force that fresh load. Also post directly
        // for the case where the current page is alive and listening.
        const nonce = crypto.randomUUID();
        pendingAuthRef.current = { appId: targetAppId, auth, nonce };
        authReadyRef.current = (result) =>
          finish(Boolean(result.ok), result.error);
        reloadPreview();
        postToIframe({ type: "dyad-auth-login", auth, nonce }, previewOrigin());
      }),
    [postToIframe, previewOrigin, reloadPreview],
  );

  const startRecording = useCallback(async () => {
    const targetAppId = appId;
    if (targetAppId == null) return;

    clearEntries(targetAppId);
    patchState(targetAppId, {
      phase: "starting",
      progress: "Setting up an isolated recording environment…",
    });

    let result;
    try {
      result = await ipc.recording.startRecording({ appId: targetAppId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      patchState(targetAppId, { phase: "idle", error: message });
      showError(message);
      return;
    }

    if (result.infraError) {
      patchState(targetAppId, {
        phase: "idle",
        isolation: result.isolation,
        error: result.infraError.message,
      });
      showError(result.infraError.message);
      return;
    }

    ownedSessionsRef.current.add(targetAppId);
    // Everything below reaches the preview through refs that track the
    // *selected* app (the iframe, its URL, its origin). If the user switched
    // apps while isolation was being set up, continuing would reload and sign
    // the wrong preview in with this app's test credentials, then arm it — while
    // this app's session stayed alive, locked, and invisible. Bail instead, and
    // give the session back. Same for a preview that unmounted while we waited.
    if (!mountedRef.current || appIdRef.current !== targetAppId) {
      releaseSession(targetAppId);
      return;
    }

    let auth = result.auth;
    patchState(targetAppId, (prev) => ({
      ...prev,
      isolation: result.isolation,
      warning: result.isolation.reason,
      auth,
      progress: undefined,
    }));

    if (auth.mode !== "none") {
      patchState(targetAppId, (prev) => ({
        ...prev,
        phase: "authenticating",
        progress: "Signing in the test user…",
      }));
      const signIn = await authenticate(targetAppId, auth);
      // Sign-in waits up to 30s for the preview to announce itself — plenty of
      // room for the selection to move on, or for the preview to go away.
      if (!mountedRef.current || appIdRef.current !== targetAppId) {
        releaseSession(targetAppId);
        return;
      }
      if (!signIn.ok) {
        // Sign-in failed: record unauthenticated (and don't emit signIn), so
        // the flow degrades gracefully instead of dead-ending.
        auth = { mode: "none" };
        patchState(targetAppId, (prev) => ({
          ...prev,
          auth,
          warning: `Couldn't sign in automatically${
            signIn.error ? ` (${signIn.error})` : ""
          } — recording without authentication.`,
        }));
      }
    } else {
      // No auth to establish, but still start from a fresh load so the preview
      // reflects the isolated database and the cleared storage (and, after a
      // Neon restart, isn't stuck on a dead page).
      reloadPreview();
    }

    postToIframe({ type: "activate-dyad-recorder" });
    patchState(targetAppId, (prev) => ({
      ...prev,
      phase: "recording",
      progress: undefined,
      startedAt: Date.now(),
    }));
  }, [
    appId,
    authenticate,
    clearEntries,
    patchState,
    postToIframe,
    releaseSession,
    reloadPreview,
  ]);

  /**
   * End the session and capture what was recorded as a draft — no file is
   * written. The draft is parked in the main process so the agent's
   * `generate_test_assertions` tool can propose against the real statements,
   * and kept here so the review UI can list the steps.
   */
  const stopAndReview = useCallback(
    async (testName: string): Promise<RecordedTestDraft | null> => {
      const targetAppId = appId;
      if (targetAppId == null) return null;

      // We're finishing this session ourselves, so the unmount/app-switch
      // safety net must not also try to stop it.
      ownedSessionsRef.current.delete(targetAppId);
      patchState(targetAppId, (prev) => ({ ...prev, phase: "finishing" }));
      postToIframe({ type: "deactivate-dyad-recorder" });

      const auth = stateRef.current.auth ?? { mode: "none" };
      const draft: RecordedTestDraft = {
        version: RECORDED_TEST_DRAFT_VERSION,
        testName: testName.trim() || "recorded test",
        authMode: auth.mode,
        actions: collapseActions(entriesRef.current),
      };

      try {
        await ipc.recording.saveRecordedTestDraft({
          appId: targetAppId,
          draft,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showError(`Couldn't keep the recording: ${message}`);
        await ipc.recording
          .stopRecording({ appId: targetAppId })
          .catch(() => {});
        clearEntries(targetAppId);
        patchState(targetAppId, { phase: "idle" });
        return null;
      }

      // Teardown (dropping the Neon branch / removing the Supabase test user)
      // takes seconds; hold the "finishing" spinner until it's done so the
      // review UI doesn't appear over a half-torn-down session.
      await ipc.recording.stopRecording({ appId: targetAppId }).catch(() => {});

      // The draft owns the actions from here on.
      clearEntries(targetAppId);
      patchState(targetAppId, { phase: "reviewing", draft });
      return draft;
    },
    [appId, clearEntries, patchState, postToIframe],
  );

  /**
   * Generate the spec from the draft as recorded, skipping the assertion pass.
   * The escape hatch for "I just want the steps" — same deterministic codegen
   * the approval path uses.
   */
  const saveWithoutAssertions = useCallback(async (): Promise<
    string | null
  > => {
    const targetAppId = appId;
    const draft = stateRef.current.draft;
    if (targetAppId == null || !draft) return null;

    patchState(targetAppId, (prev) => ({ ...prev, phase: "saving" }));
    try {
      const { specPath } = await ipc.tests.createRecordedSpec({
        appId: targetAppId,
        draft,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.tests.list({ appId: targetAppId }),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.appFiles.all });
      patchState(targetAppId, { phase: "saved", savedSpecPath: specPath });
      showSuccess(`Saved ${specPath}`);
      return specPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showError(`Couldn't save the recorded test: ${message}`);
      // Back to review so the recording isn't lost to a failed write.
      patchState(targetAppId, (prev) => ({ ...prev, phase: "reviewing" }));
      return null;
    }
  }, [appId, patchState, queryClient]);

  /** Close the bar, keeping the parked draft (the chat card still needs it). */
  const dismissReview = useCallback(() => {
    if (appId == null) return;
    patchState(appId, { phase: "idle" });
  }, [appId, patchState]);

  /** Throw the recording away without generating anything. */
  const discardDraft = useCallback(async () => {
    const targetAppId = appId;
    if (targetAppId == null) return;
    patchState(targetAppId, { phase: "idle" });
    await ipc.recording
      .discardRecordedTestDraft({ appId: targetAppId })
      .catch(() => {});
  }, [appId, patchState]);

  const cancelRecording = useCallback(async () => {
    const targetAppId = appId;
    if (targetAppId == null) return;
    ownedSessionsRef.current.delete(targetAppId);
    postToIframe({ type: "deactivate-dyad-recorder" });
    void ipc.recording
      .discardRecordedTestDraft({ appId: targetAppId })
      .catch(() => {});
    // stopRecording resolves only once isolation teardown finishes (dropping a
    // Neon branch / removing the Supabase test user takes seconds), so hold a
    // visible "stopping" phase instead of leaving the bar up with no feedback.
    patchState(targetAppId, (prev) => ({ ...prev, phase: "stopping" }));
    await ipc.recording.stopRecording({ appId: targetAppId }).catch(() => {});
    clearEntries(targetAppId);
    patchState(targetAppId, { phase: "idle" });
  }, [appId, clearEntries, patchState, postToIframe]);

  // Honor a "record" click made outside the preview (the Tests panel entry
  // point), which switches to the preview tab and leaves the request behind for
  // this hook to consume once it mounts.
  useEffect(() => {
    if (!startRequest || appId == null) return;
    const isStale =
      Date.now() - startRequest.requestedAt > RECORDING_REQUEST_TTL_MS;
    if (startRequest.appId !== appId) {
      // Only drop another app's request once it can no longer be honored, so
      // switching apps mid-request doesn't cancel an in-flight ask.
      if (isStale) setStartRequest(null);
      return;
    }
    setStartRequest(null);
    if (isStale || phaseRef.current !== "idle") return;
    void startRecording();
  }, [appId, setStartRequest, startRecording, startRequest]);

  // The statements the draft will replay, numbered exactly as the assertion
  // tool numbers them — so what the review list shows is what the model is
  // asked about and what ends up in the file.
  const draft = recordingState.draft;
  const draftSteps = useMemo(
    () => (draft ? recordedBodyStatements(draft) : []),
    [draft],
  );

  return {
    phase: recordingState.phase,
    isolation: recordingState.isolation,
    auth: recordingState.auth,
    warning: recordingState.warning,
    progress: recordingState.progress,
    error: recordingState.error,
    draft,
    draftSteps,
    savedSpecPath: recordingState.savedSpecPath,
    entryCount,
    steps,
    isRecording: recordingState.phase === "recording",
    isBusy:
      recordingState.phase === "starting" ||
      recordingState.phase === "authenticating" ||
      recordingState.phase === "finishing" ||
      recordingState.phase === "saving" ||
      recordingState.phase === "stopping",
    startRecording,
    stopAndReview,
    saveWithoutAssertions,
    cancelRecording,
    dismissReview,
    discardDraft,
  };
}

export type TestRecorderController = ReturnType<typeof useTestRecorder>;
