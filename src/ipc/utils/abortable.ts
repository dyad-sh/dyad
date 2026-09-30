/** Stop waiting without letting a late result advance the cancelled caller. */
export function abortable<T>(
  work: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new Error("Operation cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    void work.then(resolve, reject).then(cleanup);
  });
}

/** Cancel the timer as well as the wait so cancelled retries do not linger. */
export function abortableDelay(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
