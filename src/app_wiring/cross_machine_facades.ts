import type { AppRunRemoteSnapshot } from "@/app_run/transport";
import type { ScreenshotCaptureSource } from "@/screenshot/state";

export interface ScreenshotRequestFacade {
  /** Remote intent: idempotent/current-agnostic. */
  requestCapture(appId: number, source: ScreenshotCaptureSource): void;
}

export interface PreviewReloadRequestFacade {
  /** Remote intent: idempotent/current-agnostic MANUAL_RELOAD. */
  requestManualReload(appId: number): void;
}

export interface AppRunStateSubscriptionFacade {
  /**
   * Remote intent: read/subscription. Events are post-commit, deferred, and
   * carry their authoritative invocation identity in the remote snapshot.
   */
  subscribeRunStateChanged(
    listener: (appId: number, state: AppRunRemoteSnapshot) => void,
  ): () => void;
}
