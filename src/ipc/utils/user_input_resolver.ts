/** Generic owner for main-process work awaiting a correlated renderer decision. */
interface PendingEntry<T> {
  chatId: number;
  resolve: (value: T | null) => void;
}

export interface UserInputResolverOptions {
  /** Auto-resolve with `null` after this many milliseconds. */
  timeoutMs?: number;
}

export interface UserInputResolver<T> {
  wait(
    requestId: string,
    chatId: number,
    abortSignal?: AbortSignal,
  ): Promise<T | null>;
  resolve(requestId: string, value: T | null): boolean;
  abortChat(chatId: number): void;
  abortAll(): void;
}

export function createUserInputResolver<T>(
  options: UserInputResolverOptions = {},
): UserInputResolver<T> {
  const pending = new Map<string, PendingEntry<T>>();

  const resolveEntry = (requestId: string, value: T | null): boolean => {
    const entry = pending.get(requestId);
    if (!entry) return false;
    pending.delete(requestId);
    entry.resolve(value);
    return true;
  };

  return {
    wait(requestId, chatId, abortSignal) {
      return new Promise<T | null>((resolve) => {
        if (abortSignal?.aborted) {
          resolve(null);
          return;
        }

        // A duplicate correlation id must not orphan the earlier waiter.
        resolveEntry(requestId, null);

        const timeout = options.timeoutMs
          ? setTimeout(() => resolveEntry(requestId, null), options.timeoutMs)
          : null;
        const onAbort = () => resolveEntry(requestId, null);
        abortSignal?.addEventListener("abort", onAbort, { once: true });

        pending.set(requestId, {
          chatId,
          resolve: (value) => {
            if (timeout) clearTimeout(timeout);
            abortSignal?.removeEventListener("abort", onAbort);
            resolve(value);
          },
        });
      });
    },

    resolve: resolveEntry,

    abortChat(chatId) {
      for (const [requestId, entry] of pending) {
        if (entry.chatId === chatId) resolveEntry(requestId, null);
      }
    },

    abortAll() {
      for (const requestId of pending.keys()) {
        resolveEntry(requestId, null);
      }
    },
  };
}
