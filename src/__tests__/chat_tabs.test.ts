import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  recentViewedChatIdsAtom,
  closedChatIdsAtom,
  pushRecentViewedChatIdAtom,
  removeRecentViewedChatIdAtom,
  pruneClosedChatIdsAtom,
  sessionOpenedChatIdsAtom,
  addSessionOpenedChatIdAtom,
  closeMultipleTabsAtom,
} from "@/atoms/chatAtoms";
import {
  applySelectionToOrderedChatIds,
  getOrderedRecentChatIds,
  getVisibleTabCapacity,
  getFallbackChatIdAfterClose,
  groupChatIdsByApp,
  partitionChatsByVisibleCount,
  reorderVisibleChatIds,
} from "@/components/chat/ChatTabs";
import type { ChatSummary } from "@/lib/schemas";

function chat(id: number, appId = 1): ChatSummary {
  return {
    id,
    appId,
    title: `Chat ${id}`,
    createdAt: new Date(),
    chatMode: null,
  };
}

describe("ChatTabs helpers", () => {
  it("keeps MRU order and appends chats that were never viewed (session filter)", () => {
    const chats = [chat(1), chat(2), chat(3), chat(4)];
    // All chats are in the session
    const sessionIds = new Set([1, 2, 3, 4]);
    const orderedIds = getOrderedRecentChatIds(
      [4, 2],
      chats,
      new Set(),
      sessionIds,
    );
    expect(orderedIds).toEqual([4, 2, 1, 3]);
  });

  it("only shows chats opened in current session", () => {
    const chats = [chat(1), chat(2), chat(3), chat(4)];
    // Only chats 1 and 3 are opened in the current session
    const sessionIds = new Set([1, 3]);
    const orderedIds = getOrderedRecentChatIds(
      [4, 2, 3, 1],
      chats,
      new Set(),
      sessionIds,
    );
    // Should only include chats 3 and 1 (in MRU order)
    expect(orderedIds).toEqual([3, 1]);
  });

  it("skips stale chat ids that no longer exist", () => {
    const chats = [chat(1), chat(3)];
    const sessionIds = new Set([1, 3, 999]);
    const orderedIds = getOrderedRecentChatIds(
      [3, 999, 1],
      chats,
      new Set(),
      sessionIds,
    );
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

describe("session opened chat atoms", () => {
  it("adds chat to session when opened", () => {
    const store = createStore();
    store.set(addSessionOpenedChatIdAtom, 1);
    store.set(addSessionOpenedChatIdAtom, 2);
    const sessionIds = store.get(sessionOpenedChatIdsAtom);
    expect(sessionIds.has(1)).toBe(true);
    expect(sessionIds.has(2)).toBe(true);
  });

  it("does not duplicate chat IDs in session", () => {
    const store = createStore();
    store.set(addSessionOpenedChatIdAtom, 1);
    store.set(addSessionOpenedChatIdAtom, 1);
    const sessionIds = store.get(sessionOpenedChatIdsAtom);
    expect(sessionIds.size).toBe(1);
  });
});

describe("close multiple tabs", () => {
  it("closes multiple tabs at once", () => {
    const store = createStore();
    store.set(recentViewedChatIdsAtom, [1, 2, 3, 4, 5]);
    store.set(closeMultipleTabsAtom, [2, 4]);
    expect(store.get(recentViewedChatIdsAtom)).toEqual([1, 3, 5]);
    expect(store.get(closedChatIdsAtom).has(2)).toBe(true);
    expect(store.get(closedChatIdsAtom).has(4)).toBe(true);
  });

  it("handles empty array gracefully", () => {
    const store = createStore();
    store.set(recentViewedChatIdsAtom, [1, 2, 3]);
    store.set(closeMultipleTabsAtom, []);
    expect(store.get(recentViewedChatIdsAtom)).toEqual([1, 2, 3]);
  });
});

describe("groupChatIdsByApp", () => {
  function toMap(chats: ChatSummary[]): Map<number, ChatSummary> {
    return new Map(chats.map((c) => [c.id, c]));
  }

  it("groups interleaved apps while preserving within-group order", () => {
    // app1: chats 1, 3, 5  |  app2: chats 2, 4
    const chats = [chat(1, 1), chat(2, 2), chat(3, 1), chat(4, 2), chat(5, 1)];
    const result = groupChatIdsByApp([1, 2, 3, 4, 5], toMap(chats));
    // app1 group first (seen first at index 0), then app2
    expect(result).toEqual([1, 3, 5, 2, 4]);
  });

  it("returns same order when all tabs belong to one app", () => {
    const chats = [chat(1, 1), chat(2, 1), chat(3, 1)];
    const result = groupChatIdsByApp([1, 2, 3], toMap(chats));
    expect(result).toEqual([1, 2, 3]);
  });

  it("handles empty input", () => {
    expect(groupChatIdsByApp([], new Map())).toEqual([]);
  });

  it("orders app groups by first appearance", () => {
    // app3 appears first, then app1, then app2
    const chats = [chat(10, 3), chat(20, 1), chat(30, 2), chat(40, 3)];
    const result = groupChatIdsByApp([10, 20, 30, 40], toMap(chats));
    expect(result).toEqual([10, 40, 20, 30]);
  });

  it("handles chat IDs missing from chatsById gracefully", () => {
    const chats = [chat(1, 1), chat(3, 2)];
    // chatId 2 is not in the map — should be placed in fallback group (-1)
    const result = groupChatIdsByApp([1, 2, 3], toMap(chats));
    // app1 first (chat 1), then unknown (chat 2), then app2 (chat 3)
    expect(result).toEqual([1, 2, 3]);
  });
});
