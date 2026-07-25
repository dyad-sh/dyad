import { KeyedControllerHost } from "@/state_machines/keyed_host";
import { SnapshotStore } from "@/state_machines/snapshot_store";

export type PackageManagerWarningKind = "release-age" | "pnpm-migration";

export interface PackageManagerWarning {
  kind: PackageManagerWarningKind;
  message: string;
  appId: number;
}

type StoredWarning = Omit<PackageManagerWarning, "appId">;

const PRIORITY: Record<PackageManagerWarningKind, number> = {
  "pnpm-migration": 1,
  "release-age": 2,
};

class WarningSnapshot {
  private readonly store = new SnapshotStore<PackageManagerWarning | undefined>(
    undefined,
  );

  constructor(private readonly appId: number) {}

  getSnapshot = this.store.getSnapshot;
  subscribe = this.store.subscribe;

  set(warning: StoredWarning): void {
    const current = this.store.getSnapshot();
    if (current && PRIORITY[current.kind] > PRIORITY[warning.kind]) return;
    this.store.setState({ ...warning, appId: this.appId });
  }

  dispose(): void {
    this.store.dispose();
  }
}

/** Source boundary for local today and remote/main producers later. */
export interface PackageManagerWarningSource {
  /** Remote intent: state-sensitive presentation update. */
  setWarning(appId: number, warning: StoredWarning): void;
  /** Remote intent: idempotent presentation clear. */
  clear(appId: number): void;
}

export class PackageManagerWarningStore implements PackageManagerWarningSource {
  private readonly host = new KeyedControllerHost<number, WarningSnapshot>(
    (appId) => new WarningSnapshot(appId),
  );
  private readonly dismissedAppIds = new Set<number>();

  getSnapshot = (appId: number): PackageManagerWarning | undefined => {
    return this.host.get(appId)?.getSnapshot();
  };

  subscribeKey = (appId: number, listener: () => void): (() => void) =>
    this.host.subscribeKey(appId, listener);

  setWarning(appId: number, warning: StoredWarning): void {
    if (this.dismissedAppIds.has(appId)) return;
    this.host.ensure(appId).set(warning);
  }

  clear(appId: number): void {
    this.host.disposeKey(appId);
  }

  dismiss(appId: number): void {
    this.dismissedAppIds.add(appId);
    this.clear(appId);
  }

  clearAllForApp = (appId: number): void => {
    this.dismissedAppIds.delete(appId);
    this.clear(appId);
  };

  dispose(): void {
    this.dismissedAppIds.clear();
    this.host.dispose();
  }
}
