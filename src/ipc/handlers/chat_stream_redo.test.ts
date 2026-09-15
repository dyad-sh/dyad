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
import { chats, messages } from "@/db/schema";
import { readSettings, writeSettings } from "@/main/settings";
import { eq } from "drizzle-orm";
import { withChatQueueLock } from "@/chat_stream/queue_lock";
import { parkChatQueue } from "@/chat_stream/persistence";
import { cancelActiveStreamsForChat } from "./chat_stream_handlers";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { preflightSubscriptionTurn } from "@/ipc/services/subscription_turn_preflight";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});
vi.mock("@/ipc/services/subscription_turn_preflight", () => ({
  preflightSubscriptionTurn: vi.fn(),
}));

describe("redo turn admission", () => {
  let harness: ChatFlowHarness;
  let originalMessages: Array<typeof messages.$inferSelect>;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 60_000);

  beforeEach(async () => {
    vi.mocked(preflightSubscriptionTurn).mockReset();
    vi.mocked(preflightSubscriptionTurn).mockImplementation(async (model) => ({
      model,
    }));
    await harness.db
      .update(chats)
      .set({ modelSelection: null })
      .where(eq(chats.id, harness.chatId));
    await harness.db.delete(messages);
    originalMessages = await harness.db
      .insert(messages)
      .values([
        { chatId: harness.chatId, role: "user", content: "Earlier prompt" },
        { chatId: harness.chatId, role: "assistant", content: "Earlier reply" },
        { chatId: harness.chatId, role: "user", content: "Retry this prompt" },
        {
          chatId: harness.chatId,
          role: "assistant",
          content: "Original reply",
        },
      ])
      .returning();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it.each([
    ["Out of credits", DyadErrorKind.Precondition],
    ["Reconnect your subscription", DyadErrorKind.Auth],
  ])(
    "preserves the entire exchange when preflight rejects: %s",
    async (message, kind) => {
      vi.mocked(preflightSubscriptionTurn).mockRejectedValue(
        new DyadError(message, kind),
      );

      const result = await harness.streamChat("tc=no-code-response", {
        redo: true,
      });

      expect(preflightSubscriptionTurn).toHaveBeenCalledOnce();
      expect(result.eventsFor("chat:response:error")).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            error: expect.stringContaining(message),
          }),
        }),
      ]);
      expect(result.messages).toEqual(originalMessages);
    },
  );

  it.each([false, true])(
    "rechecks a changed model after pending preflight (stale failure: %s)",
    async (rejectOld) => {
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(preflightSubscriptionTurn).mockImplementationOnce(
        async (model) => {
          entered();
          await gate;
          if (rejectOld) throw new Error("stale model failed");
          return { model };
        },
      );
      const stream = harness.streamChat("tc=no-code-response", { redo: true });
      await started;
      try {
        const model = vi.mocked(preflightSubscriptionTurn).mock.calls[0][0];
        await withChatQueueLock(harness.chatId, () =>
          harness.db
            .update(chats)
            .set({ modelSelection: { ...model, name: "replacement-model" } })
            .where(eq(chats.id, harness.chatId))
            .run(),
        );
      } finally {
        release();
      }
      await stream;
      expect(preflightSubscriptionTurn).toHaveBeenCalledTimes(2);
      expect(vi.mocked(preflightSubscriptionTurn).mock.calls[1][0].name).toBe(
        "replacement-model",
      );
    },
    30_000,
  );

  it.each(["mode", "billing"] as const)(
    "rechecks a changed %s while preflight is pending",
    async (change) => {
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const oldSettings = readSettings();
      vi.mocked(preflightSubscriptionTurn).mockImplementationOnce(
        async (model) => {
          entered();
          await gate;
          return { model };
        },
      );
      const stream = harness.streamChat("tc=no-code-response", { redo: true });
      await started;
      try {
        if (change === "mode") {
          await withChatQueueLock(harness.chatId, () =>
            harness.db
              .update(chats)
              .set({ chatMode: "ask" })
              .where(eq(chats.id, harness.chatId))
              .run(),
          );
        } else {
          writeSettings({
            proModelUsage:
              oldSettings.proModelUsage === "pro" ? "subscription" : "pro",
          });
        }
        release();
        await stream;
        expect(preflightSubscriptionTurn).toHaveBeenCalledTimes(2);
        if (change === "billing")
          expect(
            vi.mocked(preflightSubscriptionTurn).mock.calls[1][1].proModelUsage,
          ).toBe(readSettings().proModelUsage);
      } finally {
        release();
        await stream;
        writeSettings({ proModelUsage: oldSettings.proModelUsage });
      }
    },
    30_000,
  );

  it("parks the queue and stops during preflight without replacing the redo exchange", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(preflightSubscriptionTurn).mockImplementationOnce(
      async (model) => {
        entered();
        await gate;
        return { model };
      },
    );
    const stream = harness.streamChat("tc=no-code-response", { redo: true });
    await started;
    try {
      await parkChatQueue(harness.db, harness.chatId);
      await cancelActiveStreamsForChat(harness.chatId, undefined);
      const result = await stream;
      expect(result.messages).toEqual(originalMessages);
    } finally {
      release();
      await stream;
    }
  }, 30_000);

  it("replaces only the latest exchange when preflight succeeds", async () => {
    const result = await harness.streamChat("tc=no-code-response", {
      redo: true,
    });

    expect(preflightSubscriptionTurn).toHaveBeenCalledOnce();
    expect(result.eventsFor("chat:response:error")).toHaveLength(0);
    expect(result.messages).toHaveLength(4);
    expect(result.messages.slice(0, 2)).toEqual(originalMessages.slice(0, 2));
    expect(result.messages[2]).toMatchObject({
      role: "user",
      content: "tc=no-code-response",
    });
    expect(result.messages[3].role).toBe("assistant");
    expect(result.messages.map((message) => message.id)).not.toContain(
      originalMessages[2].id,
    );
    expect(result.messages.map((message) => message.id)).not.toContain(
      originalMessages[3].id,
    );
  }, 30_000);
});
