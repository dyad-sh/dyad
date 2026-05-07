/**
 * Generic factory for "agent tool pauses execution and waits for user input"
 * flows. Used by questionnaire and add_integration; suitable for future tools
 * that follow the same request/response pattern.
 *
 * Usage:
 *   const integrationResolver = createUserInputResolver<IntegrationResult>({
 *     timeoutMs: 30 * 60 * 1000,
 *   });
 *   await integrationResolver.wait(requestId, chatId, abortSignal);
 *   integrationResolver.resolve(requestId, result);
 *   integrationResolver.abortChat(chatId); // on stream cancel
 */

interface PendingEntry<T> {
  chatId: number;
  resolve: (value: T | null) => void;
}

export interface UserInputResolverOptions {
  /**
   * Auto-resolve with `null` after this many ms. Omit to disable.
   */
  timeoutMs?: number;
}

export interface UserInputResolver<T> {
  wait(
    requestId: string,
    chatId: number,
    abortSignal?: AbortSignal,
  ): Promise<T | null>;
  /** Returns true if a pending entry was found and resolved. */
  resolve(requestId: string, value: T | null): boolean;
  /** Resolve all pending entries for a chat with `null`. */
  abortChat(chatId: number): void;
}

export function createUserInputResolver<T>(
  options: UserInputResolverOptions = {},
): UserInputResolver<T> {
  const pending = new Map<string, PendingEntry<T>>();

  return {
    wait(requestId, chatId, abortSignal) {
      return new Promise<T | null>((resolve) => {
        if (abortSignal?.aborted) {
          resolve(null);
          return;
        }

        const timeout = options.timeoutMs
          ? setTimeout(() => {
              const entry = pending.get(requestId);
              if (entry) {
                pending.delete(requestId);
                entry.resolve(null);
              }
            }, options.timeoutMs)
          : null;

        const onAbort = () => {
          const entry = pending.get(requestId);
          if (entry) {
            pending.delete(requestId);
            entry.resolve(null);
          }
        };
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

    resolve(requestId, value) {
      const entry = pending.get(requestId);
      if (!entry) return false;
      pending.delete(requestId);
      entry.resolve(value);
      return true;
    },

    abortChat(chatId) {
      for (const [requestId, entry] of pending) {
        if (entry.chatId === chatId) {
          pending.delete(requestId);
          entry.resolve(null);
        }
      }
    },
  };
}
