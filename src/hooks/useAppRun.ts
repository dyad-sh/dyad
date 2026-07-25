import { useAppRunManager } from "@/app_run/AppRunProvider";
import type { AppExit } from "@/app_run/selectors";
import type { RunState } from "@/app_run/state";
import { useKeyedController } from "@/state_machines/react";
import { useCallback, useSyncExternalStore } from "react";

const NO_APP_ID = -1;

/**
 * Subscribes to the run-state machine snapshot for an app. Returns the
 * idle state when no app is selected.
 */
export function useAppRunState(appId: number | null): RunState {
  const manager = useAppRunManager();
  return useKeyedController(manager, appId ?? NO_APP_ID);
}

/** Reads identity-admitted process exits without changing run transitions. */
export function useAppExit(appId: number | null): AppExit | null {
  const manager = useAppRunManager();
  const subscribe = useCallback(
    (listener: () => void) =>
      appId === null
        ? () => undefined
        : manager.subscribeAppExit(appId, listener),
    [appId, manager],
  );
  const getSnapshot = useCallback(
    () => (appId === null ? null : manager.getAppExitSnapshot(appId)),
    [appId, manager],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
