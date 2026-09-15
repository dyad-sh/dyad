/** Stop waiting without cancelling shared account/token refreshes used by other chats. */
export async function awaitTurnPreflight<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
