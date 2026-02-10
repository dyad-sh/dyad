import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  recentViewedChatIdsAtom,
  pushRecentViewedChatIdAtom,
  removeRecentViewedChatIdAtom,
} from "@/atoms/chatAtoms";
import {
  getVisibleRecentChats,
  getFallbackChatIdAfterClose,
} from "@/components/chat/ChatTabs";
import type { ChatSummary } from "@/lib/schemas";

function chat(id: number): ChatSummary {
  return {
    id,
    appId: 1,
    title: `Chat ${id}`,
    createdAt: new Date(),
  };
}

describe("ChatTabs helpers", () => {
  it("returns at most 3 tabs in MRU order", () => {
    const chats = [chat(1), chat(2), chat(3), chat(4)];
    const visible = getVisibleRecentChats([4, 2, 3, 1], chats);
    expect(visible.map((c) => c.id)).toEqual([4, 2, 3]);
  });

  it("skips stale chat ids that no longer exist", () => {
    const chats = [chat(1), chat(3)];
    const visible = getVisibleRecentChats([3, 999, 1], chats);
    expect(visible.map((c) => c.id)).toEqual([3, 1]);
  });

  it("selects right-adjacent tab when closing active middle tab", () => {
    const fallback = getFallbackChatIdAfterClose(
      [chat(1), chat(2), chat(3)],
      2,
    );
    expect(fallback).toBe(3);
  });

  it("selects previous tab when closing active rightmost tab", () => {
    const fallback = getFallbackChatIdAfterClose(
      [chat(1), chat(2), chat(3)],
      3,
    );
    expect(fallback).toBe(2);
  });
});

describe("recent viewed chat atoms", () => {
  it("moves selected chat to front and dedupes", () => {
    const store = createStore();
    store.set(recentViewedChatIdsAtom, [1, 2, 3]);
    store.set(pushRecentViewedChatIdAtom, 2);
    expect(store.get(recentViewedChatIdsAtom)).toEqual([2, 1, 3]);
  });

  it("removes closed tab from tab state only", () => {
    const store = createStore();
    store.set(recentViewedChatIdsAtom, [3, 2, 1]);
    store.set(removeRecentViewedChatIdAtom, 2);
    expect(store.get(recentViewedChatIdsAtom)).toEqual([3, 1]);
  });
});
