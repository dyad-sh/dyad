import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import type { SetupSnapshot } from "@/ipc/types/coolify_setup";

/**
 * Renderer binding for the Coolify setup machine.
 *
 * The snapshot is owned by the main process. Subscribing happens before the
 * initial read so a run that finishes mid-mount is not missed, and a
 * late-arriving read never overwrites a state already pushed.
 *
 * One hook rather than a query in each panel that wants it. Two components
 * read this at once, and React Query runs whichever observer's queryFn it
 * picked for the key — so a plain one anywhere is a plain one everywhere,
 * and the guard below would be bypassed by the copy that did not have it.
 */
export function useCoolifySetupSnapshot() {
  const queryClient = useQueryClient();

  /**
   * How many pushed states have landed, so a read can tell whether it was
   * overtaken. Counted rather than flagged: the read compares against what it
   * started with, and a refetch after an earlier event must not read as
   * overtaken by that old one.
   */
  const eventCount = useRef(0);

  // Pushed rather than polled, so the step and the log keep up with a run
  // this window did not start.
  useEffect(() => {
    return ipc.events.coolifySetup.onChanged((state) => {
      eventCount.current += 1;
      queryClient.setQueryData(queryKeys.coolify.setup, state);
    });
  }, [queryClient]);

  // What is going on is asked for, not remembered. An install outlives the
  // screen — leaving it is invited, and a background refetch can replace it —
  // so anything kept here would be lost exactly when it mattered.
  return useQuery({
    queryKey: queryKeys.coolify.setup,
    queryFn: async () => {
      const before = eventCount.current;
      const read = await ipc.coolifySetup.snapshot();
      // Overtaken while in flight. Answering with the read would put the
      // panel back on a step the run has already left, and leave a Cancel
      // button over a run that has finished until something refetches.
      if (eventCount.current !== before) {
        return (
          queryClient.getQueryData<SetupSnapshot>(queryKeys.coolify.setup) ??
          read
        );
      }
      return read;
    },
  });
}
