import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import {
  applyTestRunFinishedAtom,
  applyTestRunStartedAtom,
  setTestSpecsForAppAtom,
} from "@/atoms/testRuntimeAtoms";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Root-level subscriber for agent-initiated test-run lifecycle events
 * (tests:run-state). Registered once at the app root — NOT in TestsPanel —
 * because the panel unmounts whenever the user leaves the Tests tab, and an
 * unmount-gated subscription would drop the terminal "finished" event,
 * stranding the app's global run state on "running" forever (see
 * rules/electron-ipc.md: never gate global-state cleanup on a component's
 * lifetime). Panel-initiated runs (`source: "panel"`) are ignored: TestsPanel's
 * own runAppTests invocation writes the same state directly, and main
 * serializes runs so an agent and a panel run never overlap.
 */
export function useTestRunEvents() {
  const applyStarted = useSetAtom(applyTestRunStartedAtom);
  const applyFinished = useSetAtom(applyTestRunFinishedAtom);
  const setSpecs = useSetAtom(setTestSpecsForAppAtom);
  const queryClient = useQueryClient();
  const runGenerationByAppId = useRef(new Map<number, number>());

  useEffect(() => {
    const unsubscribe = ipc.events.tests.onRunState((payload) => {
      if (payload.source === "panel") return;
      const { appId, testFile, testLine } = payload;
      if (payload.state === "started") {
        runGenerationByAppId.current.set(
          appId,
          (runGenerationByAppId.current.get(appId) ?? 0) + 1,
        );
        applyStarted({ appId, testFile, testLine });
        return;
      }
      const runGeneration = runGenerationByAppId.current.get(appId) ?? 0;
      const finish = () =>
        applyFinished({
          appId,
          res: {
            appId,
            results: payload.results ?? [],
            infraError: payload.infraError,
            isolation: payload.isolation,
          },
          isSingleTest: testFile != null && testLine != null,
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
          if (runGenerationByAppId.current.get(appId) !== runGeneration) {
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
    return unsubscribe;
  }, [applyStarted, applyFinished, setSpecs, queryClient]);
}
