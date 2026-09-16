// @vitest-environment node
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { chats, messages } from "@/db/schema";
import type { PresentationEndpoint } from "../utils/safe_sender";
import type { ChatExecutionOutcome } from "../services/chat_execution_types";
import { createChatExecutionContext } from "../services/chat_execution_presentation";
import { computeChatTurnPayloadHash } from "../utils/chat_turn_intent_hash";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import {
  cancelActiveStreamsForChat,
  clearPendingActorStreamCancellation,
  executeChatStreamFromActor,
  executeChatTurn,
  getActiveStreamCount,
  markPendingActorStreamCancellation,
  takePendingActorStreamCancellation,
  type ChatStreamExecutionObserver,
} from "./chat_stream_handlers";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return {
    ipcHandlers: new Map(),
    execute:
      vi.fn<
        typeof import("@/pro/main/ipc/handlers/local_agent/local_agent_handler").handleLocalAgentStream
      >(),
  };
});
vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});
vi.mock(
  "@/pro/main/ipc/handlers/local_agent/local_agent_handler",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/pro/main/ipc/handlers/local_agent/local_agent_handler")
    >()),
    handleLocalAgentStream: h.execute,
  }),
);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let sequence = 0;
function turn(chatId: number) {
  const invocationRef = {
    kind: "chat-stream" as const,
    entityKey: chatId,
    operationId: `turn-${++sequence}`,
  };
  const request = {
    chatId,
    prompt: "hello",
    intentId: invocationRef.operationId,
    invocationRef,
  };
  const intent = { schemaVersion: 1 as const, ...request };
  const observer = {
    intent: { ...intent, payloadHash: computeChatTurnPayloadHash(intent) },
    sessionQueued: false,
    onAccepted: vi.fn(),
    onEnd: vi.fn(),
    onError: vi.fn(),
  } satisfies ChatStreamExecutionObserver;
  return { request, observer };
}

function endpoint(
  destroyed = false,
): PresentationEndpoint & { send: ReturnType<typeof vi.fn> } {
  return { id: Number.NaN, isDestroyed: () => destroyed, send: vi.fn() };
}

describe("main-owned typed execution settlement", () => {
  let harness: ChatFlowHarness;
  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);
  beforeEach(async () => {
    h.execute.mockReset();
    await harness.db.delete(messages);
    await harness.db
      .update(chats)
      .set({ chatMode: "build" })
      .where(eq(chats.id, harness.chatId));
  });
  afterAll(async () => {
    await harness?.dispose();
  });

  it("returns completion metadata without emitting a terminal renderer event", async () => {
    const { request, observer } = turn(harness.chatId);
    const sender = endpoint();
    const outcome: ChatExecutionOutcome = {
      kind: "completed",
      response: {
        chatId: request.chatId,
        invocationRef: request.invocationRef,
        updatedFiles: true,
        warningMessages: ["warning"],
        pausePromptQueue: true,
        reviewBarrierRequested: true,
      },
    };
    h.execute.mockResolvedValue(outcome);
    expect(
      await executeChatTurn(request, {
        ...createChatExecutionContext(sender),
        intent: observer.intent,
      }),
    ).toEqual(outcome);
    expect(
      sender.send.mock.calls.some(
        ([channel]) =>
          channel === "chat:response:end" || channel === "chat:response:error",
      ),
    ).toBe(false);
    expect(getActiveStreamCount()).toBe(0);
  });

  it.each(["destroyed", "throwing"] as const)(
    "settles the actor when its renderer is %s",
    async (delivery) => {
      const { request, observer } = turn(harness.chatId);
      const sender = endpoint(delivery === "destroyed");
      if (delivery === "throwing")
        sender.send.mockImplementation(() => {
          throw new Error("renderer disappeared");
        });
      const response = {
        chatId: request.chatId,
        invocationRef: request.invocationRef,
        updatedFiles: true,
        warningMessages: ["preserved"],
        suppressAutoReview: true,
      };
      h.execute.mockResolvedValue({ kind: "completed", response });
      await expect(
        executeChatStreamFromActor(sender, request, observer),
      ).resolves.toEqual({ kind: "completed", response });
      expect(observer.onAccepted).toHaveBeenCalledOnce();
      expect(observer.onEnd).toHaveBeenCalledExactlyOnceWith(response);
      expect(observer.onError).not.toHaveBeenCalled();
      expect(getActiveStreamCount()).toBe(0);
    },
  );

  it("preserves a typed failure and warnings without renderer delivery", async () => {
    const { request, observer } = turn(harness.chatId);
    const error = {
      chatId: request.chatId,
      invocationRef: request.invocationRef,
      error: "provider failed",
      warningMessages: ["partial work preserved"],
    };
    h.execute.mockResolvedValue({ kind: "failed", error });
    await expect(
      executeChatStreamFromActor(endpoint(true), request, observer),
    ).resolves.toEqual({ kind: "failed", error });
    expect(observer.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(observer.onEnd).not.toHaveBeenCalled();
  });

  it("does not complete cancellation until the partial response is durable", async () => {
    const { request, observer } = turn(harness.chatId);
    const sender = endpoint();
    const entered = deferred();
    const persist = deferred();
    let signal: AbortSignal | undefined;
    let durable = false;
    observer.onEnd.mockImplementation(() => {
      expect(durable).toBe(true);
    });
    h.execute.mockImplementationOnce(
      async (_context, _request, controller, options) => {
        signal = controller.signal;
        entered.resolve();
        await persist.promise;
        await harness.db
          .update(messages)
          .set({ content: "partial response — cancelled" })
          .where(eq(messages.id, options.placeholderMessageId));
        durable = true;
        return { kind: "cancelled" };
      },
    );
    const run = executeChatStreamFromActor(sender, request, observer);
    await entered.promise;
    const cancellation = cancelActiveStreamsForChat(
      request.chatId,
      sender,
      request.invocationRef,
    );
    expect(signal?.aborted).toBe(true);
    expect(sender.send).toHaveBeenCalledWith(
      "chat:response:end",
      expect.objectContaining({ wasCancelled: true }),
    );
    expect(observer.onEnd).not.toHaveBeenCalled();
    expect(getActiveStreamCount()).toBe(1);
    persist.resolve();
    await expect(run).resolves.toEqual({ kind: "cancelled" });
    await cancellation;
    expect(observer.onEnd).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ wasCancelled: true }),
    );
    expect(
      sender.send.mock.calls.filter(
        ([channel]) => channel === "chat:response:end",
      ),
    ).toHaveLength(1);
    expect(getActiveStreamCount()).toBe(0);
  });

  it("refunds Basic Agent quota when cancellation arrives during finalization", async () => {
    await harness.db
      .update(chats)
      .set({ chatMode: "local-agent" })
      .where(eq(chats.id, harness.chatId));
    const { request, observer } = turn(harness.chatId);
    h.execute.mockImplementationOnce(async (_context, _request, controller) => {
      const accepted = await harness.db.query.messages.findFirst({
        where: eq(messages.id, observer.onAccepted.mock.calls[0][0]),
      });
      expect(accepted?.usingFreeAgentModeQuota).toBe(true);
      try {
        return {
          kind: "completed",
          response: { chatId: request.chatId, updatedFiles: false },
        };
      } finally {
        // A completed loop can still be stopped while its finalizers unwind.
        controller.abort();
      }
    });
    await expect(
      executeChatStreamFromActor(endpoint(), request, observer),
    ).resolves.toEqual({ kind: "cancelled" });
    const accepted = await harness.db.query.messages.findFirst({
      where: eq(messages.id, observer.onAccepted.mock.calls[0][0]),
    });
    expect(accepted?.usingFreeAgentModeQuota).toBe(false);
    expect(observer.onEnd).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ wasCancelled: true }),
    );
  });

  it("returns a cancelled outcome for a stop that precedes execution registration", async () => {
    const { request, observer } = turn(harness.chatId);
    markPendingActorStreamCancellation(request.invocationRef);
    await expect(
      executeChatStreamFromActor(endpoint(true), request, observer),
    ).resolves.toEqual({ kind: "cancelled" });
    expect(observer.onEnd).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ wasCancelled: true }),
    );
    expect(observer.onAccepted).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
    expect(takePendingActorStreamCancellation(request.invocationRef)).toBe(
      false,
    );
    clearPendingActorStreamCancellation(request.invocationRef);
  });
});
