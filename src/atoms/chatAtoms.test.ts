import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import {
  agentTodosByChatIdAtom,
  chatErrorByIdAtom,
  chatInputValuesByIdAtom,
  chatMessagesByIdAtom,
  evictChatRuntimeStateAtom,
  isStreamingByIdAtom,
  pendingToolConsentsAtom,
  closedChatIdsAtom,
  queuedMessagesByIdAtom,
  queuePausedByIdAtom,
  recentStreamChatIdsAtom,
  streamCompletedSuccessfullyByIdAtom,
  streamingPreviewByChatIdAtom,
} from "./chatAtoms";

const message = {
  id: 1,
  role: "assistant" as const,
  content: "large retained history",
};

describe("evictChatRuntimeStateAtom", () => {
  it("removes inactive per-chat state while preserving other chats", () => {
    const store = createStore();
    store.set(
      chatMessagesByIdAtom,
      new Map([
        [1, [message]],
        [2, [{ ...message, id: 2 }]],
      ]),
    );
    store.set(
      chatErrorByIdAtom,
      new Map([
        [1, "failed"],
        [2, null],
      ]),
    );
    store.set(chatInputValuesByIdAtom, new Map([[1, "draft"]]));
    store.set(agentTodosByChatIdAtom, new Map([[1, []]]));
    store.set(streamCompletedSuccessfullyByIdAtom, new Map([[1, true]]));
    store.set(queuePausedByIdAtom, new Map([[1, true]]));
    store.set(streamingPreviewByChatIdAtom, new Map([[1, "preview"]]));
    store.set(recentStreamChatIdsAtom, new Set([1, 2]));
    store.set(pendingToolConsentsAtom, [
      { kind: "agent", requestId: "one", chatId: 1, toolName: "read" },
      { kind: "agent", requestId: "two", chatId: 2, toolName: "read" },
    ]);

    store.set(evictChatRuntimeStateAtom, { chatIds: [1] });

    expect(store.get(chatMessagesByIdAtom).has(1)).toBe(false);
    expect(store.get(chatMessagesByIdAtom).has(2)).toBe(true);
    expect(store.get(chatErrorByIdAtom).has(1)).toBe(false);
    expect(store.get(chatInputValuesByIdAtom).has(1)).toBe(false);
    expect(store.get(agentTodosByChatIdAtom).has(1)).toBe(false);
    expect(store.get(streamCompletedSuccessfullyByIdAtom).has(1)).toBe(false);
    expect(store.get(queuePausedByIdAtom).has(1)).toBe(false);
    expect(store.get(streamingPreviewByChatIdAtom).has(1)).toBe(false);
    expect(store.get(recentStreamChatIdsAtom)).toEqual(new Set([2]));
    expect(
      store.get(pendingToolConsentsAtom).map((item) => item.chatId),
    ).toEqual([2]);
  });

  it("does not evict an active stream or queued work when a tab closes", () => {
    const store = createStore();
    store.set(
      chatMessagesByIdAtom,
      new Map([
        [1, [message]],
        [2, [{ ...message, id: 2 }]],
      ]),
    );
    store.set(isStreamingByIdAtom, new Map([[1, true]]));
    store.set(
      queuedMessagesByIdAtom,
      new Map([[2, [{ id: "queued", prompt: "continue" }]]]),
    );

    store.set(evictChatRuntimeStateAtom, { chatIds: [1, 2] });

    expect(store.get(chatMessagesByIdAtom).has(1)).toBe(true);
    expect(store.get(chatMessagesByIdAtom).has(2)).toBe(true);
    expect(store.get(queuedMessagesByIdAtom).has(2)).toBe(true);
  });

  it("force-evicts runtime state after permanent deletion", () => {
    const store = createStore();
    store.set(chatMessagesByIdAtom, new Map([[1, [message]]]));
    store.set(isStreamingByIdAtom, new Map([[1, true]]));
    store.set(
      queuedMessagesByIdAtom,
      new Map([[1, [{ id: "queued", prompt: "continue" }]]]),
    );

    store.set(evictChatRuntimeStateAtom, { chatIds: [1], force: true });

    expect(store.get(chatMessagesByIdAtom).has(1)).toBe(false);
    expect(store.get(isStreamingByIdAtom).has(1)).toBe(false);
    expect(store.get(queuedMessagesByIdAtom).has(1)).toBe(false);
  });

  it("supports deferred terminal cleanup only for closed tabs", () => {
    const store = createStore();
    store.set(
      chatMessagesByIdAtom,
      new Map([
        [1, [message]],
        [2, [{ ...message, id: 2 }]],
      ]),
    );
    store.set(closedChatIdsAtom, new Set([1]));

    store.set(evictChatRuntimeStateAtom, {
      chatIds: [1, 2],
      requireClosed: true,
    });

    expect(store.get(chatMessagesByIdAtom).has(1)).toBe(false);
    expect(store.get(chatMessagesByIdAtom).has(2)).toBe(true);
  });
});
