import { useCallback, useSyncExternalStore } from "react";
import { useAppRunRemoteManager } from "@/app_run/AppRunRemoteProvider";
import {
  selectRemoteAppExit,
  selectRemoteAppUrl,
  type AppExit,
  type AppUrlState,
} from "@/app_run/selectors";
import type { AppRunRemoteSnapshot } from "@/app_run/transport";
import { NO_APP_RUN_REMOTE_SNAPSHOT } from "@/app_run/remote_manager";

/**
 * Subscribes to the run-state machine snapshot for an app. Returns the
 * idle state when no app is selected.
 */
export function useAppRunState(appId: number | null): AppRunRemoteSnapshot {
  const manager = useAppRunRemoteManager();
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
  return snapshot;
}

/** Reads identity-admitted process exits from the manager-owned read model. */
export function useAppExit(appId: number | null): AppExit | null {
  return selectRemoteAppExit(useAppRunState(appId));
}

export function useCurrentAppUrl(appId: number | null): AppUrlState {
  return selectRemoteAppUrl(useAppRunState(appId));
}

export function usePreviewReloadToken(appId: number | null): number {
  return useAppRunState(appId).previewReloadEpoch;
}
