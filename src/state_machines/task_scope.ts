export type TaskCleanup = () => void;

function appendError(errors: unknown[], error: unknown): void {
  if (error instanceof AggregateError) {
    errors.push(...error.errors);
    return;
  }
  errors.push(error);
}

/**
 * Owns keyed resources and async setup compensation for one lifecycle.
 *
 * Cleanup is synchronous by design: callers can rely on disposal completing
 * before the owner releases its final projection or returns from an unmount.
 */
export class TaskScope<Key = PropertyKey> {
  private readonly cleanups = new Map<Key, TaskCleanup>();
  private disposed = false;

  replace(key: Key, cleanup: TaskCleanup): void {
    if (this.disposed) {
      cleanup();
      return;
    }
    const previous = this.cleanups.get(key);
    this.cleanups.set(key, cleanup);
    previous?.();
  }

  remove(key: Key): void {
    const cleanup = this.cleanups.get(key);
    if (!cleanup) return;
    this.cleanups.delete(key);
    cleanup();
  }

  /**
   * Adds compensation for setup that can settle after disposal.
   *
   * The returned promise preserves a successful value unless compensation
   * fails. If setup and compensation both fail, both errors are retained.
   * Callers must await or otherwise handle it just as they would the input.
   */
  trackPromise<T>(promise: Promise<T>, lateCleanup: TaskCleanup): Promise<T> {
    return promise.then(
      (value) => {
        if (this.disposed) lateCleanup();
        return value;
      },
      (error: unknown) => {
        if (this.disposed) {
          try {
            lateCleanup();
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Tracked task and late cleanup failed",
            );
          }
        }
        throw error;
      },
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    const cleanups = Array.from(this.cleanups.values()).reverse();
    this.cleanups.clear();
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        appendError(errors, error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "TaskScope disposal failed");
    }
  }
}

export function collectDisposalError(
  errors: unknown[],
  operation: () => void,
): void {
  try {
    operation();
  } catch (error) {
    appendError(errors, error);
  }
}
