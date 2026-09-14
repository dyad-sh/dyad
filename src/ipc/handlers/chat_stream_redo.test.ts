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
import { messages } from "@/db/schema";
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
    vi.mocked(preflightSubscriptionTurn).mockImplementation(
      async (model) => model,
    );
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
