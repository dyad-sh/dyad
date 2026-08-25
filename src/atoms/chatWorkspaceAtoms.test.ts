import { createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import {
  chatWorkspaceByAppIdAtom,
  getVisibleChatViewIds,
  getVisibleWorkspaceChatIds,
  hideChatFromWorkspaceAtom,
  pruneChatWorkspaceAtom,
  showChatInWorkspaceAtom,
} from "./chatWorkspaceAtoms";

describe("chat workspace atoms", () => {
  const store = createStore();

  beforeEach(() => {
    store.set(chatWorkspaceByAppIdAtom, {});
  });

  it("adds chats once and preserves their order per app", () => {
    store.set(showChatInWorkspaceAtom, { appId: 1, chatId: 10 });
    store.set(showChatInWorkspaceAtom, { appId: 1, chatId: 20 });
    store.set(showChatInWorkspaceAtom, { appId: 1, chatId: 10 });
    store.set(showChatInWorkspaceAtom, { appId: 2, chatId: 30 });

    expect(store.get(chatWorkspaceByAppIdAtom)).toEqual({
      1: { visibleChatIds: [10, 20] },
      2: { visibleChatIds: [30] },
    });
  });

  it("removes and prunes unavailable chats", () => {
    store.set(chatWorkspaceByAppIdAtom, {
      1: { visibleChatIds: [10, 20, 30] },
    });

    store.set(hideChatFromWorkspaceAtom, { appId: 1, chatId: 20 });
    store.set(pruneChatWorkspaceAtom, {
      appId: 1,
      validChatIds: new Set([30]),
    });

    expect(store.get(chatWorkspaceByAppIdAtom)[1]?.visibleChatIds).toEqual([
      30,
    ]);
  });

  it("shows only explicit workspace members while filtering stale ids", () => {
    expect(
      getVisibleWorkspaceChatIds([10, 20, 99, 10], new Set([10, 20, 30])),
    ).toEqual([10, 20]);
  });

  it("keeps individual chat views separate from workspace membership", () => {
    const validChatIds = new Set([10, 20, 30]);

    expect(
      getVisibleChatViewIds({
        workspaceChatIds: [10, 20],
        focusedChatId: 30,
        validChatIds,
        isWorkspaceView: false,
      }),
    ).toEqual([30]);
    expect(
      getVisibleChatViewIds({
        workspaceChatIds: [10, 20],
        focusedChatId: 30,
        validChatIds,
        isWorkspaceView: true,
      }),
    ).toEqual([10, 20]);
  });
});
