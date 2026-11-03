import type { createStore } from "jotai";
import { chatInputValuesByIdAtom } from "./chatAtoms";

type JotaiStore = ReturnType<typeof createStore>;

/**
 * Persistence for unsent chat composer drafts.
 *
 * Drafts are client-only presentation state (see `rules/jotai-state.md`), so
 * they live in renderer localStorage rather than the database. Each chat gets
 * its own key so two windows editing different chats can never clobber one
 * another's drafts with a read-modify-write of a single shared blob.
 */
export const CHAT_DRAFT_STORAGE_PREFIX = "dyad-chat-draft-v1:";

export function chatDraftStorageKey(chatId: number): string {
  return `${CHAT_DRAFT_STORAGE_PREFIX}${chatId}`;
}

function isPersistableChatId(chatId: number): boolean {
  return Number.isInteger(chatId) && chatId > 0;
}

export function loadChatDrafts(storage: Storage): Map<number, string> {
  const drafts = new Map<number, string>();
  // Snapshot the keys first: another window writing to localStorage during the
  // loop would otherwise shift indices and make us skip or repeat entries.
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(CHAT_DRAFT_STORAGE_PREFIX)) keys.push(key);
  }
  for (const key of keys) {
    const chatId = Number(key.slice(CHAT_DRAFT_STORAGE_PREFIX.length));
    if (!isPersistableChatId(chatId)) continue;
    const draft = storage.getItem(key);
    if (!draft) continue;
    drafts.set(chatId, draft);
  }
  return drafts;
}

export function writeChatDraft(
  storage: Storage,
  chatId: number,
  draft: string,
): void {
  if (!isPersistableChatId(chatId)) return;
  const key = chatDraftStorageKey(chatId);
  if (draft) storage.setItem(key, draft);
  else storage.removeItem(key);
}

/**
 * Persist only the chats whose draft changed between two snapshots. Removing a
 * chat from `next` deletes its stored key, so clearing or pruning a draft in
 * memory also clears it on disk.
 */
export function persistChatDraftChanges(
  storage: Storage,
  previous: ReadonlyMap<number, string>,
  next: ReadonlyMap<number, string>,
): void {
  for (const chatId of previous.keys()) {
    if (!next.has(chatId)) storage.removeItem(chatDraftStorageKey(chatId));
  }
  for (const [chatId, draft] of next) {
    if (previous.get(chatId) === draft) continue;
    writeChatDraft(storage, chatId, draft);
  }
}

function getRendererStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

/**
 * Restore persisted drafts into the in-memory map and keep writing every
 * change back to storage. Returns an unsubscribe function.
 *
 * Hydration only fills chats that have no in-memory draft yet, so a draft the
 * user has already started typing is never overwritten by a stored value.
 */
export function startChatDraftPersistence(store: JotaiStore): () => void {
  const storage = getRendererStorage();
  if (!storage) return () => {};

  try {
    const persisted = loadChatDrafts(storage);
    if (persisted.size > 0) {
      store.set(chatInputValuesByIdAtom, (current) => {
        const next = new Map(current);
        for (const [chatId, draft] of persisted) {
          if (!next.has(chatId)) next.set(chatId, draft);
        }
        return next;
      });
    }
  } catch (error) {
    // Browser storage is optional presentation state. A denied or full
    // localStorage must not stop the app from rendering an empty composer.
    console.error("Failed to restore chat input drafts", error);
  }

  let previous = new Map(store.get(chatInputValuesByIdAtom));
  return store.sub(chatInputValuesByIdAtom, () => {
    const next = store.get(chatInputValuesByIdAtom);
    try {
      persistChatDraftChanges(storage, previous, next);
    } catch (error) {
      console.error("Failed to persist chat input drafts", error);
    }
    previous = new Map(next);
  });
}
