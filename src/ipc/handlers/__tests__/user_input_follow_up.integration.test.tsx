import { cleanup } from "@testing-library/react";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { messages } from "@/db/schema";
import { ipc } from "@/ipc/types";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { userInputRegistry } from "@/user_input/main";

describe("main-owned user-input follow-up recovery (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
      },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  async function createDueFollowUp(chatId: number, suffix: string) {
    const followUpPrompt =
      "Continue. I have completed the supabase integration.";
    const requestId = userInputRegistry.request({
      kind: "integration",
      chatId,
      provider: "supabase",
      classifier: "none",
      followUpPrompt: `${followUpPrompt} ${suffix}`,
    });
    const parked = userInputRegistry.park(requestId);
    await userInputRegistry.respond(requestId, {
      kind: "integration",
      provider: "supabase",
      completed: true,
    });
    await parked;
    userInputRegistry.streamFinished(chatId);
    return { requestId, followUpPrompt };
  }

  it("dispatches one due follow-up after renderer hydration", async () => {
    const chatId = await harness.createChat();
    const { requestId } = await createDueFollowUp(chatId, "after reload");

    harness.mount({ chatId });
    window.dispatchEvent(new Event("focus"));
    await harness.bridge.settleInFlight();

    let acceptedMessages: (typeof messages.$inferSelect)[] = [];
    await vi.waitFor(async () => {
      acceptedMessages = await harness.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.chatId, chatId),
            eq(messages.userInputRequestId, requestId),
          ),
        );
      expect(acceptedMessages).toHaveLength(1);
    });
    const starts = harness.bridge.invokeLog.filter(
      (entry) =>
        entry.channel === "chat:stream" &&
        (entry.args[0] as { userInputRequestId?: string } | undefined)
          ?.userInputRequestId === requestId,
    );
    expect(starts).toHaveLength(0);
    expect(
      userInputRegistry
        .getPending()
        .some((entry) => entry.descriptor.requestId === requestId),
    ).toBe(false);
  }, 30_000);

  it("settles a due owner before deleting its chat", async () => {
    const chatId = await harness.createChat();
    const { requestId } = await createDueFollowUp(chatId, "before delete");
    const eventBaseline = harness.bridge.sentEvents.length;

    await ipc.chat.deleteChat(chatId);

    expect(
      userInputRegistry
        .getPending()
        .some((entry) => entry.descriptor.requestId === requestId),
    ).toBe(false);
    expect(
      harness.bridge.sentEvents
        .slice(eventBaseline)
        .some(
          (event) =>
            event.channel === "user-input:settled" &&
            (
              event.args[0] as
                | { requestId?: string; outcome?: string }
                | undefined
            )?.requestId === requestId &&
            (event.args[0] as { outcome?: string }).outcome === "swept",
        ),
    ).toBe(true);
  });

  it("settles a due owner before app deletion cascades its chat", async () => {
    const chatId = await harness.createChat();
    const { requestId } = await createDueFollowUp(
      chatId,
      "before app deletion",
    );

    await ipc.app.deleteApp({ appId: harness.appId });

    expect(
      userInputRegistry
        .getPending()
        .some((entry) => entry.descriptor.requestId === requestId),
    ).toBe(false);
  }, 30_000);
});
