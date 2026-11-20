/**
 * Live native Claude Code turns that accept additional user messages
 * ("Send now" / steering). Keyed by chat: a chat runs at most one turn.
 */
type Sender = (text: string) => boolean;

const senders = new Map<number, Sender>();

/** Register the running turn's sender. Returns an unregister function that
 * only removes this exact registration. */
export function registerSteerTarget(chatId: number, send: Sender): () => void {
  senders.set(chatId, send);
  return () => {
    if (senders.get(chatId) === send) senders.delete(chatId);
  };
}

/** Whether `chatId` has a running native turn that accepts steering. */
export function canSteerChat(chatId: number): boolean {
  return senders.has(chatId);
}

/** Deliver `text` to the running turn. False when there is no running native
 * turn or it already finished answering. */
export function steerChat(chatId: number, text: string): boolean {
  const send = senders.get(chatId);
  if (!send) return false;
  return send(text);
}
