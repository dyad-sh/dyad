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
 * Persist the chats whose draft changed between two snapshots. An emptied draft
 * clears its key.
 *
 * A chat dropping out of `next` is intentionally not treated as a deletion:
 * that happens both when a chat is deleted and when its tab is handed to
 * another window, and the destination writes the handed-off draft under the
 * same shared key. Deleting it here would erase the destination's copy. Stale
 * keys for deleted chats are cleaned up by `pruneChatDrafts` instead.
 */
export function persistChatDraftChanges(
  storage: Storage,
  previous: ReadonlyMap<number, string>,
  next: ReadonlyMap<number, string>,
): void {
  for (const [chatId, draft] of next) {
    if (previous.get(chatId) === draft) continue;
    writeChatDraft(storage, chatId, draft);
  }
}

function getRendererStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch (error) {
    // A blocked storage getter must not stop the app from rendering.
    console.error("Failed to access chat input draft storage", error);
    return undefined;
  }
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

/**
 * The chat ids that currently hold a draft. Callers snapshot this before
 * starting the chat query and pass it to `pruneChatDrafts`, so ids that appear
 * later (a chat created mid-query) are never prune candidates.
 */
export function chatDraftCandidateChatIds(store: JotaiStore): Set<number> {
  return new Set(store.get(chatInputValuesByIdAtom).keys());
}

/**
 * Drop drafts whose chat no longer exists, in memory and on disk. App deletion
 * removes chats without going through the per-chat cleanup path, so without
 * this a stale draft would be reloaded on every launch.
 *
 * Only ids in `candidateChatIds` are considered. Callers capture that set before
 * starting the chat query, so a chat created while the query is in flight, and
 * any draft it just acquired, can never be pruned by a stale snapshot.
 */
export function pruneChatDrafts(
  store: JotaiStore,
  validChatIds: ReadonlySet<number>,
  candidateChatIds: ReadonlySet<number>,
): void {
  const storage = getRendererStorage();
  if (!storage) return;
  try {
    for (const chatId of candidateChatIds) {
      if (validChatIds.has(chatId)) continue;
      storage.removeItem(chatDraftStorageKey(chatId));
    }
    const current = store.get(chatInputValuesByIdAtom);
    let next: Map<number, string> | undefined;
    for (const chatId of candidateChatIds) {
      if (validChatIds.has(chatId) || !current.has(chatId)) continue;
      next ??= new Map(current);
      next.delete(chatId);
    }
    if (next) store.set(chatInputValuesByIdAtom, next);
  } catch (error) {
    console.error("Failed to prune chat input drafts", error);
  }
}
