/**
 * Waits, or stops waiting when the run is cancelled.
 *
 * A bare timer means a cancel is noticed at the top of the next loop, which
 * for these intervals is seconds after the user pressed the button.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}
