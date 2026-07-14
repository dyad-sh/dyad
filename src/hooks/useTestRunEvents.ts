import { useEffect } from "react";
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

  useEffect(() => {
    const unsubscribe = ipc.events.tests.onRunState((payload) => {
      if (payload.source === "panel") return;
      const { appId, testFile, testLine } = payload;
      if (payload.state === "started") {
        applyStarted({ appId, testFile, testLine });
        return;
      }
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
      // The agent may have written the spec it just ran in this same turn, so
      // the cached spec list may not contain it yet. Refresh the list BEFORE
      // merging results — otherwise the new spec's result reconciles against a
      // stale list, lands under an unmatched key, and its row never shows an
      // outcome. fetchQuery also primes the panel's specs query cache.
      void queryClient
        .fetchQuery({
          queryKey: queryKeys.tests.list({ appId }),
          queryFn: () => ipc.tests.listAppTests({ appId }),
        })
        .then((data) => setSpecs({ appId, specs: data.specs }))
        // On a fetch failure, still finish the run against the cached list —
        // a possibly-unreconciled result beats a stranded "running" state.
        .catch(() => {})
        .finally(finish);
    });
    return unsubscribe;
  }, [applyStarted, applyFinished, setSpecs, queryClient]);
}
