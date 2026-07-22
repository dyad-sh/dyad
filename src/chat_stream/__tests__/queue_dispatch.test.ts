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
    prompt: "queued while external stream ran",
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

describe("queue dispatch after non-machine streams (regression)", () => {
  it("drains a prompt queued during an external stream once the stream ends and pokes the machine", async () => {
    const { store, controller, startStream } = setup();

    // An external (non-machine) stream is running: it wrote the isStreaming
    // projection directly and the machine is idle.
    store.set(isStreamingByIdAtom, new Map([[CHAT_ID, true]]));

    // A poke while the external stream is active must NOT dequeue (the
    // legacy useQueueProcessor "never dequeue while streaming" guard).
    controller.send({ type: "queue-poked" });
    await flush();
    expect(startStream).not.toHaveBeenCalled();
    expect(store.get(queuedMessagesByIdAtom).get(CHAT_ID)).toHaveLength(1);

    // The external stream ends: its terminal handler clears the projection
    // and pokes the machine (usePlanImplementation / merge-conflict flows).
    store.set(isStreamingByIdAtom, new Map([[CHAT_ID, false]]));
    controller.send({ type: "queue-poked" });
    await flush();

    expect(startStream).toHaveBeenCalledTimes(1);
    expect(startStream.mock.calls[0][0].request).toMatchObject({
      prompt: "queued while external stream ran",
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
    // then be disposed from the registry (not leak forever).
    manager.ensure(chatId).send({
      type: "submit",
      request: { prompt: "hello", chatId },
    });
    await vi.waitFor(() => {
      expect(manager.peek(chatId)).toBeUndefined();
    });
    expect(store.get(chatErrorByIdAtom).get(chatId)).toBeTruthy();
    consoleError.mockRestore();
  });
});
