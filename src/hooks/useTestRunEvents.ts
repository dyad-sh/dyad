import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import {
  appendTestRunOutputAtom,
  applyTestRunFinishedAtom,
  applyTestRunStartedAtom,
  setTestRunStateForAppAtom,
  setTestSpecsForAppAtom,
  type TestRunPhase,
} from "@/atoms/testRuntimeAtoms";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

const OUTPUT_FLUSH_INTERVAL_MS = 100;

/** Phases a run advances through, in order. See the `onOutput` handler below. */
const PHASE_ORDER: Record<TestRunPhase, number> = {
  idle: 0,
  setup: 1,
  running: 2,
};

/**
 * Root-level subscriber for test-run lifecycle/output events. Registered once
 * at the app root — NOT in TestsPanel — because the panel unmounts whenever the
 * user leaves the Tests tab, and an unmount-gated subscription would drop
 * output or terminal "finished" events (see rules/electron-ipc.md: never gate
 * global-state cleanup on a component's lifetime). Panel-initiated run state is
 * mostly ignored because TestsPanel writes it directly, but panel "started"
 * still invalidates older agent-run refreshes.
 */
export function useTestRunEvents() {
  const appendOutput = useSetAtom(appendTestRunOutputAtom);
  const applyStarted = useSetAtom(applyTestRunStartedAtom);
  const applyFinished = useSetAtom(applyTestRunFinishedAtom);
  const setRunState = useSetAtom(setTestRunStateForAppAtom);
  const setSpecs = useSetAtom(setTestSpecsForAppAtom);
  const queryClient = useQueryClient();
  const runGenerationByAppId = useRef(new Map<number, number>());
  const activeRunByAppId = useRef(
    new Map<
      number,
      { generation: number; source: "panel" | "agent"; startedAt: number }
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
      if (payload.state === "started") {
        const generation = (runGenerationByAppId.current.get(appId) ?? 0) + 1;
        const startedAt = Date.now();
        runGenerationByAppId.current.set(appId, generation);
        activeRunByAppId.current.set(appId, {
          generation,
          source: payload.source,
          startedAt,
        });
        discardPendingOutput(appId);
        if (payload.source === "agent") {
          applyStarted({
            appId,
            testFile,
            testLine,
            grep: payload.grep,
            startedAt,
          });
        }
        return;
      }
      if (payload.source === "panel") {
        return;
      }
      const activeRun = activeRunByAppId.current.get(appId);
      if (!activeRun || activeRun.source !== "agent") {
        return;
      }
      const runGeneration = activeRun.generation;
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
          if (
            activeRunByAppId.current.get(appId)?.generation !== runGeneration
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
    queryClient,
  ]);
}
