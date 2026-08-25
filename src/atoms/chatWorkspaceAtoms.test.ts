import { createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import {
  chatWorkspaceByAppIdAtom,
  createChatWorkspaceStorage,
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

  it("renders the route chat while the chats query is still loading", () => {
    expect(
      getVisibleChatViewIds({
        workspaceChatIds: [],
        focusedChatId: 42,
        validChatIds: new Set(),
        isWorkspaceView: false,
      }),
    ).toEqual([42]);
  });

  it("loads only validated workspace entries from versioned storage", () => {
    const values = new Map<string, string>();
    values.set(
      "workspace",
      JSON.stringify({
        version: 1,
        workspaces: {
          1: { visibleChatIds: [10, 10, -1, "bad", 20] },
          2: null,
          invalid: { visibleChatIds: [30] },
        },
      }),
    );
    const storage = createChatWorkspaceStorage(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
      clear: () => values.clear(),
      key: (index) => Array.from(values.keys())[index] ?? null,
      get length() {
        return values.size;
      },
    }));

    expect(storage.getItem("workspace", {})).toEqual({
      1: { visibleChatIds: [10, 20] },
    });

    values.set(
      "workspace",
      JSON.stringify({ version: 2, workspaces: { 1: null } }),
    );
    expect(storage.getItem("workspace", {})).toEqual({});

    storage.setItem("workspace", { 3: { visibleChatIds: [30] } });
    expect(JSON.parse(values.get("workspace") ?? "null")).toEqual({
      version: 1,
      workspaces: { 3: { visibleChatIds: [30] } },
    });
  });
});
