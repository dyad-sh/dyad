const locks = new Map<string, Promise<void>>();

/**
 * Build the lock ID used to serialize mutations to a single file path.
 * File writers, deletes, and both sides of a rename must use this so they
 * don't race against each other on the same physical path.
 */
export function getFileWriteKey(filePath: string): string {
  return `filewrite:${filePath}`;
}

/**
 * Executes a function with a lock on the lock ID.
 * Uses promise-chaining so that queued operations execute serially,
 * preventing the race where multiple waiters all acquire simultaneously.
 *
 * @param lockId The lock ID to lock
 * @param fn The function to execute with the lock
 * @returns Result of the function
 */
export function withLock<T>(lockId: string, fn: () => Promise<T>): Promise<T> {
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

/**
 * Acquires several locks in one canonical order before running an operation.
 * Sorting and deduplicating prevents two multi-path operations (for example,
 * opposing renames) from deadlocking while preserving the single-file lock
 * protocol used by other writers.
 */
export function withLocks<T>(
  lockIds: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const orderedLockIds = [...new Set(lockIds)].sort();
  const acquire = (index: number): Promise<T> => {
    const lockId = orderedLockIds[index];
    return lockId === undefined
      ? fn()
      : withLock(lockId, () => acquire(index + 1));
  };
  return acquire(0);
}
