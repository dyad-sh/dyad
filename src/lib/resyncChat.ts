import { ipc } from "@/ipc/types";
import type { Message } from "@/ipc/types";
import type { getDefaultStore } from "jotai";
import {
  isStreamingByIdAtom,
  chatStreamCountByIdAtom,
} from "@/atoms/chatAtoms";

const pendingResyncChatIds = new Set<number>();

const RESYNC_TIMEOUT_MS = 10_000;

/**
 * Merges a DB messages snapshot into the live renderer messages for a chat.
 * For the streaming message, keeps the live version only when it is a valid
 * extension of the DB snapshot: live content must be longer AND must start with
 * the full DB content (proving patches correctly advanced the renderer past the
 * snapshot without corrupting the base).
 * Falls back to the DB version otherwise, including when live content is longer
 * but has a wrong prefix (corrupted base that caused the patch failure).
 */
export function mergeResyncMessages(
  dbMessages: Message[],
  prevMessages: Message[],
): Message[] {
  return dbMessages.map((dbMsg) => {
    const live = prevMessages.find((m) => m.id === dbMsg.id);
    if (!live) return dbMsg;
    const dbContent = dbMsg.content ?? "";
    const liveContent = live.content ?? "";
    if (
      liveContent.length > dbContent.length &&
      liveContent.startsWith(dbContent)
    ) {
      return live;
    }
    return dbMsg;
  });
}

type SetMessagesById = (
  update: (prev: Map<number, Message[]>) => Map<number, Message[]>,
) => void;

/**
 * Fetches the latest DB snapshot for a chat and writes it into the atom.
 * Used in onEnd and onError handlers as an authoritative final sync.
 * Skips the write if a new stream has become active while the fetch was
 * in-flight (checked via store.get to read the live atom state).
 */
export function syncChatFromDb(
  chatId: number,
  setMessagesById: SetMessagesById,
  label: string,
  store: ReturnType<typeof getDefaultStore>,
): void {
  ipc.chat
    .getChat(chatId)
    .then((chat) => {
      // A new stream may have started while getChat was in flight; bail out to
      // avoid overwriting its in-progress or placeholder messages.
      if (store.get(isStreamingByIdAtom).get(chatId) === true) return;
      setMessagesById((prev) => {
        const currentMessages = prev.get(chatId);
        if (!currentMessages) {
          const next = new Map(prev);
          next.set(chatId, chat.messages);
          return next;
        }
        // New stream added messages while fetch was in flight; skip overwrite.
        if (currentMessages.length > chat.messages.length) return prev;
        const merged = mergeResyncMessages(chat.messages, currentMessages);
        const next = new Map(prev);
        next.set(chatId, merged);
        return next;
      });
    })
    .catch((err) => {
      console.warn(`${label} DB sync failed for chat`, chatId, err);
    });
}

/**
 * Triggers a best-effort resync of chat messages from the DB when a streaming
 * patch detects a stale or corrupted renderer base (applyStreamingPatch returns false).
 *
 * Deduplicates concurrent resync fetches per chatId. If the fetch hangs past
 * RESYNC_TIMEOUT_MS the gate entry is cleared so future mismatches can retry.
 * onEnd always performs a final authoritative sync, so this is recovery-only.
 */
export function triggerResync(
  chatId: number,
  setMessagesById: SetMessagesById,
  store: ReturnType<typeof getDefaultStore>,
): void {
  if (pendingResyncChatIds.has(chatId)) return;
  pendingResyncChatIds.add(chatId);

  // Snapshot the stream generation so we can detect if a new stream starts
  // before the fetch resolves and skip the stale write.
  const streamGenAtStart = store.get(chatStreamCountByIdAtom).get(chatId) ?? 0;

  let timeoutId: ReturnType<typeof setTimeout>;
  const fetchWithTimeout = Promise.race([
    ipc.chat.getChat(chatId),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(new Error(`resync timed out after ${RESYNC_TIMEOUT_MS}ms`)),
        RESYNC_TIMEOUT_MS,
      );
    }),
  ]);

  fetchWithTimeout
    .then((chat) => {
      // A different stream started while the fetch was in flight; skip.
      if (
        (store.get(chatStreamCountByIdAtom).get(chatId) ?? 0) !==
        streamGenAtStart
      )
        return;
      setMessagesById((prev) => {
        const prevMessages = prev.get(chatId);
        // A newer stream added messages while the fetch was in flight; skip.
        if (prevMessages && prevMessages.length > chat.messages.length)
          return prev;
        const next = new Map(prev);
        next.set(
          chatId,
          prevMessages
            ? mergeResyncMessages(chat.messages, prevMessages)
            : chat.messages,
        );
        return next;
      });
    })
    .catch((err) => {
      console.warn(
        "[CHAT] Streaming resync fetch failed for chat",
        chatId,
        err,
      );
    })
    .finally(() => {
      clearTimeout(timeoutId);
      pendingResyncChatIds.delete(chatId);
    });
}
