// @vitest-environment node
//
// This is a node chat-flow integration test despite the plain `.test.ts`
// suffix. The harness owns its Electron mock and conflicts with the shared
// happy-dom integration setup; see rules/hybrid-testing.md.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import { agentThreads, chats, messages } from "@/db/schema";
import { cancelSubagent } from "@/pro/main/ipc/handlers/local_agent/subagents/subagent_manager";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { and, asc, desc, eq } from "drizzle-orm";

describe("concurrent Local Agent writers (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      autoApprove: true,
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        enableImplementerSubagent: true,
        enableCodeExplorer: false,
        providerSettings: {
          auto: { apiKey: { value: "testdyadkey" } },
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  async function createLocalAgentChat(): Promise<number> {
    const [chat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "local-agent" })
      .returning({ id: chats.id });
    return chat.id;
  }

  async function latestImplementer(chatId: number) {
    return harness.db.query.agentThreads.findFirst({
      where: and(
        eq(agentThreads.chatId, chatId),
        eq(agentThreads.persona, "implementer"),
      ),
      orderBy: [desc(agentThreads.createdAt)],
    });
  }

  async function assistantMessages(chatId: number) {
    return harness.db.query.messages.findMany({
      where: and(eq(messages.chatId, chatId), eq(messages.role, "assistant")),
      orderBy: [asc(messages.id)],
    });
  }

  it("keeps root finalization and cancellation scoped to the owning turn and actor run", async () => {
    const stalledChatId = await createLocalAgentChat();
    const firstIndependentChatId = await createLocalAgentChat();
    const secondIndependentChatId = await createLocalAgentChat();

    let stalledRootSettled = false;
    const stalledRoot = harness
      .streamChat("tc=local-agent/concurrent-writers-root-a", {
        chatId: stalledChatId,
      })
      .finally(() => {
        stalledRootSettled = true;
      });

    await vi.waitFor(
      async () => {
        const thread = await latestImplementer(stalledChatId);
        expect(thread?.status).toBe("running");
        expect(harness.appFileExists("src/concurrent/root-a.ts")).toBe(true);
        expect(harness.appFileExists("src/concurrent/sidekick-a.ts")).toBe(
          true,
        );
      },
      { timeout: 20_000, interval: 50 },
    );

    const firstIndependent = await harness.streamChat(
      "tc=local-agent/concurrent-writers-root-b",
      { chatId: firstIndependentChatId },
    );

    expect(firstIndependent.result).not.toBe("error");
    expect(firstIndependent.event("chat:response:error")).toBeUndefined();
    expect(stalledRootSettled).toBe(false);
    expect((await latestImplementer(firstIndependentChatId))?.status).toBe(
      "completed",
    );
    expect(
      (await assistantMessages(firstIndependentChatId)).at(-1)?.commitHash,
    ).toBeTruthy();
    expect(harness.appFileExists("src/concurrent/root-b.ts")).toBe(true);
    expect(harness.appFileExists("src/concurrent/sidekick-b.ts")).toBe(true);

    const secondIndependent = harness.streamChat(
      "tc=local-agent/concurrent-writers-root-b",
      { chatId: secondIndependentChatId },
    );
    await vi.waitFor(
      async () => {
        expect((await latestImplementer(secondIndependentChatId))?.status).toBe(
          "running",
        );
      },
      { timeout: 20_000, interval: 50 },
    );

    const stalledImplementer = await latestImplementer(stalledChatId);
    expect(stalledImplementer).toBeTruthy();
    await cancelSubagent(stalledChatId, stalledImplementer!.id);

    const [stalledResult, secondIndependentResult] = await Promise.all([
      stalledRoot,
      secondIndependent,
    ]);

    expect(stalledResult.event("chat:response:error")).toBeTruthy();
    expect((await latestImplementer(stalledChatId))?.status).toBe("cancelled");
    expect(secondIndependentResult.result).not.toBe("error");
    expect(
      secondIndependentResult.event("chat:response:error"),
    ).toBeUndefined();
    expect((await latestImplementer(secondIndependentChatId))?.status).toBe(
      "completed",
    );
    const secondIndependentAssistant = (
      await assistantMessages(secondIndependentChatId)
    ).at(-1);
    expect(secondIndependentAssistant?.sourceCommitHash).toBeTruthy();
    expect(secondIndependentAssistant?.commitHash).toBeNull();
  }, 90_000);
});
