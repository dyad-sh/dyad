// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import { chats } from "@/db/schema";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("chat mode preconditions", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      selectedModel: { provider: "auto", name: "free-pro" },
      settings: {
        defaultChatMode: "build",
        enableDyadPro: true,
        providerSettings: {
          auto: { apiKey: { value: "dyad-pro-key" } },
        },
      },
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("rejects Free Pro Build before accepting or latching the turn", async () => {
    const result = await harness.streamChat("stale build request", {
      requestedChatMode: "build",
      userInputRequestId: "stale-build-request",
    });

    expect(result.eventsFor("chat:response:error")).toHaveLength(1);
    expect(result.messages).toHaveLength(0);
    const chat = await harness.db.query.chats.findFirst({
      where: eq(chats.id, harness.chatId),
    });
    expect(chat?.chatMode).toBeNull();
  }, 30_000);
});
