import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";

import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { previewIframeRefAtom } from "@/atoms/previewAtoms";
import { useCurrentAppUrl } from "@/hooks/useAppRun";
import {
  appendRecordedEntryAtom,
  clearRecordedEntriesForAppAtom,
  currentRecordedEntriesAtom,
  currentRecordingStateAtom,
  MAX_RECORDED_ENTRIES,
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
  normalizeTestName,
  RECORDED_TEST_DRAFT_VERSION,
  type RecordedTestDraft,
} from "@/lib/test_recorder/draft";
import { parseRecorderAction } from "@/lib/test_recorder/types";
import type { RecordingAuth } from "@/ipc/types";

const AUTH_READY_TIMEOUT_MS = 30_000;

/**
 * How long to wait for the reloaded preview document to announce its recorder
 * client before arming anyway.
 *
 * Bounded rather than open-ended: a document that never announces (an app that
 * fails to load, a proxy that didn't inject the client) must still leave the
 * user with a bar they can stop, not a start that hangs. Arming a document that
 * isn't listening costs nothing — the re-arm on `dyad-recorder-initialized`
 * still catches it whenever it does load.
 */
const RECORDER_READY_TIMEOUT_MS = 5_000;

/** One `startRecording` in flight. Cancelled when the recorder walks away. */
interface StartAttempt {
  cancelled: boolean;
}

/**
 * Drives a preview recording session: starts isolation + auto sign-in, arms the
 * injected recorder, and buffers observed actions. Mount once, in the preview
 * panel.
 *
 * Stopping does NOT write a file — it parks the collapsed actions as a draft and
 * moves to the review phase. The spec is generated later from that same draft,
 * by approving the test proposal the agent puts in the chat.
 */
export function useTestRecorder({
  reloadPreview,
}: {
  /** Remount the iframe so authentication always starts in a live document. */
  reloadPreview: () => void;
}) {
  const appId = useAtomValue(selectedAppIdAtom);
  const iframeEl = useAtomValue(previewIframeRefAtom);
  const appUrl = useCurrentAppUrl(appId).appUrl;
  const recordingState = useAtomValue(currentRecordingStateAtom);
  const entries = useAtomValue(currentRecordedEntriesAtom);
  const startRequest = useAtomValue(recordingStartRequestAtom);

  const setStartRequest = useSetAtom(recordingStartRequestAtom);
  const setRecordingState = useSetAtom(setRecordingStateForAppAtom);
  const appendEntry = useSetAtom(appendRecordedEntryAtom);
  const clearEntries = useSetAtom(clearRecordedEntriesForAppAtom);

  // Refs so the stable message listener/callbacks read live values.
  const iframeElRef = useRef(iframeEl);
  const phaseRef = useRef(recordingState.phase);
  const stateRef = useRef(recordingState);
  const entriesRef = useRef(entries);
  const appIdRef = useRef(appId);
  const appUrlRef = useRef(appUrl);
  // Isolation setup restarts the dev server, emptying the app URL until the new
  // one arrives — a gap the sign-in handshake runs straight through. The live
  // URL always wins; this only stands in while there is none, and is dropped on
  // an app switch.
  const lastPreviewOriginRef = useRef<string | null>(null);
  const authReadyRef = useRef<
    ((data: { ok?: boolean; error?: string }) => void) | null
  >(null);
  // Settled by the `dyad-recorder-initialized` of the document the recording is
  // about to be armed in. Tagged with its app because the iframe ref follows the
  // *selected* app: an announce from a preview the user switched to must not be
  // read as this app's preview being ready.
  const recorderReadyRef = useRef<{
    appId: number;
    resolve: () => void;
  } | null>(null);
  // The auth to (re)send while waiting for the in-iframe sign-in, so a bootstrap
  // that reloads mid-flow can be handed the credentials as soon as it announces
  // itself. Tagged with its app: the iframe ref follows the *selected* app, so an
  // unqualified resend would leak one app's test credentials to another's
  // preview. `nonce` names the attempt — the bootstrap's marker crosses a
  // navigation via sessionStorage, which outlives the attempt.
  const pendingAuthRef = useRef<{
    appId: number;
    auth: RecordingAuth;
    nonce: string;
  } | null>(null);
  // Apps whose main-process session this hook started and hasn't stopped. The
  // session outlives the renderer's state (it holds an isolated database and the
  // per-app lock), so every path that walks away has to hand it back explicitly.
  const ownedSessionsRef = useRef(new Set<number>());
  // The main-process session id per app, so an ending that belongs to a session
  // this hook has already replaced can be told apart from its successor's.
  // Teardown takes seconds, which is long enough for the next session to be
  // recording by the time the previous one reports back.
  const sessionIdsRef = useRef(new Map<number, string>());
  // Apps with a start in flight but no session handed back yet — the window
  // `ownedSessionsRef` can't cover, since isolation setup takes seconds. The
  // main process registers the session (per-app lock, temporary database
  // environment) as soon as the request arrives, so this window still has
  // something to hand back; the attempt object is its identity, and marking it
  // cancelled is what tells the start to walk away when it finally returns.
  const startingAppsRef = useRef(new Map<number, StartAttempt>());
  // Sessions that ended in a failure the user has already been shown, keyed by
  // app and carrying the session it belonged to. `recording:ended` and the
  // `stopRecording` reply travel different IPC interfaces, so the error can land
  // first and be overwritten by the review that follows — leaving the user in
  // front of a recording to approve with no sign that isolation teardown left
  // their environment broken.
  //
  // The session id matters because teardown takes seconds: a late failure from a
  // session the user has already replaced must not cancel the replacement's
  // review. `undefined` means the ending didn't name a session, which is
  // consumed by whoever asks — an unattributable failure fails closed.
  const failedSessionsRef = useRef(new Map<number, string | undefined>());
  // Distinguishes a real unmount from the app-change re-run of the release effect
  // below; refs survive unmount, so an app-id comparison alone still looks
  // satisfied. Re-armed in the effect body because StrictMode's dev
  // mount/unmount/remount replay runs the cleanup on a still-mounted hook.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
    // Another app's preview must never be trusted on the strength of this one.
    lastPreviewOriginRef.current = null;
  }, [appId]);
  useEffect(() => {
    appUrlRef.current = appUrl;
    // Captured as the URL arrives, not when first read: the restart gap can open
    // before anything has had reason to ask for the origin.
    if (!appUrl) return;
    try {
      lastPreviewOriginRef.current = new URL(appUrl).origin;
    } catch {
      // Not a URL we can pin to an origin; leave the previous one in place.
    }
  }, [appUrl]);

  // Collapse the raw stream into what the spec will actually replay: typing
  // "hello" arrives as five growing fills but becomes one step.
  const collapsedActions = useMemo(() => collapseActions(entries), [entries]);
  const entryCount = collapsedActions.length;
  const steps = useMemo(
    () => collapsedActions.map(actionToCodeLine),
    [collapsedActions],
  );

  const postToIframe = useCallback((message: unknown, targetOrigin = "*") => {
    iframeElRef.current?.contentWindow?.postMessage(message, targetOrigin);
  }, []);

  /**
   * Append one action while recording, or drop it. Everything the recorder
   * captures goes through `parseRecorderAction` — including what the renderer
   * synthesizes — so what may become a statement in the user's repo is decided
   * in one place.
   */
  const record = useCallback(
    (candidate: unknown): "recorded" | "rejected" | "not-recording" => {
      const targetAppId = appIdRef.current;
      if (phaseRef.current !== "recording" || targetAppId == null) {
        return "not-recording";
      }
      const action = parseRecorderAction(candidate);
      if (!action) return "rejected";
      appendEntry({
        appId: targetAppId,
        entry: { action, at: Date.now() },
      });
      return "recorded";
    },
    [appendEntry],
  );

  /**
   * Record a `page.goto` for a navigation the user made in Dyad's own chrome:
   * an app-relative path typed into the preview address bar or picked from its
   * routes dropdown.
   *
   * This and `recordHistoryMove` are the ONLY things that produce a navigation
   * step. The app routing itself doesn't: a click that navigates is already in
   * the spec as the click, and following it with `page.goto` would send the test
   * to the destination whether or not the click ever got there — masking the
   * exact regression the test exists to catch. A jump the user made *around* the
   * app has no such step to hang off, so it has to be replayed as one.
   */
  const recordNavigation = useCallback(
    (path: string) => {
      // Only a rejection is worth saying out loud: a navigation made while
      // nothing is recording is just the user browsing their app.
      if (record({ kind: "navigate", path }) === "rejected") {
        console.warn(
          "Recorder ignored a navigation that resolves outside the app",
        );
      }
    },
    [record],
  );

  /** Record the preview's back/forward buttons as the history moves they are. */
  const recordHistoryMove = useCallback(
    (direction: "back" | "forward") => {
      record({ kind: direction });
    },
    [record],
  );

  // Credentials must only reach the running app's own origin: a preview that has
  // navigated cross-origin (an external link, an OAuth redirect) can never
  // receive the test user's login. Returns "*" only before the dev server has
  // ever come up, which is before any session can exist.
  const previewOrigin = useCallback(() => {
    const url = appUrlRef.current;
    if (url) {
      try {
        return new URL(url).origin;
      } catch {
        // fall through to the remembered origin
      }
    }
    return lastPreviewOriginRef.current ?? "*";
  }, []);

  const patchState = useCallback(
    (
      targetAppId: number,
      update: RecordingState | ((prev: RecordingState) => RecordingState),
    ) => setRecordingState({ appId: targetAppId, update }),
    [setRecordingState],
  );

  /**
   * Settle a sign-in this app is still waiting on, rather than just forgetting
   * it.
   *
   * `authenticate` otherwise resolves only on its 30-second timeout, and
   * `beginRecording` stays parked on that await — holding the app's entry in
   * `startingAppsRef`, which is what refuses a fresh start. Every path that
   * walks away from a recording has to release the next one immediately.
   *
   * Declared above the `recording:ended` subscription because that effect lists
   * it as a dependency, and a dependency array is evaluated during render.
   */
  const settlePendingAuth = useCallback(
    (targetAppId: number, error: string) => {
      if (pendingAuthRef.current?.appId !== targetAppId) return;
      pendingAuthRef.current = null;
      const pendingAuthReady = authReadyRef.current;
      authReadyRef.current = null;
      pendingAuthReady?.({ ok: false, error });
    },
    [],
  );

  // Handle messages coming up from the preview iframe.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const iframe = iframeElRef.current;
      if (!iframe || e.source !== iframe.contentWindow) return;
      // `e.source` alone is not authentication: the iframe's WindowProxy keeps
      // its identity across navigations, so a preview that followed an external
      // link would still look like our own document and could forge recorder
      // actions. Fail closed when the app's own origin isn't known.
      const expectedOrigin = previewOrigin();
      if (expectedOrigin === "*" || e.origin !== expectedOrigin) return;
      const data = e.data as { type?: string; [k: string]: unknown };
      if (!data || typeof data.type !== "string") return;
      const currentAppId = appIdRef.current;

      switch (data.type) {
        case "dyad-recorder-action": {
          record(data.action);
          break;
        }
        case "dyad-recorder-initialized": {
          // The document a start is waiting on has come up; let it arm.
          const waiting = recorderReadyRef.current;
          if (waiting && waiting.appId === currentAppId) {
            recorderReadyRef.current = null;
            waiting.resolve();
          }
          // Re-arm after a dev-server restart / HMR reload swapped the iframe.
          if (phaseRef.current === "recording") {
            postToIframe({ type: "activate-dyad-recorder" });
          }
          break;
        }
        case "dyad-auth-bootstrap-ready": {
          // Closes the race where our first send lands in the dev-server restart
          // gap. Only for the app the credentials were minted for: after an app
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
          // Only the attempt we're waiting on may settle it: a sign-in that timed
          // out can still report back, and without the nonce that stale
          // completion would advance the *next* attempt to "recording" with
          // credentials that were never established.
          const pending = pendingAuthRef.current;
          if (!pending || data.nonce !== pending.nonce) break;
          authReadyRef.current?.({
            ok: Boolean(data.ok),
            error: typeof data.error === "string" ? data.error : undefined,
          });
          break;
        }
        // The app's own routing (`pushState`/`replaceState` from the shim) is
        // deliberately NOT recorded — see `recordNavigation`.
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [postToIframe, previewOrigin, record]);

  // Reset the UI if a session ends outside our control (app stopped / crash /
  // session cap) — and only then. Failures are toasted: the recording bar
  // unmounts on idle, so a state field alone would go unseen.
  useEffect(() => {
    const unsub = ipc.events.recording.onEnded(
      ({ appId: endedAppId, sessionId, reason, message }) => {
        if (endedAppId == null) return;
        // Endings are delivered per app, but teardown is slow enough that a
        // *new* session for the same app can already be recording by the time
        // the old one reports. Only the current session may reset the UI.
        const currentSessionId = sessionIdsRef.current.get(endedAppId);
        if (sessionId && currentSessionId && sessionId !== currentSessionId) {
          return;
        }
        // "stopped" is only reported for a stop we asked for, and whichever path
        // asked already owns what comes next. This event travels a different IPC
        // interface than the stopRecording reply, so it can land *after* the
        // review is on screen and wipe it.
        //
        // Ownership is released after this check, not before: this event can land
        // after a *new* session for the same app has started, and dropping that
        // session's ownership would leave nothing to stop it on unmount.
        if (reason === "stopped") return;
        ownedSessionsRef.current.delete(endedAppId);
        sessionIdsRef.current.delete(endedAppId);
        // The session is gone, so a sign-in still waiting on the iframe will
        // never be answered. Settle it now rather than letting `beginRecording`
        // sit on the 30-second timeout — that await is what holds the app's
        // entry in `startingAppsRef`, which refuses a fresh recording.
        settlePendingAuth(endedAppId, "the session ended");
        const failureMessage =
          reason === "error" || reason === "timed-out"
            ? (message ?? "The recording session ended unexpectedly.")
            : undefined;
        // The iframe is usually still alive on these endings, so without this the
        // injected client keeps painting the hover highlight with no recording
        // bar left to explain it. (User-driven stops disarm it themselves.)
        if (endedAppId === appIdRef.current) {
          postToIframe({ type: "deactivate-dyad-recorder" });
        }
        patchState(endedAppId, (prev) =>
          prev.phase === "idle"
            ? prev
            : { phase: "idle", error: failureMessage },
        );
        if (failureMessage) {
          failedSessionsRef.current.set(endedAppId, sessionId);
          showError(failureMessage);
        }
      },
    );
    return unsub;
  }, [patchState, postToIframe, settlePendingAuth]);

  /**
   * Ask the main process to end this app's session and reset the app's recorder
   * state. Safe to call for a session we were never handed: stopping one that
   * doesn't exist is a no-op, and a start still preparing isolation has already
   * registered one.
   */
  const endSession = useCallback(
    (targetAppId: number) => {
      sessionIdsRef.current.delete(targetAppId);
      settlePendingAuth(targetAppId, "the session ended");
      if (targetAppId === appIdRef.current) {
        postToIframe({ type: "deactivate-dyad-recorder" });
      }
      void ipc.recording.stopRecording({ appId: targetAppId }).catch(() => {});
      clearEntries(targetAppId);
      patchState(targetAppId, { phase: "idle" });
    },
    [clearEntries, patchState, postToIframe, settlePendingAuth],
  );

  /**
   * Hand a still-running session back, for when we're walking away rather than
   * finishing. Only apps in `ownedSessionsRef` are touched, so a draft in review
   * is never disturbed.
   */
  const releaseSession = useCallback(
    (targetAppId: number) => {
      if (!ownedSessionsRef.current.delete(targetAppId)) return;
      endSession(targetAppId);
    },
    [endSession],
  );

  /**
   * Abandon a start that hasn't handed its session back yet. The request is in
   * flight, but the main process registered the session — lock, temporary
   * database environment and all — the moment it arrived, so stopping now is
   * what keeps it from outliving the UI that could have ended it.
   */
  const cancelStart = useCallback(
    (targetAppId: number, attempt: StartAttempt) => {
      if (attempt.cancelled) return;
      // Read by `beginRecording` when the request finally returns: whatever it
      // is handed by then belongs to a session that is already being torn down.
      attempt.cancelled = true;
      endSession(targetAppId);
    },
    [endSession],
  );

  // A recording only exists while the preview that can stop it is on screen.
  // Otherwise the main-process session stays alive until the 30-minute cap,
  // serving the isolated test database and rejecting runs, with no UI to end it.
  useEffect(() => {
    return () => {
      // Snapshot: releaseSession removes from the set as it goes.
      for (const owned of Array.from(ownedSessionsRef.current)) {
        releaseSession(owned);
      }
      // A start in flight owns nothing yet, so the loop above can't see it — but
      // the session it is preparing is just as real. Every in-flight start is
      // considered, not just the selected app's: the one being walked away from
      // is whichever app is no longer selected.
      //
      // Decided a task later because this same cleanup runs on StrictMode's dev
      // mount/unmount/remount replay, where nothing is being walked away from:
      // by then the remount has re-armed `mountedRef` and an app switch has
      // moved `appIdRef` on, which is what tells the two apart.
      for (const [startingAppId, attempt] of startingAppsRef.current) {
        queueMicrotask(() => {
          if (mountedRef.current && appIdRef.current === startingAppId) return;
          cancelStart(startingAppId, attempt);
        });
      }
    };
  }, [appId, cancelStart, releaseSession]);

  // The activate posted inside startRecording can be lost if the iframe is
  // mid-load; this effect plus the re-arm on `dyad-recorder-initialized` make
  // activation reliable. The client treats repeat activations as no-ops.
  useEffect(() => {
    if (recordingState.phase === "recording") {
      postToIframe({ type: "activate-dyad-recorder" });
    }
  }, [recordingState.phase, postToIframe]);

  // The assertions card in the chat approved the draft. Close the bar: its
  // remaining actions all act on a recording that has already been written, and
  // taking one up would produce a second copy of the same test.
  useEffect(() => {
    const unsub = ipc.events.recording.onDraftConsumed(
      ({ appId: consumedAppId }) => {
        if (consumedAppId == null) return;
        patchState(consumedAppId, (prev) =>
          prev.phase === "reviewing" ? { phase: "idle" } : prev,
        );
      },
    );
    return unsub;
  }, [patchState]);

  // The AI named this recording while proposing a test for it. Adopt the name
  // so the review stops calling it "Untitled recording" while the card beside
  // it shows the name the spec will be written under. Scoped by draft id: an
  // older card settling after a newer recording was parked must not rename it.
  useEffect(() => {
    const unsub = ipc.events.recording.onDraftNamed(
      ({ appId: namedAppId, draftId, testName }) => {
        if (namedAppId == null || !testName) return;
        patchState(namedAppId, (prev) =>
          prev.draft && prev.draft.draftId === draftId
            ? { ...prev, draft: { ...prev.draft, testName } }
            : prev,
        );
      },
    );
    return unsub;
  }, [patchState]);

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
        // triggers a resend, then force that load. Also post directly, for when
        // the current page is alive and listening.
        const nonce = crypto.randomUUID();
        pendingAuthRef.current = { appId: targetAppId, auth, nonce };
        authReadyRef.current = (result) =>
          finish(Boolean(result.ok), result.error);
        reloadPreview();
        // Fails closed on an unknown origin, exactly as the inbound handler
        // does. This is the one message carrying the test user's credentials,
        // and "*" would hand them to whatever origin the preview happens to be
        // showing. The registration above stands, and the effect below replays
        // it as soon as an origin exists — the bootstrap's own announce can't
        // be relied on for that, since it is refused by this same check.
        const origin = previewOrigin();
        if (origin !== "*") {
          postToIframe({ type: "dyad-auth-login", auth, nonce }, origin);
        }
      }),
    [postToIframe, previewOrigin, reloadPreview],
  );

  // Deliver a sign-in that was registered while the preview's origin was still
  // unknown. `authenticate` withholds the credential post in that window, and
  // the bootstrap's `dyad-auth-bootstrap-ready` announce is no rescue: the
  // inbound handler refuses it on the very same unknown origin, so an announce
  // that lands first is dropped and nothing else would ever replay the
  // handshake — the attempt would sit out its 30s timeout and degrade to
  // recording signed out. The app URL arriving is the signal.
  useEffect(() => {
    const pending = pendingAuthRef.current;
    if (!pending || pending.appId !== appId) return;
    const origin = previewOrigin();
    if (origin === "*") return;
    // Safe to repeat: the bootstrap ignores a login for an attempt it is
    // already working on, and matches the nonce before settling either way.
    postToIframe(
      { type: "dyad-auth-login", auth: pending.auth, nonce: pending.nonce },
      origin,
    );
  }, [appId, appUrl, postToIframe, previewOrigin]);

  /**
   * A promise for the next preview document to announce its recorder client.
   *
   * Register it BEFORE triggering the reload that replaces the document, or the
   * announce can land in the gap and be waited out to the timeout.
   */
  const waitForRecorderReady = useCallback((targetAppId: number) => {
    return new Promise<void>((resolve) => {
      recorderReadyRef.current = { appId: targetAppId, resolve };
      setTimeout(() => {
        if (recorderReadyRef.current?.resolve !== resolve) return;
        recorderReadyRef.current = null;
        resolve();
      }, RECORDER_READY_TIMEOUT_MS);
    });
  }, []);

  const beginRecording = useCallback(
    async (
      targetAppId: number,
      attempt: StartAttempt,
      /** The preview route recording started on, when it wasn't the root. */
      startPath?: string,
    ) => {
      // Everything after an await here reaches the preview through refs tracking
      // the *selected* app. Continuing past a switch would sign the wrong
      // preview in with this app's test credentials while this app's session
      // stayed alive, locked, and invisible.
      const isAbandoned = () =>
        attempt.cancelled ||
        !mountedRef.current ||
        appIdRef.current !== targetAppId;

      clearEntries(targetAppId);
      // A previous session's failure belongs to that session.
      failedSessionsRef.current.delete(targetAppId);
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

      // Checked before the infra error below: a user who has moved on is owed
      // no toast about the app they left, and a session that came up after the
      // cancel still has to be handed back.
      if (isAbandoned()) {
        endSession(targetAppId);
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
      if (result.sessionId) {
        sessionIdsRef.current.set(targetAppId, result.sessionId);
      }

      let auth = result.auth;
      patchState(targetAppId, (prev) => ({
        ...prev,
        isolation: result.isolation,
        warning:
          [result.isolation.reason, result.warning].filter(Boolean).join(" ") ||
          undefined,
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
        // Sign-in waits up to 30s — plenty of room for the selection to move on.
        if (isAbandoned()) {
          releaseSession(targetAppId);
          return;
        }
        // The session can also end *underneath* us in that window: Stop,
        // Restart and Delete all end it in the main process, and the
        // `recording:ended` that follows drops our ownership. None of that
        // touches `attempt`, so the checks above still read as healthy —
        // continuing would arm the recorder over a session that no longer
        // exists, capturing against the app's real database with a bar that
        // says "Recording". The ending already reset the UI; just stop.
        if (!ownedSessionsRef.current.has(targetAppId)) return;
        if (!signIn.ok) {
          // Degrade to recording unauthenticated rather than dead-ending.
          auth = { mode: "none" };
          patchState(targetAppId, (prev) => ({
            ...prev,
            auth,
            warning: `Couldn't sign in automatically${
              signIn.error ? ` (${signIn.error})` : ""
            } — recording without authentication.`,
          }));
        }
        // The sign-in path lands the preview on "/" itself (the bootstrap's
        // `goHome`), so a recording that authenticated always starts where the
        // spec replays from.
      } else {
        // Still start from a fresh load so the preview reflects the isolated
        // database and cleared storage, and isn't stuck on a dead page.
        //
        // Registered before the reload is asked for: the document that comes
        // back is the one the recorder has to be armed in, and the announce
        // that says so can arrive before the next line of this function runs.
        // With no preview attached there is nothing to arm and nothing that
        // could announce — the re-arm on `dyad-recorder-initialized` picks up
        // whatever loads later.
        const previewReady = iframeElRef.current
          ? waitForRecorderReady(targetAppId)
          : Promise.resolve();
        reloadPreview();
        // ...but a bare remount keeps whatever route the user was on, while
        // `recordedBodyStatements` opens every spec with `page.goto("/")`.
        // Replay would begin on "/" and run the first captured action against
        // the wrong page. Record the route as the navigation it effectively is,
        // rather than pretending the flow started at the root. "/" needs
        // nothing — that is already the opening statement.
        const action =
          startPath && startPath !== "/"
            ? parseRecorderAction({ kind: "navigate", path: startPath })
            : null;
        if (action) {
          appendEntry({
            appId: targetAppId,
            entry: { action, at: Date.now() },
          });
        }

        // The bar is what tells the user recording has begun, and it goes up
        // on the phase set below. Flipping it while the reload is still in
        // flight promises capture the recorder cannot deliver: the activate
        // below would arm a document that is being replaced, and everything
        // done in the gap — usually the first click of the flow — is dropped
        // with no sign that anything was missed.
        await previewReady;
        if (isAbandoned()) {
          releaseSession(targetAppId);
          return;
        }
        // The session can end underneath this wait the same way it can under
        // the sign-in above; arming over one that is gone records against the
        // app's real database.
        if (!ownedSessionsRef.current.has(targetAppId)) return;
      }

      postToIframe({ type: "activate-dyad-recorder" });
      patchState(targetAppId, (prev) => ({
        ...prev,
        phase: "recording",
        progress: undefined,
        startedAt: Date.now(),
      }));
    },
    [
      appendEntry,
      authenticate,
      clearEntries,
      endSession,
      patchState,
      postToIframe,
      releaseSession,
      reloadPreview,
      waitForRecorderReady,
    ],
  );

  // The main process allows one session per app and rejects the second ask
  // outright, so a doubled call surfaces as an error toast over a session that
  // is starting perfectly well. The phase state can't stand in for this guard:
  // it isn't committed until a re-render, and StrictMode replays the
  // start-request effect below within the same commit.
  const startRecording = useCallback(
    async (startPath?: string) => {
      const targetAppId = appId;
      if (targetAppId == null) return;
      if (
        startingAppsRef.current.has(targetAppId) ||
        ownedSessionsRef.current.has(targetAppId)
      ) {
        return;
      }
      const attempt: StartAttempt = { cancelled: false };
      startingAppsRef.current.set(targetAppId, attempt);
      try {
        await beginRecording(targetAppId, attempt, startPath);
      } finally {
        // Only our own attempt: a cancelled start can be followed by a new one for
        // the same app, and clearing blindly would drop its entry instead.
        if (startingAppsRef.current.get(targetAppId) === attempt) {
          startingAppsRef.current.delete(targetAppId);
        }
      }
    },
    [appId, beginRecording],
  );

  /**
   * End the session and capture what was recorded as a draft — no file is
   * written. Parked in the main process so the agent's `generate_test_assertions`
   * tool can propose against the real statements.
   */
  const stopAndReview = useCallback(
    async (testName: string): Promise<RecordedTestDraft | null> => {
      const targetAppId = appId;
      if (targetAppId == null) return null;

      // Read before anything can retire it: the failure check after teardown
      // needs to know which session this stop belongs to.
      const ourSessionId = sessionIdsRef.current.get(targetAppId);
      // Finishing this session ourselves, so the unmount/app-switch safety net
      // must not also try to stop it.
      ownedSessionsRef.current.delete(targetAppId);
      patchState(targetAppId, (prev) => ({ ...prev, phase: "finishing" }));
      postToIframe({ type: "deactivate-dyad-recorder" });

      const auth = stateRef.current.auth ?? { mode: "none" };
      const draft: RecordedTestDraft = {
        version: RECORDED_TEST_DRAFT_VERSION,
        // Minted once, here, and carried by every copy of this recording from
        // now on: the parked draft, the assertion card's payload, and whatever
        // either of them writes.
        draftId: crypto.randomUUID(),
        // Left unset when the user didn't name it: the AI names it as part of
        // proposing the test, rather than everything downstream carrying a
        // "recorded test" placeholder the user never asked for.
        testName: normalizeTestName(testName) || undefined,
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

      // Teardown takes seconds; hold the "finishing" spinner until it's done so
      // the review UI doesn't appear over a half-torn-down session.
      await ipc.recording.stopRecording({ appId: targetAppId }).catch(() => {});

      // That teardown may have failed — most consequentially by not restoring
      // `.env.local`, leaving the app on the temporary test branch. The user has
      // been told (the ending arrived as an error toast and reset the bar);
      // opening the review over it would invite generating a spec from a
      // session whose environment is in an unknown state.
      //
      // Only OUR session's failure counts. Teardown takes seconds, so a late
      // ending from a session this app has already replaced would otherwise
      // throw away the replacement's recording. An ending that named no session
      // is unattributable and fails closed.
      const failedSessionId = failedSessionsRef.current.get(targetAppId);
      const ourSessionFailed =
        failedSessionsRef.current.has(targetAppId) &&
        (failedSessionId === undefined || failedSessionId === ourSessionId);
      if (ourSessionFailed) {
        failedSessionsRef.current.delete(targetAppId);
        void ipc.recording
          .discardRecordedTestDraft({ appId: targetAppId })
          .catch(() => {});
        clearEntries(targetAppId);
        patchState(targetAppId, (prev) =>
          prev.phase === "idle" ? prev : { phase: "idle" },
        );
        return null;
      }

      // The draft owns the actions from here on, but everything that qualifies
      // what was captured is carried across — the review is the last thing the
      // user sees before the recording becomes a spec, so it is exactly where a
      // truncated recording, a weak isolation mode, or a sign-in that silently
      // fell back to signed-out most needs to say so. A flow recorded logged
      // out but generated with a `signIn(page)` fixture is the case this exists
      // for.
      clearEntries(targetAppId);
      patchState(targetAppId, (prev) => ({
        phase: "reviewing",
        draft,
        limitReached: prev.limitReached,
        isolation: prev.isolation,
        auth: prev.auth,
        warning: prev.warning,
      }));
      return draft;
    },
    [appId, clearEntries, patchState, postToIframe],
  );

  /**
   * The test proposal has been sent to the agent. Deliberately does NOT close
   * the review: the request can fail, be cancelled, or end without the tool ever
   * being called, and this bar is the only place the parked draft can be asked
   * about again or thrown away.
   */
  const markAwaitingAssertions = useCallback(() => {
    if (appId == null) return;
    patchState(appId, (prev) => ({ ...prev, awaitingAssertions: true }));
  }, [appId, patchState]);

  /**
   * The assertion request is over — its turn completed, errored, or was stopped.
   * Whether or not a card came back, nothing is being waited on any more, so the
   * review has to stop saying otherwise: it is the only thing that clears this,
   * and a stopped chat would otherwise leave the bar spinning forever. Takes the
   * app the request was made for, since a turn can settle after the selection
   * has moved on.
   */
  const clearAwaitingAssertions = useCallback(
    (targetAppId: number) => {
      patchState(targetAppId, (prev) =>
        prev.awaitingAssertions ? { ...prev, awaitingAssertions: false } : prev,
      );
    },
    [patchState],
  );

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
    // Now reachable from the setup phases, where a start is still in flight —
    // and dropping ownership is not enough to stop it. `beginRecording` adds
    // ownership *after* its request returns, so without cancelling the attempt
    // it would sail past its abandonment checks, re-adopt the session we just
    // stopped, and arm the recorder over it. Cancelling is what makes
    // `isAbandoned()` true when it resumes.
    const inFlight = startingAppsRef.current.get(targetAppId);
    if (inFlight) inFlight.cancelled = true;
    // A sign-in may also be in flight; leaving it to time out would keep the
    // app's start entry parked for 30 seconds after the user asked to stop.
    settlePendingAuth(targetAppId, "the recording was cancelled");
    postToIframe({ type: "deactivate-dyad-recorder" });
    void ipc.recording
      .discardRecordedTestDraft({ appId: targetAppId })
      .catch(() => {});
    // stopRecording resolves only once isolation teardown finishes, so hold a
    // visible "stopping" phase instead of leaving the bar up with no feedback.
    patchState(targetAppId, (prev) => ({ ...prev, phase: "stopping" }));
    await ipc.recording.stopRecording({ appId: targetAppId }).catch(() => {});
    clearEntries(targetAppId);
    patchState(targetAppId, { phase: "idle" });
  }, [appId, clearEntries, patchState, postToIframe, settlePendingAuth]);

  // Honor a "record" click made outside the preview (the Tests panel), which
  // leaves the request behind for this hook to consume once it mounts.
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

  // Numbered exactly as the assertion tool numbers them, so what the review
  // shows is what the model is asked about and what ends up in the file.
  const draft = recordingState.draft;
  const draftSteps = useMemo(
    () => (draft ? recordedBodyStatements(draft) : []),
    [draft],
  );

  const limitWarning = recordingState.limitReached
    ? `This recording reached the ${MAX_RECORDED_ENTRIES.toLocaleString()}-action limit — anything after that wasn't captured.`
    : undefined;

  return {
    phase: recordingState.phase,
    isolation: recordingState.isolation,
    auth: recordingState.auth,
    warning:
      [recordingState.warning, limitWarning].filter(Boolean).join(" ") ||
      undefined,
    progress: recordingState.progress,
    error: recordingState.error,
    draft,
    draftSteps,
    awaitingAssertions: Boolean(recordingState.awaitingAssertions),
    entryCount,
    steps,
    isRecording: recordingState.phase === "recording",
    isBusy:
      recordingState.phase === "starting" ||
      recordingState.phase === "authenticating" ||
      recordingState.phase === "finishing" ||
      recordingState.phase === "stopping",
    startRecording,
    stopAndReview,
    recordNavigation,
    recordHistoryMove,
    cancelRecording,
    markAwaitingAssertions,
    clearAwaitingAssertions,
    discardDraft,
  };
}

export type TestRecorderController = ReturnType<typeof useTestRecorder>;
