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
/**
 * Bumped each time an app's controller transitions into (or re-surfaces
 * within) recovery-required. Lets the recovery snapshot distinguish "the
 * recovery set actually changed / must re-surface" from unrelated
 * controller activity, so subscribers are not re-rendered and toasts are
 * not re-issued for no reason.
 */
const recoveryNonceByAppId = new Map<number, number>();

let runtime: VersionPreviewRuntime | null = null;
let recoveryCache: VersionPreviewRecoveryEntry[] | null = null;
let lastRecoveryEntries: VersionPreviewRecoveryEntry[] = [];

export interface VersionPreviewRecoveryEntry {
  appId: number;
  error: PreviewError;
  retry: () => void;
  /** Increments on entry into recovery and on deliberate re-surfacing. */
  resurfaceNonce: number;
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
    const created = new VersionPreviewController(appId, runtime);
    controller = created;
    controllers.set(appId, created);
    created.subscribe(() => {
      // Every state change lands here (including the identity-only refresh
      // recovery-required emits for OPEN); a recovery-required snapshot
      // bumps the nonce so the recovery entries visibly change.
      if (created.getSnapshot().type === "recovery-required") {
        recoveryNonceByAppId.set(
          appId,
          (recoveryNonceByAppId.get(appId) ?? 0) + 1,
        );
      }
      notifyRegistry();
    });
    // Deliberately no notifyRegistry() here: creation happens in event
    // handlers via send(), but must stay silent so it is also safe from a
    // render if a caller ever moves it there; a fresh controller is always
    // closed so the recovery snapshot is unchanged.
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

const EMPTY_RECOVERY_ENTRIES: VersionPreviewRecoveryEntry[] = [];

function sameRecoveryEntries(
  a: VersionPreviewRecoveryEntry[],
  b: VersionPreviewRecoveryEntry[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.appId === b[index].appId &&
        entry.error.message === b[index].error.message &&
        entry.resurfaceNonce === b[index].resurfaceNonce,
    )
  );
}

/**
 * All sessions currently stuck in recovery-required, across apps. The
 * returned reference only changes when the recovery set itself changes
 * (membership, error, or a deliberate re-surface), so unrelated controller
 * activity never re-renders subscribers or re-issues toasts.
 */
export function getVersionPreviewRecoveryEntries(): VersionPreviewRecoveryEntry[] {
  if (recoveryCache === null) {
    const rebuilt = [...controllers.values()].flatMap((controller) => {
      const snapshot = controller.getSnapshot();
      if (snapshot.type !== "recovery-required") {
        return [];
      }
      return [
        {
          appId: controller.appId,
          error: snapshot.error,
          retry: () => controller.send({ type: "RETRY_RETURN" }),
          resurfaceNonce: recoveryNonceByAppId.get(controller.appId) ?? 0,
        },
      ];
    });
    if (rebuilt.length === 0) {
      recoveryCache = EMPTY_RECOVERY_ENTRIES;
    } else if (sameRecoveryEntries(rebuilt, lastRecoveryEntries)) {
      recoveryCache = lastRecoveryEntries;
    } else {
      recoveryCache = rebuilt;
    }
    lastRecoveryEntries = recoveryCache;
  }
  return recoveryCache;
}

/** Test-only: drop all controllers and the installed runtime. */
export function resetVersionPreviewForTests(): void {
  controllers.clear();
  registryListeners.clear();
  recoveryNonceByAppId.clear();
  runtime = null;
  recoveryCache = null;
  lastRecoveryEntries = [];
}
