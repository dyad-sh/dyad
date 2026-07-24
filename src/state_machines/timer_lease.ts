import type { Clock, ClockHandle } from "./clock";
import { TaskScope } from "./task_scope";

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
  private readonly ownership = new TaskScope<Key>();
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
      this.ownership.remove(key);
      lease.emit(lease.createEvent(token));
    }, delayMs);
    const lease = { token, handle, createEvent, emit };
    this.leases.set(key, lease);
    this.ownership.replace(key, () => {
      if (this.leases.get(key) === lease) this.leases.delete(key);
      this.clock.cancel(handle);
    });
  }

  remove(key: Key): void {
    this.ownership.remove(key);
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
    this.ownership.dispose();
  }
}
