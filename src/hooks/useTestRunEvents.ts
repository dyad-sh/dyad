import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  appendTestRunOutputAtom,
  applyTestRunFinishedAtom,
  applyTestRunStartedAtom,
  setTestRunStateForAppAtom,
  setTestSpecsForAppAtom,
  type TestRunPhase,
} from "@/atoms/testRuntimeAtoms";
import { ipc } from "@/ipc/types";
import type {
  ActiveTestRunSnapshot,
  TestOutputPayload,
  TestsRunStatePayload,
} from "@/ipc/types/tests";
import { queryKeys } from "@/lib/queryKeys";
import { summarizeTestRun, type CompletedTestRun } from "@/lib/testRunSummary";
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
 * global-state cleanup on a component's lifetime). Main owns start and finish
 * for both sources; submitting a queued panel request must not replace the
 * active run's progress or results.
 */
export function useTestRunEvents() {
  const appendOutput = useSetAtom(appendTestRunOutputAtom);
  const applyStarted = useSetAtom(applyTestRunStartedAtom);
  const applyFinished = useSetAtom(applyTestRunFinishedAtom);
  const setRunState = useSetAtom(setTestRunStateForAppAtom);
  const setSpecs = useSetAtom(setTestSpecsForAppAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setPreviewNativeViewAppId = useSetAtom(previewNativeViewAppIdAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  // Held in a ref so switching apps doesn't re-run the effect and resubscribe,
  // which is what this hook exists to avoid (a terminal event could land in
  // the gap).
  const selectedAppIdRef = useRef(selectedAppId);
  selectedAppIdRef.current = selectedAppId;
  const queryClient = useQueryClient();
  const latestStartedRunByAppId = useRef(new Map<number, number>());
  const activeRunsById = useRef(
    new Map<number, { appId: number; startedAt: number }>(),
  );
  const observedRunIds = useRef(new Set<number>());
  const hydrateActiveRun = useRef<(snapshot: ActiveTestRunSnapshot) => void>(
    () => {},
  );
  const pendingOutputRef = useRef(
    new Map<number, { appId: number; chunk: string }>(),
  );
  const outputFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    const flushPendingOutput = (appId?: number) => {
      const pending = pendingOutputRef.current;
      for (const [runId, output] of pending) {
        if (appId !== undefined && output.appId !== appId) continue;
        appendOutput({ ...output, runId });
        pending.delete(runId);
      }
      if (pending.size === 0 && outputFlushTimerRef.current) {
        clearTimeout(outputFlushTimerRef.current);
        outputFlushTimerRef.current = null;
      }
    };

    const onOutput = (payload: TestOutputPayload) => {
      // Correlate late output with the run that produced it, even after the
      // queue has advanced to a new request.
      if (activeRunsById.current.get(payload.runId)?.appId !== payload.appId) {
        return;
      }
      const pending = pendingOutputRef.current;
      pending.set(payload.runId, {
        appId: payload.appId,
        chunk: (pending.get(payload.runId)?.chunk ?? "") + payload.chunk,
      });
      outputFlushTimerRef.current ??= setTimeout(() => {
        outputFlushTimerRef.current = null;
        flushPendingOutput();
      }, OUTPUT_FLUSH_INTERVAL_MS);
      // Phase transitions are rare (setup -> running); returning the previous
      // state on no-change makes this write a no-op for subscribers.
      setRunState({
        appId: payload.appId,
        runId: payload.runId,
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
    };

    const onRunState = (payload: TestsRunStatePayload) => {
      if (payload.state === "finished") {
        // Retain recent outcomes even with the chat/Tests panel unmounted, or
        // when this window missed the start. Never infer success from dequeueing.
        const recentRunsKey = queryKeys.tests.recentRuns({
          appId: payload.appId,
        });
        // Often unobserved for longer than a batch takes, so opt out of the
        // default 5-minute GC; the list is bounded to ten compact entries.
        queryClient.setQueryDefaults(recentRunsKey, {
          gcTime: Infinity,
          staleTime: Infinity,
        });
        queryClient.setQueryData<CompletedTestRun[]>(
          recentRunsKey,
          (previous = []) =>
            [
              ...previous.filter((run) => run.runId !== payload.runId),
              summarizeTestRun(payload),
            ]
              .sort((a, b) => a.runId - b.runId)
              .slice(-10),
        );
      }
      const observed = observedRunIds.current.has(payload.runId);
      observedRunIds.current.add(payload.runId);
      // Only used to fence in-flight bootstrap replies, not as run history.
      if (observedRunIds.current.size > 1024)
        observedRunIds.current.delete(
          observedRunIds.current.values().next().value!,
        );
      const { appId, testFile, testFiles, testLine } = payload;
      if (payload.state === "preview-fallback") {
        if (activeRunsById.current.get(payload.runId)?.appId !== appId) {
          return;
        }
        // The run asked for the native preview and couldn't have it, so it is
        // executing in a separate browser window. The started event opened
        // the native view; leaving it
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
        if (observed) return;
        const startedAt = Date.now();
        activeRunsById.current.set(payload.runId, { appId, startedAt });
        latestStartedRunByAppId.current.set(
          appId,
          Math.max(
            latestStartedRunByAppId.current.get(appId) ?? 0,
            payload.runId,
          ),
        );
        // Run state is broadcast to every window, but preview automation is
        // attached to the invoking window's native view. App selection alone
        // cannot identify that owner when two windows show the same app.
        if (
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
          testFiles,
          testLine,
          grep: payload.grep,
          startedAt,
          runId: payload.runId,
          source: payload.source,
          // Forwarded, or the main process's authoritative value would clear
          // the panel's optimistic one and the setup phase would show the
          // generic copy for every run — including agent runs, which never set
          // it locally at all.
          sandboxed: payload.sandboxed,
        });
        return;
      }
      // Progress-only states, consumed for both panel and agent runs.
      // The PHASE_ORDER guard keeps a run moving forward only: `idle` means the
      // run already finished, so a late event must not restore a spinner.
      if (payload.state === "stopping" || payload.state === "cleaning-up") {
        const nextPhase = payload.state;
        if (!activeRunsById.current.has(payload.runId)) {
          if (observed) return;
          // A renderer can mount after `started`. Bootstrap the active run
          // from its correlated progress payload.
          const startedAt = Date.now();
          activeRunsById.current.set(payload.runId, { appId, startedAt });
          latestStartedRunByAppId.current.set(
            appId,
            Math.max(
              latestStartedRunByAppId.current.get(appId) ?? 0,
              payload.runId,
            ),
          );
          applyStarted({
            appId,
            testFile,
            testFiles,
            testLine,
            grep: payload.grep,
            startedAt,
            runId: payload.runId,
            source: payload.source,
            sandboxed: payload.sandboxed,
          });
        }
        setRunState({
          appId,
          runId: payload.runId,
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
                  sandboxed: payload.sandboxed ?? prev.sandboxed,
                },
        });
        return;
      }
      const activeRun = activeRunsById.current.get(payload.runId);
      if (!activeRun || activeRun.appId !== appId) {
        return;
      }
      const runId = payload.runId;
      const runStartedAt = activeRun.startedAt;
      activeRunsById.current.delete(runId);
      flushPendingOutput(appId);
      const finish = () =>
        applyFinished({
          appId,
          res: {
            appId,
            results: payload.results ?? [],
            infraError: payload.infraError,
            isolation: payload.isolation,
          },
          isPartialRun: testLine != null || !!payload.grep,
          sandboxed: payload.sandboxed,
          expectedStartedAt: runStartedAt,
          expectedRunId: runId,
        });
      // Do not leave the finished run's spinner/Stop state waiting on disk I/O.
      // The initial merge may use a stale spec list, but the forced refresh
      // below reconciles the same results again once newly-written specs exist.
      finish();
      const latestStartedRunIdAtFinish =
        latestStartedRunByAppId.current.get(appId);
      // The agent may have written the spec it just ran in this same turn, so
      // the cached spec list may not contain it yet. Read through IPC directly:
      // fetchQuery can reuse either the production client's fresh 60-second
      // cache or an in-flight request that started before the spec was written.
      void ipc.tests
        .listAppTests({ appId })
        .then((data) => {
          // A newer run may have started while the refresh was in flight. Its
          // running state and results must never be overwritten by this older
          // run's delayed reconciliation. An older run that finishes last still
          // needs reconciliation; only starts after its completion invalidate it.
          if (
            latestStartedRunByAppId.current.get(appId) !==
            latestStartedRunIdAtFinish
          ) {
            return;
          }
          queryClient.setQueryData(queryKeys.tests.list({ appId }), data);
          setSpecs({ appId, specs: data.specs });
          finish();
        })
        // The run already finished against the cached list above. A failed
        // refresh only means its result may remain unreconciled until later.
        .catch(() => {});
    };
    const unsubscribeOutput = ipc.events.tests.onOutput(onOutput);
    const unsubscribeRunState = ipc.events.tests.onRunState(onRunState);
    hydrateActiveRun.current = (snapshot) => {
      const { run, phase, output } = snapshot;
      // A live start/progress/finish wins over an older bootstrap, including
      // a terminal event received before this window knew the run existed.
      if (observedRunIds.current.has(run.runId)) return;
      onRunState({ ...run, state: "started", preview: false });
      onOutput({
        appId: run.appId,
        runId: run.runId,
        chunk: output,
        phase: phase === "setup" ? "setup" : "running",
      });
      if (phase === "stopping" || phase === "cleaning-up")
        onRunState({ ...run, state: phase });
      flushPendingOutput(run.appId);
    };
    return () => {
      hydrateActiveRun.current = () => {};
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
    queryClient,
  ]);
  // Subscribe above before reading the current lifecycle. The snapshot is only
  // a bootstrap; subsequent progress continues through the permanent subscriber.
  const { data: activeSnapshots, isFetchedAfterMount } = useQuery({
    queryKey: queryKeys.tests.activeRuns({ appId: selectedAppId }),
    networkMode: "always",
    enabled: selectedAppId !== null,
    staleTime: 0,
    queryFn: () => ipc.tests.getActiveRuns({ appId: selectedAppId! }),
  });
  useEffect(() => {
    if (isFetchedAfterMount)
      for (const snapshot of activeSnapshots ?? [])
        hydrateActiveRun.current(snapshot);
  }, [activeSnapshots, isFetchedAfterMount]);
}
