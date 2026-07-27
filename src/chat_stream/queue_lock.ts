const queueMutationTails = new Map<number, Promise<void>>();

/**
 * Serializes queue compare-and-swap mutations with message acceptance for one
 * chat. The tail contains only a completion gate, so a failed task never
 * poisons later queue work.
 */
export async function withChatQueueLock<T>(
  chatId: number,
  task: () => T | Promise<T>,
): Promise<T> {
  const previous = queueMutationTails.get(chatId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  queueMutationTails.set(chatId, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (queueMutationTails.get(chatId) === current) {
      queueMutationTails.delete(chatId);
    }
  }
}
