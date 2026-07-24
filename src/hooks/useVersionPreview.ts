import { useCallback, useSyncExternalStore } from "react";
import { useKeyedController } from "@/state_machines/react";
import { useVersionPreviewManager } from "@/version_preview/VersionPreviewProvider";
import {
  CLOSED_STATE,
  type PreviewEvent,
  type PreviewState,
} from "@/version_preview/state";
import type { VersionPreviewRecoveryEntry } from "@/version_preview/manager";
import {
  projectVersionPreview,
  type VersionPreviewProjection,
} from "@/version_preview/projection";

const NULL_APP_ID = -1;

export function useVersionPreview(appId: number | null): {
  state: PreviewState;
  projection: VersionPreviewProjection;
  send: (event: PreviewEvent) => void;
  sendAndWaitForMutation: (event: PreviewEvent) => Promise<void>;
} {
  const manager = useVersionPreviewManager();
  const state = useKeyedController(manager, appId ?? NULL_APP_ID);
  const send = useCallback(
    (event: PreviewEvent) => {
      if (appId !== null) manager.send(appId, event);
    },
    [appId, manager],
  );
  const sendAndWaitForMutation = useCallback(
    (event: PreviewEvent) =>
      appId === null
        ? Promise.resolve()
        : manager.sendAndWaitForMutation(appId, event),
    [appId, manager],
  );
  const effectiveState = appId === null ? CLOSED_STATE : state;
  return {
    state: effectiveState,
    projection: projectVersionPreview(effectiveState),
    send,
    sendAndWaitForMutation,
  };
}

export function useVersionPreviewRecovery(): VersionPreviewRecoveryEntry[] {
  const manager = useVersionPreviewManager();
  return useSyncExternalStore(
    manager.subscribeRecovery,
    manager.getRecoveryEntries,
  );
}

export { useVersionPreviewManager };
