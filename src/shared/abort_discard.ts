const abortDiscardByChatId = new Map<number, boolean>();

export function setAbortDiscardForChat(chatId: number, discard: boolean) {
  abortDiscardByChatId.set(chatId, discard);
}

export function consumeAbortDiscardForChat(chatId: number): boolean {
  const discard = abortDiscardByChatId.get(chatId);
  abortDiscardByChatId.delete(chatId);
  return discard ?? true;
}

export function clearAbortDiscardForChat(chatId: number) {
  abortDiscardByChatId.delete(chatId);
}

