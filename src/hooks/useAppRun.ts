import { useCallback, useSyncExternalStore } from "react";
import { useAppRunManager } from "@/app_run/AppRunProvider";
import {
  selectRemoteAppUrl,
  type AppExit,
  type AppUrlState,
} from "@/app_run/selectors";
import {
  projectAppRunRemoteSnapshot,
  type AppRunRemoteSnapshot,
} from "@/app_run/transport";
import type { RunState } from "@/app_run/state";
import { NO_APP_RUN_REMOTE_SNAPSHOT } from "@/app_run/remote_manager";

/**
 * Subscribes to the run-state machine snapshot for an app. Returns the
 * idle state when no app is selected.
 */
export function useAppRunState(appId: number | null): AppRunRemoteSnapshot {
  const manager = useAppRunManager();
  const subscribe = useCallback(
    (listener: () => void) =>
      appId === null ? () => undefined : manager.subscribeKey(appId, listener),
    [appId, manager],
  );
  const getSnapshot = useCallback(
    () =>
      appId === null ? NO_APP_RUN_REMOTE_SNAPSHOT : manager.getSnapshot(appId),
    [appId, manager],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (appId === null) return NO_APP_RUN_REMOTE_SNAPSHOT;
  return "phase" in snapshot
    ? snapshot
    : projectAppRunRemoteSnapshot(appId, 0, snapshot as RunState);
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
  return selectRemoteAppUrl(useAppRunState(appId));
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
