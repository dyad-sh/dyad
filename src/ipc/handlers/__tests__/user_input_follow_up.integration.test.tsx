import { cleanup } from "@testing-library/react";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { messages, userInputFollowUpHandoffs } from "@/db/schema";
import { ipc } from "@/ipc/types";
import { userInputClient } from "@/ipc/types/user_input";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { userInputRegistry } from "@/user_input/main";

describe("durable user-input follow-up handoff (integration)", () => {
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

  async function createAcceptedFollowUp(chatId: number, suffix: string) {
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
    await userInputClient.acceptFollowUp({
      requestId,
      chatId,
      prompt: followUpPrompt,
    });
    return { requestId, followUpPrompt };
  }

  it("dispatches one accepted follow-up after renderer hydration", async () => {
    const chatId = await harness.createChat();
    const { requestId } = await createAcceptedFollowUp(chatId, "after reload");

    harness.mount({ chatId });
    await harness.waitForStreamEnd(chatId);
    window.dispatchEvent(new Event("focus"));
    await harness.bridge.settleInFlight();

    const acceptedMessages = await harness.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(messages.userInputRequestId, requestId),
        ),
      );
    const starts = harness.bridge.invokeLog.filter(
      (entry) =>
        entry.channel === "chat:stream" &&
        (entry.args[0] as { userInputRequestId?: string } | undefined)
          ?.userInputRequestId === requestId,
    );
    expect(acceptedMessages).toHaveLength(1);
    expect(starts).toHaveLength(1);
    expect(
      await harness.db
        .select({ status: userInputFollowUpHandoffs.status })
        .from(userInputFollowUpHandoffs)
        .where(eq(userInputFollowUpHandoffs.requestId, requestId)),
    ).toEqual([{ status: "acknowledged" }]);
  }, 30_000);

  it("settles an accepted owner before chat deletion cascades its row", async () => {
    const chatId = await harness.createChat();
    const { requestId } = await createAcceptedFollowUp(chatId, "before delete");
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
    expect(
      await harness.db
        .select()
        .from(userInputFollowUpHandoffs)
        .where(eq(userInputFollowUpHandoffs.requestId, requestId)),
    ).toEqual([]);
  });
});
