// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { chats, messages } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map(), credits: vi.fn() };
});
vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});
vi.mock("@/ipc/services/codex_subscription_credit_check", () => ({
  checkSubscriptionCredits: h.credits,
}));
let harness: ChatFlowHarness;
beforeAll(async () => {
  harness = await setupChatFlowHarness({
    electronMock: h,
    engine: true,
    settings: {
      enableDyadPro: true,
      providerSettings: { auto: { apiKey: { value: "admitted-key" } } },
    },
  });
}, 60_000);
beforeEach(async () => {
  h.credits
    .mockReset()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValue(
      new DyadError(
        "Duplicate credit check rejected",
        DyadErrorKind.Precondition,
      ),
    );
  await harness.db.delete(messages);
});
afterAll(async () => {
  await harness?.dispose();
});

it.each(["ask", "build", "local-agent", "plan"] as const)(
  "%s accepts and runs the first external request without a second credit check",
  async (chatMode) => {
    await harness.db
      .update(chats)
      .set({ chatMode })
      .where(eq(chats.id, harness.chatId));
    const result = await harness.streamChat("tc=no-code-response");
    expect(result.eventsFor("chat:response:error")).toHaveLength(0);
    expect(
      result.messages.some(
        (message) => message.role === "assistant" && Boolean(message.content),
      ),
    ).toBe(true);
    expect(h.credits).toHaveBeenCalledTimes(1);
    const stored = await harness.db.select().from(messages);
    expect(
      stored
        .filter((message) => message.role === "assistant")
        .every((message) => message.inferenceSource === "api-key"),
    ).toBe(true);
    expect(
      stored.find((message) => message.role === "user")?.inferenceSource,
    ).toBeNull();
  },
  30_000,
);
