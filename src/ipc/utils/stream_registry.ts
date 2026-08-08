/**
 * The set of answers currently being generated, one per conversation.
 *
 * Conversations run independently — a user can ask something in one tab and
 * switch to another while it works — so every operation here is scoped to a
 * single session. The invariants that matter:
 *
 *  - starting a turn never disturbs another conversation's turn;
 *  - a finished turn retracts only its own registration, never the one a
 *    newer turn has already installed in its place;
 *  - cancelling reaches the stream that is actually running.
 */
export class StreamRegistry<T extends { abort: () => void }> {
  private readonly controllers = new Map<string, T>();

  /** How many answers are in flight. */
  get size(): number {
    return this.controllers.size;
  }

  /**
   * Registers this session's controller, stopping any earlier turn for the
   * same session. Other sessions are left alone.
   */
  register(sessionId: string, controller: T): void {
    this.abort(sessionId);
    this.controllers.set(sessionId, controller);
  }

  /** Stops one session's stream. Returns whether there was one to stop. */
  abort(sessionId: string): boolean {
    const existing = this.controllers.get(sessionId);
    if (!existing) return false;
    existing.abort();
    this.controllers.delete(sessionId);
    return true;
  }

  /**
   * Removes a controller once its turn is over — but only if it is still the
   * registered one. A slow teardown must not evict the turn that replaced it.
   */
  retire(sessionId: string, controller: T): void {
    if (this.controllers.get(sessionId) === controller) {
      this.controllers.delete(sessionId);
    }
  }

  has(sessionId: string): boolean {
    return this.controllers.has(sessionId);
  }
}
