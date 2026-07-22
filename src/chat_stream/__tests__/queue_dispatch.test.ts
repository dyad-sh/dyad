import { QueryClient } from "@tanstack/react-query";
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  chatErrorByIdAtom,
  isStreamingByIdAtom,
  queuePausedByIdAtom,
  queuedMessagesByIdAtom,
  type QueuedMessageItem,
} from "@/atoms/chatAtoms";
import type { Chat } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

import {
  createProductionChatStreamCommands,
  type ChatStreamCommands,
} from "../commands";
import { createChatStreamController } from "../controller";
import { ChatStreamManager } from "../manager";

const CHAT_ID = 11;

function queuedItem(overrides: Partial<QueuedMessageItem> = {}) {
  return {
    id: "item-1",
    prompt: "queued prompt",
    ...overrides,
  } satisfies QueuedMessageItem;
}

function setup({
  queue = [queuedItem()],
  chatId = CHAT_ID,
}: { queue?: QueuedMessageItem[]; chatId?: number } = {}) {
  const store = createStore();
  const queryClient = new QueryClient();
  const runtimeDeps = {
    store,
    queryClient,
    getSettings: () => undefined,
    getPosthog: () => null,
  };
  if (queue.length > 0) {
    store.set(queuedMessagesByIdAtom, new Map([[chatId, queue]]));
  }
  const startStream = vi.fn(
    async (_args: Parameters<ChatStreamCommands["startStream"]>[0]) => {},
  );
  const productionCommands = createProductionChatStreamCommands(
    () => runtimeDeps,
  );
  const commands: ChatStreamCommands = {
    ...productionCommands,
    startStream,
  };
  const controller = createChatStreamController({
    chatId,
    getCommands: () => commands,
  });
  return {
    store,
    queryClient,
    controller,
    startStream,
    productionCommands,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("queue dispatch", () => {
  it("uses machine state instead of the legacy streaming projection", async () => {
    const { store, controller, startStream } = setup();

    // Projection writes can lag behind machine transitions. An idle machine
    // remains authoritative and must dispatch its queued prompt.
    store.set(isStreamingByIdAtom, new Map([[CHAT_ID, true]]));

    controller.send({ type: "queue-poked" });
    await flush();

    expect(startStream).toHaveBeenCalledTimes(1);
    expect(startStream.mock.calls[0][0].request).toMatchObject({
      prompt: "queued prompt",
      chatId: CHAT_ID,
    });
    expect(store.get(queuedMessagesByIdAtom).get(CHAT_ID)).toBeUndefined();
    expect(controller.getSnapshot().type).toBe("starting");
  });

  it("does not dequeue while the queue is paused", async () => {
    const { store, controller, startStream } = setup();
    store.set(queuePausedByIdAtom, new Map([[CHAT_ID, true]]));

    controller.send({ type: "queue-poked" });
    await flush();

    expect(startStream).not.toHaveBeenCalled();
    expect(store.get(queuedMessagesByIdAtom).get(CHAT_ID)).toHaveLength(1);
  });
});

describe("queued request fidelity", () => {
  it("preserves redo/appId/requestedChatMode through the queue and dispatches the original request verbatim", async () => {
    const { store, controller, startStream, productionCommands } = setup({
      queue: [],
    });

    const onSettled = vi.fn();
    productionCommands.enqueueMessage({
      chatId: CHAT_ID,
      request: {
        prompt: "retry me",
        chatId: CHAT_ID,
        redo: true,
        appId: 9,
        requestedChatMode: "plan",
        onSettled,
      },
    });

    // Queued submissions settle immediately as NOT-yet-successful: callers
    // key completion-only side effects off `success`.
    expect(onSettled).toHaveBeenCalledExactlyOnceWith({
      success: false,
      queued: true,
    });
    const stored = store.get(queuedMessagesByIdAtom).get(CHAT_ID);
    expect(stored).toHaveLength(1);
    expect(stored![0]).toMatchObject({
      prompt: "retry me",
      redo: true,
      appId: 9,
      requestedChatMode: "plan",
    });

    controller.send({ type: "queue-poked" });
    await flush();

    expect(startStream).toHaveBeenCalledTimes(1);
    expect(startStream.mock.calls[0][0].request).toMatchObject({
      prompt: "retry me",
      redo: true,
      appId: 9,
      requestedChatMode: "plan",
    });
  });

  it("preserves an explicit null requestedChatMode (skip-cache sentinel) instead of falling back", async () => {
    const { queryClient, controller, startStream } = setup({
      queue: [queuedItem({ requestedChatMode: null })],
    });
    queryClient.setQueryData(queryKeys.chats.detail({ chatId: CHAT_ID }), {
      chatMode: "build",
    } as Chat);

    controller.send({ type: "queue-poked" });
    await flush();

    expect(startStream.mock.calls[0][0].request.requestedChatMode).toBeNull();
  });

  it("deduplicates machine follow-ups by request id and refreshes acceptance callbacks", () => {
    const { store, productionCommands } = setup({ queue: [] });
    const firstAccepted = vi.fn();
    const replayAccepted = vi.fn();

    productionCommands.enqueueMessage({
      chatId: CHAT_ID,
      request: {
        chatId: CHAT_ID,
        prompt: "continue",
        userInputRequestId: "integration:1",
        onAccepted: firstAccepted,
      },
    });
    productionCommands.enqueueMessage({
      chatId: CHAT_ID,
      request: {
        chatId: CHAT_ID,
        prompt: "continue",
        userInputRequestId: "integration:1",
        onAccepted: replayAccepted,
      },
    });

    const queue = store.get(queuedMessagesByIdAtom).get(CHAT_ID);
    expect(queue).toHaveLength(1);
    expect(queue?.[0].onAccepted).toBe(replayAccepted);
  });

  it("falls back to the cached per-chat mode for items queued without a mode (manual queue path)", async () => {
    const { queryClient, controller, startStream } = setup();
    queryClient.setQueryData(queryKeys.chats.detail({ chatId: CHAT_ID }), {
      chatMode: "build",
    } as Chat);

    controller.send({ type: "queue-poked" });
    await flush();

    expect(startStream.mock.calls[0][0].request.requestedChatMode).toBe(
      "build",
    );
  });
});

describe("manager disposal", () => {
  it("disposes controllers that end up errored once quiescent and unobserved", async () => {
    const chatId = 77;
    const store = createStore();
    const queryClient = new QueryClient();
    const manager = new ChatStreamManager(store);
    manager.registerRuntimeDeps({
      store,
      queryClient,
      getSettings: () => undefined,
      getPosthog: () => null,
    });
    // Seed the chats-list cache so app-id resolution stays cache-only.
    queryClient.setQueryData(queryKeys.chats.list({ appId: null }), [
      { id: chatId, appId: 1, title: "t", createdAt: new Date().toISOString() },
    ]);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // The production adapter has no IPC bridge in this environment, so the
    // stream errors out immediately; the controller must reach `errored` and
    // then be disposed from the manager host (not leak forever).
    manager.ensure(chatId).send({
      type: "submit",
      request: { prompt: "hello", chatId },
    });
    await vi.waitFor(() => {
      expect(manager.peek(chatId)).toBeUndefined();
    });
    expect(store.get(chatErrorByIdAtom).get(chatId)).toBeTruthy();

    const replacement = manager.ensure(chatId);
    replacement.send({
      type: "submit",
      request: { prompt: "retry", chatId },
    });
    expect(replacement.getSnapshot()).toMatchObject({
      type: "starting",
      streamId: 2,
    });
    await vi.waitFor(() => {
      expect(manager.peek(chatId)).toBeUndefined();
    });
    consoleError.mockRestore();
  });
});
