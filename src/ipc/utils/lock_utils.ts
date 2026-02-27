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
 * Executes a function with a lock on the lock ID.
 * Callers form a queue: each waits for the previous holder before proceeding.
 * @param lockId The lock ID to lock
 * @param fn The function to execute with the lock
 * @returns Result of the function
 */
export async function withLock<T>(
  lockId: number | string,
  fn: () => Promise<T>,
): Promise<T> {
  // Capture the current tail of the queue (if any)
  const predecessor = locks.get(lockId);

  // Create our own lock promise and install it as the new tail
  // so that any subsequent caller queues behind us.
  let release!: () => void;
  const ourLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(lockId, ourLock);

  // Wait for the previous holder to finish
  if (predecessor) {
    await predecessor;
  }

  try {
    return await fn();
  } finally {
    // Only clean up the map entry if no one else has queued after us
    if (locks.get(lockId) === ourLock) {
      locks.delete(lockId);
    }
    release();
  }
}
