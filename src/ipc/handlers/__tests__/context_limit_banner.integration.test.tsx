import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { apps, chats, messages, language_models } from "@/db/schema";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { estimateTokens } from "@/ipc/utils/token_utils";
import { buildChatMessageHistory } from "@/pro/main/ipc/handlers/local_agent/local_agent_handler";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { readSettings, writeSettings } from "@/main/settings";
import {
  deleteAppBlueprintForChat,
  setAppBlueprintForChat,
} from "@/ipc/handlers/app_blueprint_handlers";

function makeEvent() {
  const frame = { url: "http://localhost:5173/" };
  return {
    sender: {
      mainFrame: frame,
      isDestroyed: () => false,
      isCrashed: () => false,
      send: () => {},
    },
    senderFrame: frame,
  };
}

async function countTokens(chatId: number) {
  const handler = h.ipcHandlers.get("chat:count-tokens");
  if (!handler) {
    throw new Error("chat:count-tokens handler is not registered");
  }
  const response = await handler(makeEvent(), { chatId, input: "" });
  return isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response;
}

async function setContextWindow(
  harness: HybridChatHarness,
  contextWindow: number,
) {
  await harness.db
    .update(language_models)
    .set({ context_window: contextWindow })
    .where(eq(language_models.apiName, "test-model"));
}

describe("context limit banner (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      provider: { id: "custom::testing" },
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("shows the near-limit warning and summarizes into a new chat", async () => {
    await setContextWindow(harness, 128_000);
    const originalChatId = await harness.createChat();
    harness.mount({ chatId: originalChatId });

    const { send } = await harness.typeInChat(
      "tc=context-limit-response [high-tokens=110000]",
      { chatId: originalChatId },
    );
    send();

    await harness.waitForStreamEnd(originalChatId);

    const banner = await screen.findByTestId(
      "context-limit-banner",
      {},
      { timeout: 15_000 },
    );
    expect(banner.textContent).toContain("This chat context is running out");

    fireEvent.click(screen.getByRole("button", { name: /Summarize/ }));

    await waitFor(
      () => {
        const newChatId = harness.currentLocation().search.id;
        expect(newChatId).toBeTruthy();
        expect(String(newChatId)).not.toBe(String(originalChatId));
      },
      { timeout: 15_000 },
    );
    await screen.findByText(`Summarize from chat-id=${originalChatId}`, {
      exact: false,
    });

    const newChatId = Number(harness.currentLocation().search.id);
    await harness.waitForStreamEnd(newChatId);

    const newChatMessages = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, newChatId),
      orderBy: (messages, { asc }) => [asc(messages.id)],
    });
    expect(newChatMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(newChatMessages[0].content).toBe(
      `Summarize from chat-id=${originalChatId}`,
    );
    expect(newChatMessages[1].content.replace(/\s+/g, " ")).toContain(
      "More EOM",
    );
  }, 60_000);

  it("shows the long-context cost warning for large context models", async () => {
    await setContextWindow(harness, 1_000_000);
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const { send } = await harness.typeInChat(
      "tc=context-limit-response [high-tokens=250000]",
      { chatId },
    );
    send();

    await harness.waitForStreamEnd(chatId);

    const banner = await screen.findByTestId(
      "context-limit-banner",
      {},
      { timeout: 15_000 },
    );
    expect(banner.textContent).toContain("Long chat context costs extra");
  }, 60_000);

  it("does not show the banner while safely within the context window", async () => {
    await setContextWindow(harness, 128_000);
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const { send } = await harness.typeInChat(
      "tc=context-limit-response [high-tokens=50000]",
      { chatId },
    );
    const countTokensCallsBeforeSend = harness.bridge.invokeLog.filter(
      (entry) => entry.channel === "chat:count-tokens",
    ).length;
    send();

    await harness.waitForStreamEnd(chatId);

    // The banner renders off the chat:count-tokens query that refetches after
    // the stream ends. Wait for that round-trip to complete (a wall-clock
    // sleep here lets the absence check pass vacuously under load).
    await waitFor(() => {
      const settledAfterSend = harness.bridge.invokeLog.filter(
        (entry) =>
          entry.channel === "chat:count-tokens" && entry.status !== "pending",
      ).length;
      expect(settledAfterSend).toBeGreaterThan(countTokensCallsBeforeSend);
    });
    expect(screen.queryByTestId("context-limit-banner")).toBeNull();
  }, 60_000);

  it("counts the structured post-compaction history used by agentic Build", async () => {
    const chatId = await harness.createChat();
    await harness.db.insert(messages).values([
      {
        chatId,
        role: "user",
        content: "discarded context ".repeat(200),
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
      {
        chatId,
        role: "assistant",
        content: "compacted summary",
        isCompactionSummary: true,
        createdAt: new Date("2025-01-01T00:01:00Z"),
      },
      {
        chatId,
        role: "user",
        content: "current task",
        createdAt: new Date("2025-01-01T00:02:00Z"),
      },
      {
        chatId,
        role: "assistant",
        content: "I inspected the file.",
        aiMessagesJson: {
          sdkVersion: "ai@v6",
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolCallId: "read-large-file",
                  toolName: "read_file",
                  input: { path: "src/large.ts" },
                },
              ],
            },
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "read-large-file",
                  toolName: "read_file",
                  output: { type: "text", value: "x".repeat(4_000) },
                },
              ],
            },
            { role: "assistant", content: "I inspected the file." },
          ],
        },
        createdAt: new Date("2025-01-01T00:03:00Z"),
      },
    ]);

    const storedMessages = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, chatId),
      orderBy: (messages, { asc }) => [
        asc(messages.createdAt),
        asc(messages.id),
      ],
    });
    const expectedHistoryTokens = estimateTokens(
      JSON.stringify(buildChatMessageHistory(storedMessages)),
    );
    const result = await countTokens(chatId);

    expect(result.messageHistoryTokens).toBe(expectedHistoryTokens);
    expect(result.messageHistoryTokens).toBeGreaterThan(1_000);
  });

  it("excludes shell guidance and declarations from free-model token counts", async () => {
    const chatId = await harness.createChat();
    await harness.db
      .update(chats)
      .set({
        chatMode: "local-agent",
        modelSelection: {
          provider: "auto",
          name: "free-pro",
          effortLevel: "default",
        },
      })
      .where(eq(chats.id, chatId));
    const original = readSettings();
    try {
      writeSettings({
        enableDyadPro: true,
        providerSettings: {
          ...original.providerSettings,
          auto: { apiKey: { value: "test-key" } },
        },
        enableShellTool: false,
      });
      const freeWithoutShell = await countTokens(chatId);
      writeSettings({ enableShellTool: true });
      const freeWithShell = await countTokens(chatId);
      expect(freeWithShell.systemPromptTokens).toBe(
        freeWithoutShell.systemPromptTokens,
      );
      await harness.db
        .update(chats)
        .set({
          modelSelection: {
            provider: "custom::testing",
            name: "test-model",
            effortLevel: "default",
          },
        })
        .where(eq(chats.id, chatId));
      const paidWithShell = await countTokens(chatId);
      writeSettings({ enableShellTool: false });
      const paidWithoutShell = await countTokens(chatId);
      expect(paidWithShell.systemPromptTokens).toBeGreaterThan(
        paidWithoutShell.systemPromptTokens,
      );
    } finally {
      writeSettings(original);
    }
  });

  it("counts the blueprint prompt for the current blueprint and questionnaire state", async () => {
    const chatId = await harness.createChat();
    const chat = await harness.db.query.chats.findFirst({
      where: eq(chats.id, chatId),
    });
    expect(chat).toBeDefined();
    const originalApp = await harness.db.query.apps.findFirst({
      where: eq(apps.id, chat!.appId),
    });
    expect(originalApp).toBeDefined();
    await harness.db
      .update(apps)
      .set({ needsAppBlueprint: true })
      .where(eq(apps.id, chat!.appId));

    const originalSettings = readSettings();
    writeSettings({
      enableAppBlueprint: true,
      agentToolConsents: {
        ...originalSettings.agentToolConsents,
        planning_questionnaire: "always",
      },
    });

    try {
      const initialBlueprintTokens = (await countTokens(chatId))
        .systemPromptTokens;

      setAppBlueprintForChat(chatId, {
        appName: "Token Count Blueprint",
        userPrompt: "Build an app",
        attachments: [],
        templateId: "react",
        themeId: "default",
        designDirection: "Clean and focused",
        primaryColor: "#2563EB",
        visuals: [],
      });
      const updateBlueprintTokens = (await countTokens(chatId))
        .systemPromptTokens;

      deleteAppBlueprintForChat(chatId);
      writeSettings({
        agentToolConsents: {
          ...originalSettings.agentToolConsents,
          planning_questionnaire: "never",
        },
      });
      const disabledQuestionnaireTokens = (await countTokens(chatId))
        .systemPromptTokens;

      expect(updateBlueprintTokens).not.toBe(initialBlueprintTokens);
      expect(disabledQuestionnaireTokens).not.toBe(initialBlueprintTokens);
      expect(disabledQuestionnaireTokens).not.toBe(updateBlueprintTokens);
    } finally {
      deleteAppBlueprintForChat(chatId);
      await harness.db
        .update(apps)
        .set({ needsAppBlueprint: originalApp!.needsAppBlueprint })
        .where(eq(apps.id, chat!.appId));
      writeSettings({
        enableAppBlueprint: originalSettings.enableAppBlueprint,
        agentToolConsents: originalSettings.agentToolConsents,
      });
    }
  });
});
