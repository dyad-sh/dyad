import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "jotai";
import { chatInputValuesByIdAtom } from "./chatAtoms";
import {
  CHAT_DRAFT_STORAGE_PREFIX,
  chatDraftStorageKey,
  loadChatDrafts,
  persistChatDraftChanges,
  pruneChatDrafts,
  startChatDraftPersistence,
  writeChatDraft,
} from "./chatDraftStorage";

describe("chat draft storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips drafts through per-chat keys", () => {
    writeChatDraft(localStorage, 7, "hello");
    expect(localStorage.getItem(chatDraftStorageKey(7))).toBe("hello");
    expect(loadChatDrafts(localStorage)).toEqual(new Map([[7, "hello"]]));
  });

  it("removes the key when a draft is cleared", () => {
    writeChatDraft(localStorage, 7, "hello");
    writeChatDraft(localStorage, 7, "");
    expect(localStorage.getItem(chatDraftStorageKey(7))).toBeNull();
  });

  it("ignores unrelated and malformed keys", () => {
    localStorage.setItem("some-other-key", "kept");
    localStorage.setItem(`${CHAT_DRAFT_STORAGE_PREFIX}not-a-number`, "kept");
    localStorage.setItem(`${CHAT_DRAFT_STORAGE_PREFIX}0`, "kept");
    expect(loadChatDrafts(localStorage)).toEqual(new Map());
  });

  it("writes changed drafts and leaves unchanged ones alone", () => {
    // A stored value that no writer would produce for this key stands in for
    // "the writer did not touch it": if the unchanged entry were rewritten, the
    // stored value would become "same".
    localStorage.setItem(chatDraftStorageKey(1), "untouched-by-writer");
    persistChatDraftChanges(
      localStorage,
      new Map([
        [1, "same"],
        [2, "old"],
      ]),
      new Map([
        [1, "same"],
        [2, "new"],
      ]),
    );
    expect(localStorage.getItem(chatDraftStorageKey(1))).toBe(
      "untouched-by-writer",
    );
    expect(localStorage.getItem(chatDraftStorageKey(2))).toBe("new");
  });

  it("keeps the stored key when a chat leaves the snapshot (tab hand-off)", () => {
    // A cross-window transfer removes the chat from the source map, but the
    // destination already wrote the handed-off draft under the same key.
    writeChatDraft(localStorage, 3, "handed off");
    persistChatDraftChanges(
      localStorage,
      new Map([[3, "handed off"]]),
      new Map(),
    );
    expect(localStorage.getItem(chatDraftStorageKey(3))).toBe("handed off");
  });

  it("restores drafts into a fresh store and keeps writing changes", () => {
    // First "launch": the user types a draft and the app persists it.
    const first = createStore();
    const stopFirst = startChatDraftPersistence(first);
    first.set(chatInputValuesByIdAtom, new Map([[11, "draft-eleven"]]));
    stopFirst();

    // Second "launch": a brand-new store hydrates the stored draft.
    const second = createStore();
    const stopSecond = startChatDraftPersistence(second);
    expect(second.get(chatInputValuesByIdAtom).get(11)).toBe("draft-eleven");

    // Clearing the composer clears the stored draft too.
    second.set(chatInputValuesByIdAtom, new Map([[11, ""]]));
    expect(localStorage.getItem(chatDraftStorageKey(11))).toBeNull();
    stopSecond();
  });

  it("never overwrites a draft the user already started typing", () => {
    writeChatDraft(localStorage, 5, "stored");
    const store = createStore();
    store.set(chatInputValuesByIdAtom, new Map([[5, "typed"]]));
    const stop = startChatDraftPersistence(store);
    expect(store.get(chatInputValuesByIdAtom).get(5)).toBe("typed");
    stop();
  });

  it("prunes drafts whose chat no longer exists, in memory and on disk", () => {
    writeChatDraft(localStorage, 1, "keep");
    writeChatDraft(localStorage, 2, "stale");
    const store = createStore();
    store.set(
      chatInputValuesByIdAtom,
      new Map([
        [1, "keep"],
        [2, "stale"],
      ]),
    );
    pruneChatDrafts(store, new Set([1]));
    expect(store.get(chatInputValuesByIdAtom)).toEqual(new Map([[1, "keep"]]));
    expect(localStorage.getItem(chatDraftStorageKey(1))).toBe("keep");
    expect(localStorage.getItem(chatDraftStorageKey(2))).toBeNull();
  });

  it("degrades to a no-op when storage access throws", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const spy = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new Error("storage blocked");
      });
    try {
      const store = createStore();
      const stop = startChatDraftPersistence(store);
      expect(() => stop()).not.toThrow();
      expect(() => pruneChatDrafts(store, new Set())).not.toThrow();
    } finally {
      spy.mockRestore();
      consoleError.mockRestore();
    }
  });
});
