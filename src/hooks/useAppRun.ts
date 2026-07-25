import { useCallback, useSyncExternalStore } from "react";
import { useAppRunManager } from "@/app_run/AppRunProvider";
import {
  selectAppUrl,
  type AppExit,
  type AppUrlState,
} from "@/app_run/selectors";
import type { RunState } from "@/app_run/state";
import { useKeyedController } from "@/state_machines/react";

const NO_APP_ID = -1;

/**
 * Subscribes to the run-state machine snapshot for an app. Returns the
 * idle state when no app is selected.
 */
export function useAppRunState(appId: number | null): RunState {
  const manager = useAppRunManager();
  return useKeyedController(manager, appId ?? NO_APP_ID);
}

/** Reads identity-admitted process exits from the manager-owned read model. */
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
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useCurrentAppUrl(appId: number | null): AppUrlState {
  return selectAppUrl(useAppRunState(appId));
}

export function usePreviewReloadToken(appId: number | null): number {
  const manager = useAppRunManager();
  const subscribe = useCallback(
    (listener: () => void) =>
      appId === null
        ? () => undefined
        : manager.subscribeReloadToken(appId, listener),
    [appId, manager],
  );
  const getSnapshot = useCallback(
    () => (appId === null ? 0 : manager.getReloadToken(appId)),
    [appId, manager],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
