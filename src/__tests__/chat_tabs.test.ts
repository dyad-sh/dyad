import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  recentViewedChatIdsAtom,
  closedChatIdsAtom,
  pushRecentViewedChatIdAtom,
  removeRecentViewedChatIdAtom,
  pruneClosedChatIdsAtom,
} from "@/atoms/chatAtoms";
import {
  applySelectionToOrderedChatIds,
  getOrderedRecentChatIds,
  getVisibleTabCapacity,
  getFallbackChatIdAfterClose,
  partitionChatsByVisibleCount,
  reorderVisibleChatIds,
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
  it("keeps MRU order for chats viewed in this session", () => {
    const chats = [chat(1), chat(2), chat(3), chat(4)];
    const orderedIds = getOrderedRecentChatIds([4, 2], chats);
    expect(orderedIds).toEqual([4, 2]);
  });

  it("skips stale chat ids that no longer exist", () => {
    const chats = [chat(1), chat(3)];
    const orderedIds = getOrderedRecentChatIds([3, 999, 1], chats);
    expect(orderedIds).toEqual([3, 1]);
  });

  it("omits chats closed from the tab bar", () => {
    const chats = [chat(1), chat(2), chat(3)];
    const orderedIds = getOrderedRecentChatIds([3, 2, 1], chats, new Set([2]));
    expect(orderedIds).toEqual([3, 1]);
  });

  it("does not reorder when selecting an already-visible tab", () => {
    const orderedIds = [4, 2, 3, 1];
    const nextIds = applySelectionToOrderedChatIds(orderedIds, 2, 3);
    expect(nextIds).toEqual([4, 2, 3, 1]);
  });

  it("promotes a non-visible selected tab and bumps the last visible tab", () => {
    const orderedIds = [4, 2, 3, 1];
    const nextIds = applySelectionToOrderedChatIds(orderedIds, 1, 3);
    expect(nextIds).toEqual([1, 4, 2, 3]);
  });

  it("reorders only visible tabs during drag", () => {
    const orderedIds = [10, 11, 12, 13, 14];
    const nextIds = reorderVisibleChatIds(orderedIds, 3, 12, 10);
    expect(nextIds).toEqual([12, 10, 11, 13, 14]);
  });

  it("partitions chats into visible and overflow sets", () => {
    const orderedChats = [chat(1), chat(2), chat(3), chat(4)];
    const { visibleTabs, overflowTabs } = partitionChatsByVisibleCount(
      orderedChats,
      2,
    );
    expect(visibleTabs.map((c) => c.id)).toEqual([1, 2]);
    expect(overflowTabs.map((c) => c.id)).toEqual([3, 4]);
  });

  it("uses overflow-aware capacity with min width constraints", () => {
    // 3 tabs fit at 140px each (+ gaps), but with overflow trigger reserved only 2 fit.
    expect(getVisibleTabCapacity(430, 4, 140)).toBe(2);
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

  it("adds chat to closedChatIds when removed", () => {
    const store = createStore();
    store.set(recentViewedChatIdsAtom, [3, 2, 1]);
    store.set(removeRecentViewedChatIdAtom, 2);
    expect(store.get(closedChatIdsAtom).has(2)).toBe(true);
  });

  it("removes chat from closedChatIds when pushed", () => {
    const store = createStore();
    store.set(recentViewedChatIdsAtom, [3, 1]);
    store.set(closedChatIdsAtom, new Set([2]));
    store.set(pushRecentViewedChatIdAtom, 2);
    expect(store.get(closedChatIdsAtom).has(2)).toBe(false);
    expect(store.get(recentViewedChatIdsAtom)).toEqual([2, 3, 1]);
  });

  it("prunes stale IDs from closedChatIds", () => {
    const store = createStore();
    store.set(closedChatIdsAtom, new Set([1, 2, 99]));
    store.set(pruneClosedChatIdsAtom, new Set([1, 2, 3]));
    const pruned = store.get(closedChatIdsAtom);
    expect(pruned.has(1)).toBe(true);
    expect(pruned.has(2)).toBe(true);
    expect(pruned.has(99)).toBe(false);
  });
});
