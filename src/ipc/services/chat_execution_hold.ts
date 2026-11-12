/** Temporary app-wide holds stop queue dispatch without changing user pause state. */
export class ChatExecutionHold {
  private readonly counts = new Map<number, number>();
  private readonly listeners = new Map<number, Set<(held: boolean) => void>>();

  isHeld(appId: number): boolean {
    return this.counts.has(appId);
  }

  acquire(appId: number): () => void {
    const count = this.counts.get(appId) ?? 0;
    this.counts.set(appId, count + 1);
    if (count === 0) this.publish(appId, true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.counts.get(appId) ?? 1) - 1;
      if (remaining > 0) {
        this.counts.set(appId, remaining);
      } else {
        this.counts.delete(appId);
        this.publish(appId, false);
      }
    };
  }

  subscribe(appId: number, listener: (held: boolean) => void): () => void {
    let listeners = this.listeners.get(appId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(appId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(appId);
    };
  }

  private publish(appId: number, held: boolean): void {
    for (const listener of this.listeners.get(appId) ?? []) listener(held);
  }
}

export const chatExecutionHold = new ChatExecutionHold();
