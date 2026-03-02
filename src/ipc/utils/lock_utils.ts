const locks = new Map<number | string, Promise<void>>();

/**
 * Executes a function with a lock on the lock ID.
 * Uses promise-chaining so that queued operations execute serially,
 * preventing the race where multiple waiters all acquire simultaneously.
 *
 * @param lockId The lock ID to lock
 * @param fn The function to execute with the lock
 * @returns Result of the function
 */
export function withLock<T>(
  lockId: number | string,
  fn: () => Promise<T>,
): Promise<T> {
  const lastOperation = locks.get(lockId) ?? Promise.resolve();

  let resolve: () => void;
  const newLock = new Promise<void>((r) => {
    resolve = r;
  });
  locks.set(lockId, newLock);

  const result = lastOperation.then(async () => {
    try {
      return await fn();
    } finally {
      resolve();
      if (locks.get(lockId) === newLock) {
        locks.delete(lockId);
      }
    }
  });

  return result;
}
