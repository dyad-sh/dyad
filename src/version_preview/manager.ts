import type { createStore } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { KeyedControllerHost } from "@/state_machines/keyed_host";
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
  private readonly unsubscribeStore: () => void;
  private previousAppId: number | null;

  constructor(
    private readonly runtime: VersionPreviewRuntime,
    private readonly store: JotaiStore,
  ) {
    this.host = new KeyedControllerHost(
      (appId) => new VersionPreviewController(appId, runtime),
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
    this.unsubscribeStore = store.sub(selectedAppIdAtom, () => {
      const nextAppId = store.get(selectedAppIdAtom);
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
    this.host.ensure(appId).send(event);
  }

  sendAndWaitForMutation(appId: number, event: PreviewEvent): Promise<void> {
    return this.host.ensure(appId).sendAndWaitForMutation(event);
  }

  getRecoveryEntries = (): VersionPreviewRecoveryEntry[] =>
    this.recoveryEntries;

  subscribeRecovery = (listener: () => void): (() => void) => {
    this.recoveryListeners.add(listener);
    return () => this.recoveryListeners.delete(listener);
  };

  disposeApp(appId: number): void {
    const snapshot = this.host.get(appId)?.getSnapshot();
    if (snapshot?.type === "recovery-required") {
      this.runtime.dismissRecovery(appId);
    }
    this.host.disposeKey(appId);
  }

  dispose(): void {
    this.unsubscribeStore();
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
