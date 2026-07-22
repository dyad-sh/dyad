import type { createStore } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { KeyedControllerHost } from "@/state_machines/keyed_host";
import { createTraceObserver } from "@/state_machines/trace";
import {
  VersionPreviewController,
  type VersionPreviewRuntime,
} from "./controller";
import { CLOSED_STATE, type PreviewError, type PreviewEvent } from "./state";

type JotaiStore = ReturnType<typeof createStore>;

export interface VersionPreviewRecoveryEntry {
  appId: number;
  error: PreviewError;
  retry: () => void;
}

const EMPTY_RECOVERY_ENTRIES: VersionPreviewRecoveryEntry[] = [];

export class VersionPreviewManager {
  private readonly host: KeyedControllerHost<number, VersionPreviewController>;
  private readonly recoveryListeners = new Set<() => void>();
  private recoveryEntries: VersionPreviewRecoveryEntry[] =
    EMPTY_RECOVERY_ENTRIES;
  private readonly unsubscribeHost: () => void;
  private unsubscribeStore: (() => void) | null = null;
  private previousAppId: number | null;
  private disposed = false;

  constructor(
    private readonly runtime: VersionPreviewRuntime,
    private readonly store: JotaiStore,
  ) {
    this.host = new KeyedControllerHost(
      (appId) =>
        new VersionPreviewController(
          appId,
          runtime,
          createTraceObserver("version_preview", appId),
        ),
    );
    this.previousAppId = store.get(selectedAppIdAtom);
    this.unsubscribeHost = this.host.subscribeAny(() => {
      const previous = this.recoveryEntries;
      const next = this.buildRecoveryEntries();
      if (next !== previous) {
        this.recoveryEntries = next;
        for (const listener of this.recoveryListeners) listener();
      }
    });
  }

  /** Connects external subscriptions after React has committed the provider. */
  start(): void {
    if (this.disposed) {
      throw new Error("Cannot start a disposed version preview manager");
    }
    if (this.unsubscribeStore) return;
    this.previousAppId = this.store.get(selectedAppIdAtom);
    this.unsubscribeStore = this.store.sub(selectedAppIdAtom, () => {
      const nextAppId = this.store.get(selectedAppIdAtom);
      const previousAppId = this.previousAppId;
      this.previousAppId = nextAppId;
      if (previousAppId !== null && previousAppId !== nextAppId) {
        this.host.get(previousAppId)?.send({ type: "APP_CHANGED", nextAppId });
      }
    });
  }

  getSnapshot = (appId: number) =>
    this.host.get(appId)?.getSnapshot() ?? CLOSED_STATE;

  subscribeKey = (appId: number, listener: () => void) =>
    this.host.subscribeKey(appId, listener);

  send(appId: number, event: PreviewEvent): void {
    this.start();
    this.host.ensure(appId).send(event);
  }

  sendAndWaitForMutation(appId: number, event: PreviewEvent): Promise<void> {
    this.start();
    return this.host.ensure(appId).sendAndWaitForMutation(event);
  }

  getRecoveryEntries = (): VersionPreviewRecoveryEntry[] =>
    this.recoveryEntries;

  subscribeRecovery = (listener: () => void): (() => void) => {
    this.recoveryListeners.add(listener);
    return () => this.recoveryListeners.delete(listener);
  };

  disposeKey = (appId: number): void => {
    const snapshot = this.host.get(appId)?.getSnapshot();
    if (snapshot?.type === "recovery-required") {
      this.runtime.dismissRecovery(appId);
    }
    this.host.disposeKey(appId);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.unsubscribeHost();
    this.host.dispose();
    this.recoveryListeners.clear();
    this.recoveryEntries = EMPTY_RECOVERY_ENTRIES;
  }

  private buildRecoveryEntries(): VersionPreviewRecoveryEntry[] {
    const next = this.host.keys().flatMap((appId) => {
      const snapshot = this.host.get(appId)?.getSnapshot();
      if (snapshot?.type !== "recovery-required") return [];
      return [
        {
          appId,
          error: snapshot.error,
          retry: () => this.send(appId, { type: "RETRY_RETURN" }),
        },
      ];
    });
    if (next.length === 0) return EMPTY_RECOVERY_ENTRIES;
    if (
      next.length === this.recoveryEntries.length &&
      next.every(
        (entry, index) =>
          entry.appId === this.recoveryEntries[index].appId &&
          entry.error === this.recoveryEntries[index].error,
      )
    ) {
      return this.recoveryEntries;
    }
    return next;
  }
}
