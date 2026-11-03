import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { chatInputValuesByIdAtom } from "./chatAtoms";
import {
  CHAT_DRAFT_STORAGE_PREFIX,
  chatDraftStorageKey,
  loadChatDrafts,
  persistChatDraftChanges,
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

  it("persists only changed entries and deletes removed chats", () => {
    writeChatDraft(localStorage, 2, "stored-two");
    persistChatDraftChanges(
      localStorage,
      new Map([
        [1, "unchanged"],
        [2, "stored-two"],
      ]),
      new Map([[1, "unchanged"]]),
    );
    expect(localStorage.getItem(chatDraftStorageKey(2))).toBeNull();
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
    second.set(chatInputValuesByIdAtom, new Map());
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
});
