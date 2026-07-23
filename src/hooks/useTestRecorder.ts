import { useCallback, useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { previewIframeRefAtom } from "@/atoms/previewAtoms";
import {
  appendRecordedEntryAtom,
  clearRecordedEntriesForAppAtom,
  currentRecordedEntriesAtom,
  currentRecordingStateAtom,
  setRecordingStateForAppAtom,
  type RecordingState,
} from "@/atoms/recorderAtoms";
import { collapseActions } from "@/lib/test_recorder/merge";
import { generateSpecSource } from "@/lib/test_recorder/codegen";
import { generateTestUserFixtureSource } from "@/lib/test_recorder/fixture_templates";
import { parseRecorderAction } from "@/lib/test_recorder/types";
import type { RecordingAuth } from "@/ipc/types";
import { normalizeTestPath } from "@/ipc/utils/normalize_test_path";

const AUTH_READY_TIMEOUT_MS = 30_000;
const FIXTURE_PATH = "tests/fixtures/test-user.ts";

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "test";
}

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
 * injected recorder, buffers observed actions, and on save generates a
 * Playwright spec (plus the shared `signIn` fixture) into the app's `tests/`.
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
  const recordingState = useAtomValue(currentRecordingStateAtom);
  const entries = useAtomValue(currentRecordedEntriesAtom);

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
  const authReadyRef = useRef<
    ((data: { ok?: boolean; error?: string }) => void) | null
  >(null);
  // The auth to (re)send while we're waiting for the in-iframe sign-in; set for
  // the duration of `authenticate` so a bootstrap that (re)loads mid-flow can be
  // handed the credentials as soon as it announces itself.
  const pendingAuthRef = useRef<RecordingAuth | null>(null);

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

  const postToIframe = useCallback((message: unknown) => {
    iframeElRef.current?.contentWindow?.postMessage(message, "*");
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
          if (pendingAuthRef.current) {
            postToIframe({
              type: "dyad-auth-login",
              auth: pendingAuthRef.current,
            });
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
          const path = toAppPath(data.newUrl);
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
  }, [appendEntry, postToIframe]);

  // Reset the UI if a session ends outside our control (app stopped / crash).
  useEffect(() => {
    const unsub = ipc.events.recording.onEnded(
      ({ appId: endedAppId, reason, message }) => {
        if (endedAppId == null) return;
        patchState(endedAppId, (prev) => {
          if (prev.phase === "idle") return prev;
          return {
            phase: "idle",
            error:
              reason === "error"
                ? (message ?? "The recording session ended unexpectedly.")
                : undefined,
          };
        });
      },
    );
    return unsub;
  }, [patchState]);

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
    (auth: RecordingAuth) =>
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
        pendingAuthRef.current = auth;
        authReadyRef.current = (result) =>
          finish(Boolean(result.ok), result.error);
        reloadPreview();
        postToIframe({ type: "dyad-auth-login", auth });
      }),
    [postToIframe, reloadPreview],
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
      const signIn = await authenticate(auth);
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
  }, [appId, authenticate, clearEntries, patchState, postToIframe]);

  const ensureFixture = useCallback(
    async (
      targetAppId: number,
      mode: "neon-better-auth" | "supabase-password",
    ) => {
      try {
        await ipc.app.readAppFile({
          appId: targetAppId,
          filePath: FIXTURE_PATH,
        });
        return; // already exists — never overwrite the user's edits
      } catch {
        // Not found — generate it.
      }
      await ipc.app.editAppFile({
        appId: targetAppId,
        filePath: FIXTURE_PATH,
        content: generateTestUserFixtureSource(mode),
      });
    },
    [],
  );

  const stopAndSave = useCallback(
    async (testName: string): Promise<string | null> => {
      const targetAppId = appId;
      if (targetAppId == null) return null;

      patchState(targetAppId, (prev) => ({ ...prev, phase: "saving" }));
      postToIframe({ type: "deactivate-dyad-recorder" });

      const auth = stateRef.current.auth ?? { mode: "none" };
      const includeSignIn = auth.mode !== "none";
      const actions = collapseActions(entriesRef.current);
      const name = testName.trim() || "recorded test";
      const specSource = generateSpecSource(actions, {
        testName: name,
        includeSignIn,
      });
      const specPath = normalizeTestPath(`recorded-${slugify(name)}`);

      let saved = false;
      try {
        if (includeSignIn) {
          await ensureFixture(targetAppId, auth.mode);
        }
        await ipc.app.editAppFile({
          appId: targetAppId,
          filePath: specPath,
          content: specSource,
        });
        saved = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showError(`Couldn't save the recorded test: ${message}`);
      } finally {
        await ipc.recording
          .stopRecording({ appId: targetAppId })
          .catch(() => {});
      }

      queryClient.invalidateQueries({
        queryKey: queryKeys.tests.list({ appId: targetAppId }),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.appFiles.all });

      clearEntries(targetAppId);

      if (saved) {
        // Stay in a "saved" state so the UI can offer the AI-assertion pass.
        patchState(targetAppId, { phase: "saved", savedSpecPath: specPath });
        showSuccess(`Saved ${specPath}`);
        return specPath;
      }
      patchState(targetAppId, { phase: "idle" });
      return null;
    },
    [appId, clearEntries, ensureFixture, patchState, postToIframe, queryClient],
  );

  const dismissSaved = useCallback(() => {
    if (appId == null) return;
    patchState(appId, { phase: "idle" });
  }, [appId, patchState]);

  const cancelRecording = useCallback(async () => {
    const targetAppId = appId;
    if (targetAppId == null) return;
    postToIframe({ type: "deactivate-dyad-recorder" });
    await ipc.recording.stopRecording({ appId: targetAppId }).catch(() => {});
    clearEntries(targetAppId);
    patchState(targetAppId, { phase: "idle" });
  }, [appId, clearEntries, patchState, postToIframe]);

  return {
    phase: recordingState.phase,
    isolation: recordingState.isolation,
    auth: recordingState.auth,
    warning: recordingState.warning,
    progress: recordingState.progress,
    error: recordingState.error,
    savedSpecPath: recordingState.savedSpecPath,
    entryCount: entries.length,
    isRecording: recordingState.phase === "recording",
    isBusy:
      recordingState.phase === "starting" ||
      recordingState.phase === "authenticating" ||
      recordingState.phase === "saving",
    startRecording,
    stopAndSave,
    cancelRecording,
    dismissSaved,
  };
}

export type TestRecorderController = ReturnType<typeof useTestRecorder>;
