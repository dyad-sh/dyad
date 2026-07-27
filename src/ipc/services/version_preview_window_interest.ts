import {
  windowRegistry,
  type WindowRegistry,
} from "@/window_infrastructure/main/window_registry";

export type VersionPreviewWindowRelease =
  | "not-owned"
  | "retained-by-other-window"
  | "last-owner-released";

/**
 * Ephemeral main-process ownership of window-local Version presentation.
 *
 * Repository state remains in the app-keyed actor. This registry only answers
 * whether an explicit pane/app exit is the last live presentation interest
 * and may therefore ask that actor to return the repository.
 */
export class VersionPreviewWindowInterestService {
  private readonly windowIdsByAppId = new Map<number, Set<number>>();
  private readonly removeWindowListener: () => void;

  constructor(windows: Pick<WindowRegistry, "onUnregister"> = windowRegistry) {
    this.removeWindowListener = windows.onUnregister((webContentsId) => {
      // Renderer loss must not return the repository: the main-owned actor is
      // deliberately reload-safe. It only removes the stale window lease.
      this.removeWindow(webContentsId);
    });
  }

  acquire(appId: number, webContentsId: number): void {
    const owners = this.windowIdsByAppId.get(appId) ?? new Set<number>();
    owners.add(webContentsId);
    this.windowIdsByAppId.set(appId, owners);
  }

  release(appId: number, webContentsId: number): VersionPreviewWindowRelease {
    const owners = this.windowIdsByAppId.get(appId);
    if (!owners?.delete(webContentsId)) return "not-owned";
    if (owners.size > 0) return "retained-by-other-window";
    this.windowIdsByAppId.delete(appId);
    return "last-owner-released";
  }

  clearApp(appId: number): void {
    this.windowIdsByAppId.delete(appId);
  }

  clearAll(): void {
    this.windowIdsByAppId.clear();
  }

  inspect(appId: number): readonly number[] {
    return [...(this.windowIdsByAppId.get(appId) ?? [])];
  }

  dispose(): void {
    this.removeWindowListener();
    this.clearAll();
  }

  private removeWindow(webContentsId: number): void {
    for (const [appId, owners] of this.windowIdsByAppId) {
      owners.delete(webContentsId);
      if (owners.size === 0) this.windowIdsByAppId.delete(appId);
    }
  }
}

export const versionPreviewWindowInterestService =
  new VersionPreviewWindowInterestService();
