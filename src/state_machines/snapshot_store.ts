/** Reference-stable external store for immutable machine snapshots. */
export class SnapshotStore<State> {
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(private state: State) {}

  getSnapshot = (): State => this.state;

  setState(nextState: State, beforeNotify?: () => void): boolean {
    if (this.disposed || nextState === this.state) return false;
    this.state = nextState;
    beforeNotify?.();
    for (const listener of this.listeners) listener();
    return true;
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }
}
