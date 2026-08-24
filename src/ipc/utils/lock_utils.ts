import fs from "node:fs";
import path from "node:path";

const locks = new Map<string, Promise<void>>();

/**
 * Build the lock ID used to serialize mutations to a single physical file
 * path. The existing parent is canonicalized without following the final
 * entry, so aliases to the app root share a key while delete/rename can still
 * lock a symlink entry rather than its target.
 */
export async function getFileWriteKey(filePath: string): Promise<string> {
  const finalEntryName = path.basename(filePath);
  let existingParent = path.dirname(filePath);
  const missingSegments: string[] = [];

  for (;;) {
    try {
      const realParent = await fs.promises.realpath(existingParent);
      return `filewrite:${path.join(realParent, ...missingSegments, finalEntryName)}`;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw error;
      }
      const parent = path.dirname(existingParent);
      if (parent === existingParent) {
        throw error;
      }
      missingSegments.unshift(path.basename(existingParent));
      existingParent = parent;
    }
  }
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
