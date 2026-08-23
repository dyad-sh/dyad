import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import {
  appendTestRunOutputAtom,
  applyTestRunFinishedAtom,
  applyTestRunStartedAtom,
  EMPTY_TEST_RUN_STATE,
  setTestRunStateForAppAtom,
  setTestSpecsForAppAtom,
  testRunStateByAppIdAtom,
  type TestRunPhase,
} from "@/atoms/testRuntimeAtoms";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { previewNativeViewAppIdAtom } from "@/atoms/previewAtoms";
import { getActiveWindowSessionId } from "@/window_infrastructure/chat_tab_session_storage";

const OUTPUT_FLUSH_INTERVAL_MS = 100;

/** Phases a run advances through, in order. See the `onOutput` handler below. */
const PHASE_ORDER: Record<TestRunPhase, number> = {
  idle: 0,
  setup: 1,
  running: 2,
  stopping: 3,
  "cleaning-up": 4,
};

/**
 * Root-level subscriber for test-run lifecycle/output events. Registered once
 * at the app root — NOT in TestsPanel — because the panel unmounts whenever the
 * user leaves the Tests tab, and an unmount-gated subscription would drop
 * output or terminal "finished" events (see rules/electron-ipc.md: never gate
 * global-state cleanup on a component's lifetime). TestsPanel writes its own
 * optimistic start/result state, while this subscriber attaches the
 * authoritative main-process generation and covers remounts/other windows.
 */
export function useTestRunEvents() {
  const appendOutput = useSetAtom(appendTestRunOutputAtom);
  const applyStarted = useSetAtom(applyTestRunStartedAtom);
  const applyFinished = useSetAtom(applyTestRunFinishedAtom);
  const setRunState = useSetAtom(setTestRunStateForAppAtom);
  const setSpecs = useSetAtom(setTestSpecsForAppAtom);
  const store = useStore();
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setPreviewNativeViewAppId = useSetAtom(previewNativeViewAppIdAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  // Held in a ref so switching apps doesn't re-run the effect and resubscribe,
  // which is what this hook exists to avoid (a terminal event could land in
  // the gap).
  const selectedAppIdRef = useRef(selectedAppId);
  selectedAppIdRef.current = selectedAppId;
  const queryClient = useQueryClient();
  const activeRunByAppId = useRef(
    new Map<
      number,
      { runId: number; source: "panel" | "agent"; startedAt: number }
    >(),
  );
  const pendingOutputRef = useRef(new Map<number, string>());
  const outputFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    const flushPendingOutput = (appId?: number) => {
      const pending = pendingOutputRef.current;
      const entries =
        appId === undefined
          ? Array.from(pending.entries())
          : pending.has(appId)
            ? [[appId, pending.get(appId)!] as const]
            : [];
      for (const [pendingAppId, chunk] of entries) {
        appendOutput({ appId: pendingAppId, chunk });
        pending.delete(pendingAppId);
      }
      if (pending.size === 0 && outputFlushTimerRef.current) {
        clearTimeout(outputFlushTimerRef.current);
        outputFlushTimerRef.current = null;
      }
    };

    const discardPendingOutput = (appId: number) => {
      pendingOutputRef.current.delete(appId);
      if (pendingOutputRef.current.size === 0 && outputFlushTimerRef.current) {
        clearTimeout(outputFlushTimerRef.current);
        outputFlushTimerRef.current = null;
      }
    };

    const unsubscribeOutput = ipc.events.tests.onOutput((payload) => {
      // A replacement run is announced before it waits for the prior teardown.
      // Output from that teardown can therefore arrive afterward; only the
      // producer's generation proves which run owns the chunk.
      if (
        activeRunByAppId.current.get(payload.appId)?.runId !== payload.runId
      ) {
        return;
      }
      const pending = pendingOutputRef.current;
      pending.set(
        payload.appId,
        (pending.get(payload.appId) ?? "") + payload.chunk,
      );
      outputFlushTimerRef.current ??= setTimeout(() => {
        outputFlushTimerRef.current = null;
        flushPendingOutput();
      }, OUTPUT_FLUSH_INTERVAL_MS);
      // Phase transitions are rare (setup -> running); returning the previous
      // state on no-change makes this write a no-op for subscribers.
      setRunState({
        appId: payload.appId,
        update: (prev) =>
          // A run only ever moves forward through the phases. Teardown emits
          // setup-phase output after the tests have run, which would otherwise
          // flash the label back to "Setting up testing…". `idle` means no run
          // is active, so late output from a finished run is ignored entirely.
          prev.phase === "idle" ||
          PHASE_ORDER[payload.phase] <= PHASE_ORDER[prev.phase]
            ? prev
            : { ...prev, phase: payload.phase },
      });
    });

    const unsubscribeRunState = ipc.events.tests.onRunState((payload) => {
      const { appId, testFile, testLine } = payload;
      if (payload.state === "preview-fallback") {
        if (activeRunByAppId.current.get(appId)?.runId !== payload.runId) {
          return;
        }
        // The run asked for the native preview and couldn't have it, so it is
        // executing in a separate browser window. Handled for panel runs too
        // (unlike "finished" below, which the panel applies itself): the panel
        // switched to the native view optimistically on click, and leaving it
        // up would show a dead "Test view" with Back/Reload/Restart all locked
        // by a run happening somewhere the user can't see.
        if (
          payload.previewOwnerWindowSessionId === getActiveWindowSessionId()
        ) {
          setPreviewNativeViewAppId((current) =>
            current === appId ? null : current,
          );
        }
        return;
      }
      if (payload.state === "started") {
        const activeRun = activeRunByAppId.current.get(appId);
        if (activeRun && payload.runId < activeRun.runId) {
          return;
        }
        const currentState =
          store.get(testRunStateByAppIdAtom).get(appId) ?? EMPTY_TEST_RUN_STATE;
        // The initiating TestsPanel writes setup synchronously before invoking
        // main. Preserve that timestamp so its awaited result can still use it
        // as a local stale-write guard; other windows start from this event.
        const startedAt =
          payload.source === "panel" &&
          currentState.phase !== "idle" &&
          currentState.runId === undefined
            ? (currentState.startedAt ?? Date.now())
            : Date.now();
        activeRunByAppId.current.set(appId, {
          runId: payload.runId,
          source: payload.source,
          startedAt,
        });
        discardPendingOutput(appId);
        // Run state is broadcast to every window, but preview automation is
        // attached to the invoking window's native view. App selection alone
        // cannot identify that owner when two windows show the same app.
        if (
          payload.source === "agent" &&
          payload.preview &&
          payload.previewOwnerWindowSessionId === getActiveWindowSessionId() &&
          payload.appId === selectedAppIdRef.current
        ) {
          setPreviewNativeViewAppId(payload.appId);
          setPreviewMode("preview");
        }
        applyStarted({
          appId,
          testFile,
          testLine,
          grep: payload.grep,
          startedAt,
          runId: payload.runId,
          source: payload.source,
        });
        return;
      }
      // Progress-only states, consumed for BOTH sources. The panel writes its
      // own start/finish state directly, but the process kill and the
      // isolation teardown happen entirely in the main process, so a
      // panel-initiated run has no other way to learn it is in one of them.
      // The PHASE_ORDER guard keeps a run moving forward only: `idle` means the
      // run already finished, so a late event must not restore a spinner.
      if (payload.state === "stopping" || payload.state === "cleaning-up") {
        const nextPhase = payload.state;
        let activeRun = activeRunByAppId.current.get(appId);
        if (activeRun && payload.runId < activeRun.runId) {
          return;
        }
        if (!activeRun || payload.runId > activeRun.runId) {
          // A renderer can mount after `started`, or a queued replacement can
          // publish Stop while this window still projects the prior teardown.
          // Bootstrap the replacement from the correlated progress payload.
          const startedAt = Date.now();
          activeRun = {
            runId: payload.runId,
            source: payload.source,
            startedAt,
          };
          activeRunByAppId.current.set(appId, activeRun);
          discardPendingOutput(appId);
          applyStarted({
            appId,
            testFile,
            testLine,
            grep: payload.grep,
            startedAt,
            runId: payload.runId,
            source: payload.source,
          });
        }
        setRunState({
          appId,
          update: (prev) =>
            prev.runId !== payload.runId ||
            prev.phase === "idle" ||
            PHASE_ORDER[nextPhase] <= PHASE_ORDER[prev.phase]
              ? prev
              : {
                  ...prev,
                  phase: nextPhase,
                  source: payload.source,
                  wasStopped:
                    payload.wasStopped ??
                    (nextPhase === "stopping" ? true : prev.wasStopped),
                  // Carried on `cleaning-up` only, so the panel can name the
                  // teardown accurately. The terminal `finished` event resends
                  // it, so this never becomes the badge's only source.
                  isolation: payload.isolation ?? prev.isolation,
                },
        });
        return;
      }
      const activeRun = activeRunByAppId.current.get(appId);
      if (!activeRun || activeRun.runId !== payload.runId) {
        return;
      }
      if (payload.source === "panel") {
        // The initiating panel merges the invoke result, but a remounted or
        // peer window has no such continuation. End its progress state without
        // fabricating results; the origin's result merge remains authoritative.
        setRunState({
          appId,
          update: (prev) =>
            prev.runId !== payload.runId
              ? prev
              : {
                  ...prev,
                  phase: "idle",
                  wasStopped: false,
                  runningFiles: [],
                  runningTests: [],
                  isolation: payload.isolation ?? prev.isolation,
                },
        });
        return;
      }
      if (activeRun.source !== "agent") {
        return;
      }
      const runId = activeRun.runId;
      const runStartedAt = activeRun.startedAt;
      const finish = () =>
        applyFinished({
          appId,
          res: {
            appId,
            results: payload.results ?? [],
            infraError: payload.infraError,
            isolation: payload.isolation,
          },
          isPartialRun:
            testFile != null && (testLine != null || !!payload.grep),
          expectedStartedAt: runStartedAt,
          expectedRunId: runId,
        });
      // Do not leave the finished run's spinner/Stop state waiting on disk I/O.
      // The initial merge may use a stale spec list, but the forced refresh
      // below reconciles the same results again once newly-written specs exist.
      finish();
      // The agent may have written the spec it just ran in this same turn, so
      // the cached spec list may not contain it yet. Read through IPC directly:
      // fetchQuery can reuse either the production client's fresh 60-second
      // cache or an in-flight request that started before the spec was written.
      void ipc.tests
        .listAppTests({ appId })
        .then((data) => {
          // A newer run may have started while the refresh was in flight. Its
          // running state and results must never be overwritten by this older
          // run's delayed reconciliation.
          if (activeRunByAppId.current.get(appId)?.runId !== runId) {
            return;
          }
          queryClient.setQueryData(queryKeys.tests.list({ appId }), data);
          setSpecs({ appId, specs: data.specs });
          finish();
        })
        // The run already finished against the cached list above. A failed
        // refresh only means its result may remain unreconciled until later.
        .catch(() => {});
    });
    return () => {
      unsubscribeOutput();
      unsubscribeRunState();
      if (outputFlushTimerRef.current) {
        clearTimeout(outputFlushTimerRef.current);
        outputFlushTimerRef.current = null;
      }
      flushPendingOutput();
    };
  }, [
    appendOutput,
    applyStarted,
    applyFinished,
    setRunState,
    setSpecs,
    store,
    queryClient,
  ]);
}
