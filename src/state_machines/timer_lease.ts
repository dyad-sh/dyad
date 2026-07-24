import type { Clock, ClockHandle } from "./clock";

interface TimerLease<Token, Event> {
  readonly token: Token;
  readonly handle: ClockHandle;
  readonly createEvent: (token: Token) => Event;
  readonly emit: (event: Event) => void;
}

/**
 * Minimal owner for operation-correlated timers.
 *
 * Replacing or removing a lease cancels it before the replacement is
 * installed. The callback also verifies that it still owns the key. Domains
 * carry the token in the event and reject stale events in their transition.
 */
export class TimerLeaseScope<Key, Token, Event> {
  private readonly leases = new Map<Key, TimerLease<Token, Event>>();
  private disposed = false;

  constructor(private readonly clock: Clock) {}

  replace(
    key: Key,
    token: Token,
    delayMs: number,
    createEvent: (token: Token) => Event,
    emit: (event: Event) => void,
  ): void {
    this.remove(key);
    if (this.disposed) return;
    const handle = this.clock.schedule(() => {
      const lease = this.leases.get(key);
      if (!lease || lease.handle !== handle || lease.token !== token) return;
      this.leases.delete(key);
      lease.emit(lease.createEvent(token));
    }, delayMs);
    this.leases.set(key, { token, handle, createEvent, emit });
  }

  remove(key: Key): void {
    const lease = this.leases.get(key);
    if (!lease) return;
    this.leases.delete(key);
    this.clock.cancel(lease.handle);
  }

  has(key: Key, token?: Token): boolean {
    const lease = this.leases.get(key);
    return (
      lease !== undefined && (token === undefined || lease.token === token)
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const lease of this.leases.values()) {
      this.clock.cancel(lease.handle);
    }
    this.leases.clear();
  }
}
