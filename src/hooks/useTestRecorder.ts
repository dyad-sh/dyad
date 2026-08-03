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
  RECORDED_TEST_DRAFT_VERSION,
  type RecordedTestDraft,
} from "@/lib/test_recorder/draft";
import { parseRecorderAction } from "@/lib/test_recorder/types";
import type { RecordingAuth } from "@/ipc/types";

const AUTH_READY_TIMEOUT_MS = 30_000;

/**
 * Convert a preview URL/path to an app-relative path (`/foo?x`).
 *
 * Rejections are logged, not just dropped. This is a trust boundary — the
 * previewed app supplies these — and a recording that silently omits a
 * navigation the user watched happen is otherwise impossible to explain.
 */
function toAppPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const url = new URL(raw, "http://dyad.preview");
    // A `javascript:`/`data:` history entry has no app path to replay, and its
    // opaque body would otherwise be handed to `page.goto` as if it were one.
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      // The protocol only — the rest can carry whatever the page put there.
      console.warn(
        `Recorder ignored a navigation with an unsupported protocol: ${url.protocol}`,
      );
      return null;
    }
    return `${url.pathname}${url.search}` || "/";
  } catch {
    console.warn("Recorder ignored a navigation to an unparseable URL");
    return null;
  }
}

/**
 * Drives a preview recording session: starts isolation + auto sign-in, arms the
 * injected recorder, and buffers observed actions. Mount once, in the preview
 * panel.
 *
 * Stopping does NOT write a file — it parks the collapsed actions as a draft and
 * moves to the review phase. The spec is generated later from that same draft,
 * either by approving the assertion card or by saving as-is.
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
  // Isolation setup restarts the dev server, emptying the app URL until the new
  // one arrives — a gap the sign-in handshake runs straight through. The live
  // URL always wins; this only stands in while there is none, and is dropped on
  // an app switch.
  const lastPreviewOriginRef = useRef<string | null>(null);
  const authReadyRef = useRef<
    ((data: { ok?: boolean; error?: string }) => void) | null
  >(null);
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
  // `ownedSessionsRef` can't cover, since isolation setup takes seconds.
  const startingAppsRef = useRef(new Set<number>());
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
        case "pushState":
        case "replaceState": {
          if (phaseRef.current !== "recording" || currentAppId == null) return;
          // The shim (and the auth bootstrap) nest history changes under
          // `payload`, unlike every other message this handler consumes.
          const payload = data.payload as { newUrl?: unknown } | undefined;
          const path = toAppPath(payload?.newUrl);
          // Through the same schema as every other recorded action, so the
          // trust boundary stays in one place: a synthesized navigate is no
          // more trustworthy than one the preview posted directly.
          const navigate = path
            ? parseRecorderAction({ kind: "navigate", path })
            : null;
          if (path && !navigate) {
            console.warn(
              "Recorder ignored a navigation that resolves outside the app",
            );
          }
          if (navigate) {
            appendEntry({
              appId: currentAppId,
              entry: { action: navigate, at: Date.now() },
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
        if (failureMessage) showError(failureMessage);
      },
    );
    return unsub;
  }, [patchState, postToIframe]);

  /**
   * Hand a still-running session back and reset the app's recorder state, for
   * when we're walking away rather than finishing. Only apps in
   * `ownedSessionsRef` are touched, so a draft in review is never disturbed.
   */
  const releaseSession = useCallback(
    (targetAppId: number) => {
      if (!ownedSessionsRef.current.delete(targetAppId)) return;
      sessionIdsRef.current.delete(targetAppId);
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
  // Otherwise the main-process session stays alive until the 30-minute cap,
  // serving the isolated test database and rejecting runs, with no UI to end it.
  useEffect(() => {
    return () => {
      // Snapshot: releaseSession removes from the set as it goes.
      for (const owned of Array.from(ownedSessionsRef.current)) {
        releaseSession(owned);
      }
    };
  }, [appId, releaseSession]);

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
        postToIframe({ type: "dyad-auth-login", auth, nonce }, previewOrigin());
      }),
    [postToIframe, previewOrigin, reloadPreview],
  );

  const beginRecording = useCallback(
    async (targetAppId: number) => {
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
      if (result.sessionId) {
        sessionIdsRef.current.set(targetAppId, result.sessionId);
      }
      // Everything below reaches the preview through refs tracking the *selected*
      // app. If the user switched apps during isolation setup, continuing would
      // sign the wrong preview in with this app's test credentials while this
      // app's session stayed alive, locked, and invisible.
      if (!mountedRef.current || appIdRef.current !== targetAppId) {
        releaseSession(targetAppId);
        return;
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
        if (!mountedRef.current || appIdRef.current !== targetAppId) {
          releaseSession(targetAppId);
          return;
        }
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
      } else {
        // Still start from a fresh load so the preview reflects the isolated
        // database and cleared storage, and isn't stuck on a dead page.
        reloadPreview();
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
      authenticate,
      clearEntries,
      patchState,
      postToIframe,
      releaseSession,
      reloadPreview,
    ],
  );

  // The main process allows one session per app and rejects the second ask
  // outright, so a doubled call surfaces as an error toast over a session that
  // is starting perfectly well. The phase state can't stand in for this guard:
  // it isn't committed until a re-render, and StrictMode replays the
  // start-request effect below within the same commit.
  const startRecording = useCallback(async () => {
    const targetAppId = appId;
    if (targetAppId == null) return;
    if (
      startingAppsRef.current.has(targetAppId) ||
      ownedSessionsRef.current.has(targetAppId)
    ) {
      return;
    }
    startingAppsRef.current.add(targetAppId);
    try {
      await beginRecording(targetAppId);
    } finally {
      startingAppsRef.current.delete(targetAppId);
    }
  }, [appId, beginRecording]);

  /**
   * End the session and capture what was recorded as a draft — no file is
   * written. Parked in the main process so the agent's `generate_test_assertions`
   * tool can propose against the real statements.
   */
  const stopAndReview = useCallback(
    async (testName: string): Promise<RecordedTestDraft | null> => {
      const targetAppId = appId;
      if (targetAppId == null) return null;

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

      // Teardown takes seconds; hold the "finishing" spinner until it's done so
      // the review UI doesn't appear over a half-torn-down session.
      await ipc.recording.stopRecording({ appId: targetAppId }).catch(() => {});

      // The draft owns the actions from here on. `limitReached` is carried
      // across: the review is where a truncated recording most needs to say so,
      // since it's the last thing the user sees before the spec is written.
      clearEntries(targetAppId);
      patchState(targetAppId, (prev) => ({
        phase: "reviewing",
        draft,
        limitReached: prev.limitReached,
      }));
      return draft;
    },
    [appId, clearEntries, patchState, postToIframe],
  );

  /**
   * Generate the spec from the draft as recorded, skipping the assertion pass —
   * same deterministic codegen the approval path uses.
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
      patchState(targetAppId, (prev) => ({
        phase: "saved",
        savedSpecPath: specPath,
        limitReached: prev.limitReached,
      }));
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

  /**
   * The assertion pass has been sent to the agent. Deliberately does NOT close
   * the review: the request can fail, be cancelled, or end without the tool ever
   * being called, and this bar is the only place the parked draft can be saved
   * as-is, discarded, or asked again.
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
  }, [appId, clearEntries, patchState, postToIframe]);

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
    markAwaitingAssertions,
    clearAwaitingAssertions,
    discardDraft,
  };
}

export type TestRecorderController = ReturnType<typeof useTestRecorder>;
