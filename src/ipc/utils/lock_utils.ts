const locks = new Map<number | string, Promise<void>>();

/**
 * Acquires a lock for an app operation
 * @param lockId The app ID to lock
 * @returns An object with release function and promise
 */
export function acquireLock(lockId: number | string): {
  release: () => void;
  promise: Promise<void>;
} {
  let release: () => void = () => {};

  const promise = new Promise<void>((resolve) => {
    release = () => {
      locks.delete(lockId);
      resolve();
    };
  });

  locks.set(lockId, promise);
  return { release, promise };
}

/**
 * Executes a function with a lock on the lock ID
 * @param lockId The lock ID to lock
 * @param fn The function to execute with the lock
 * @returns Result of the function
 */
export async function withLock<T>(
  lockId: number | string,
  fn: () => Promise<T>,
): Promise<T> {
  // Wait for any existing operation to complete
  const existingLock = locks.get(lockId);
  if (existingLock) {
    await existingLock;
  }

  // Acquire a new lock
  const { release } = acquireLock(lockId);

  try {
    const result = await fn();
    return result;
  } finally {
    release();
  }
}
