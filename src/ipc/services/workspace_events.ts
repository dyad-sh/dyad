import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import { chatWorkspaceRegistry } from "./chat_workspace_registry";

/** Tells every window to refetch workspace status for an app. */
export function publishWorkspaceChanged(appId: number): void {
  queryInvalidationBus.publish([{ family: "workspaces", appId }]);
}

let unsubscribeRegistry: (() => void) | null = null;

/**
 * Running writable turns drive the "another chat is working" banner and the
 * workspace indicator, so registry changes are published as invalidations.
 */
export function startPublishingWorkspaceRegistryChanges(): void {
  if (unsubscribeRegistry) return;
  unsubscribeRegistry = chatWorkspaceRegistry.subscribe(
    publishWorkspaceChanged,
  );
}
