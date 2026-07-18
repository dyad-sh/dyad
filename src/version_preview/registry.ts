/**
 * Module-scope registry of version preview controllers, keyed by appId.
 *
 * Controllers live outside React so an active checkout, return, or recovery
 * survives pane unmounts, chat navigation, and app switches. Controllers are
 * cached for the lifetime of the renderer (a handful of apps per session);
 * a controller whose state is closed simply sits idle until its app opens
 * Version History again.
 */

import type { PreviewError, PreviewEvent } from "./state";
import {
  VersionPreviewController,
  type VersionPreviewRuntime,
} from "./controller";

const controllers = new Map<number, VersionPreviewController>();
const registryListeners = new Set<() => void>();

let runtime: VersionPreviewRuntime | null = null;
let recoveryCache: VersionPreviewRecoveryEntry[] | null = null;

export interface VersionPreviewRecoveryEntry {
  appId: number;
  error: PreviewError;
  retry: () => void;
}

/**
 * Installs the production (or test) command runtime. First call wins so the
 * wiring stays stable for the renderer's lifetime; tests reset in between.
 */
export function initVersionPreviewRuntime(next: VersionPreviewRuntime): void {
  if (runtime === null) {
    runtime = next;
  }
}

export function isVersionPreviewRuntimeInitialized(): boolean {
  return runtime !== null;
}

function notifyRegistry(): void {
  recoveryCache = null;
  for (const listener of registryListeners) {
    listener();
  }
}

export function ensureVersionPreviewController(
  appId: number,
): VersionPreviewController {
  let controller = controllers.get(appId);
  if (!controller) {
    if (!runtime) {
      throw new Error(
        "Version preview runtime is not initialized. Call initVersionPreviewRuntime first.",
      );
    }
    controller = new VersionPreviewController(appId, runtime);
    controllers.set(appId, controller);
    controller.subscribe(notifyRegistry);
    notifyRegistry();
  }
  return controller;
}

export function getVersionPreviewController(
  appId: number,
): VersionPreviewController | undefined {
  return controllers.get(appId);
}

/**
 * Sends APP_CHANGED to the app the user navigated away from so its session
 * drains (returns its repository) in the background.
 */
export function notifyVersionPreviewAppChanged(
  previousAppId: number,
  nextAppId: number | null,
): void {
  controllers
    .get(previousAppId)
    ?.send({ type: "APP_CHANGED", nextAppId } satisfies PreviewEvent);
}

/** Subscribe to any state change in any controller. */
export function subscribeVersionPreviewRegistry(
  listener: () => void,
): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

/**
 * All sessions currently stuck in recovery-required, across apps. Cached so
 * useSyncExternalStore sees a stable reference between changes.
 */
export function getVersionPreviewRecoveryEntries(): VersionPreviewRecoveryEntry[] {
  if (recoveryCache === null) {
    recoveryCache = [...controllers.values()].flatMap((controller) => {
      const snapshot = controller.getSnapshot();
      if (snapshot.type !== "recovery-required") {
        return [];
      }
      return [
        {
          appId: controller.appId,
          error: snapshot.error,
          retry: () => controller.send({ type: "RETRY_RETURN" }),
        },
      ];
    });
  }
  return recoveryCache;
}

/** Test-only: drop all controllers and the installed runtime. */
export function resetVersionPreviewForTests(): void {
  controllers.clear();
  registryListeners.clear();
  runtime = null;
  recoveryCache = null;
}
