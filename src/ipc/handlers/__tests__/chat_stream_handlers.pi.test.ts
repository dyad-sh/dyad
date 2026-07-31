// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import path from "node:path";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return {
    ipcHandlers: new Map(),
    models: { current: null as any },
  };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

vi.mock("@/ipc/pi/model_runtime", () => ({
  getPiModels: () => h.models.current,
  resolveDyadModel: (model: { provider: string; name: string }) =>
    h.models.current.getModel(model.provider, model.name),
}));

vi.mock("@/ipc/pi/stream_fn", async () => {
  const actual =
    await vi.importActual<typeof import("@/ipc/pi/stream_fn")>(
      "@/ipc/pi/stream_fn",
    );
  return {
    ...actual,
    buildStreamOptions: async () => ({}),
    createDyadStreamFn: () => (model: any, context: any, options: any) =>
      h.models.current.streamSimple(model, context, options),
  };
});

import { createModels } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { createFakeIpcEvent } from "@/testing/electron_mock";
import { apps, chats, messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { userInputRegistry } from "@/user_input/main";
import { writeSettings } from "@/main/settings";
import { invalidateDyadAppsBaseDirectoryCache } from "@/paths/paths";

function piMessages(
  row: { aiMessagesJson: unknown } | undefined,
): Array<Record<string, any>> {
  const transcript = row?.aiMessagesJson;
  if (
    !transcript ||
    typeof transcript !== "object" ||
    !("messages" in transcript) ||
    !Array.isArray(transcript.messages)
  ) {
    throw new Error("Expected a persisted pi transcript");
  }
  return transcript.messages as Array<Record<string, any>>;
}

describe("chat:stream pi pipeline (integration)", () => {
  let harness: ChatFlowHarness;
  const faux = fauxProvider({
    provider: "custom::testing",
    models: [{ id: "test-model", name: "test-model" }],
    tokensPerSecond: 100,
  });

  beforeAll(async () => {
    const models = createModels();
    models.setProvider(faux.provider);
    h.models.current = models;

    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        enableAppBlueprint: false,
        agentToolConsents: {},
      },
    });
    writeSettings({ customAppsFolder: path.dirname(harness.appDir) });
    invalidateDyadAppsBaseDirectoryCache();
    await harness.db
      .update(apps)
      .set({ path: path.basename(harness.appDir) })
      .where(eq(apps.id, harness.appId));
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("streams through a real pi Agent and persists a versioned transcript", async () => {
    faux.setResponses([fauxAssistantMessage("PI_HANDLER_OK")]);

    const result = await harness.streamChat("hello from handler");

    expect(result.eventsFor("chat:response:error")).toEqual([]);
    expect(result.event("chat:stream:start")?.payload).toMatchObject({
      chatId: harness.chatId,
    });
    expect(result.event("chat:response:end")?.payload).toMatchObject({
      chatId: harness.chatId,
      updatedFiles: false,
    });
    expect(result.event("chat:stream:end")?.payload).toMatchObject({
      chatId: harness.chatId,
    });

    const assistant = [...result.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("PI_HANDLER_OK");
    expect(assistant?.aiMessagesJson).toMatchObject({
      runtime: "pi",
      version: 1,
    });
    expect(piMessages(assistant).map((message) => message.role)).toEqual([
      "assistant",
    ]);
  });

  it("includes selected component source in the provider prompt", async () => {
    const [componentChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "local-agent" })
      .returning();
    let providerMessages: any[] = [];
    faux.setResponses([
      (context) => {
        providerMessages = context.messages;
        return fauxAssistantMessage("COMPONENT_CONTEXT_OK");
      },
    ]);

    await harness.streamChat("edit the selected component", {
      chatId: componentChat.id,
      selectedComponents: [
        {
          id: "selected-1",
          name: "App",
          relativePath: "src/App.tsx",
          lineNumber: 1,
          columnNumber: 0,
        },
      ],
    });

    const currentUser = providerMessages.at(-1);
    expect(currentUser?.role).toBe("user");
    expect(JSON.stringify(currentUser?.content)).toContain(
      "Minimal imported app",
    );
    expect(JSON.stringify(currentUser?.content)).toContain("Selected line: 1");
  });

  it("limits provider history to the configured number of user turns", async () => {
    const [historyChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "local-agent" })
      .returning();
    await harness.db.insert(messages).values([
      { chatId: historyChat.id, role: "user", content: "history-old-1" },
      { chatId: historyChat.id, role: "assistant", content: "answer-old-1" },
      { chatId: historyChat.id, role: "user", content: "history-kept-2" },
      { chatId: historyChat.id, role: "assistant", content: "answer-kept-2" },
      { chatId: historyChat.id, role: "user", content: "history-kept-3" },
      { chatId: historyChat.id, role: "assistant", content: "answer-kept-3" },
    ]);
    writeSettings({ maxChatTurnsInContext: 2 });
    let providerMessages: any[] = [];
    faux.setResponses([
      (context) => {
        providerMessages = context.messages;
        return fauxAssistantMessage("HISTORY_LIMIT_OK");
      },
    ]);

    try {
      await harness.streamChat("current turn", { chatId: historyChat.id });

      const providerContext = JSON.stringify(providerMessages);
      expect(providerContext).not.toContain("history-old-1");
      expect(providerContext).not.toContain("answer-old-1");
      expect(providerContext).toContain("history-kept-2");
      expect(providerContext).toContain("history-kept-3");
      expect(providerContext).toContain("current turn");
    } finally {
      writeSettings({ maxChatTurnsInContext: undefined });
    }
  });

  it("does not expose write tools while an app blueprint is pending", async () => {
    const [blueprintChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "local-agent" })
      .returning();
    await harness.db
      .update(apps)
      .set({ needsAppBlueprint: true })
      .where(eq(apps.id, harness.appId));
    writeSettings({ enableAppBlueprint: true });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("write_file", {
          path: "src/blocked-before-blueprint.txt",
          content: "must not be written\n",
          description: "should be gated by blueprint",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("BLUEPRINT_GATE_DONE")),
    ]);

    try {
      const result = await harness.streamChat("build a new app", {
        chatId: blueprintChat.id,
      });

      expect(harness.appFileExists("src/blocked-before-blueprint.txt")).toBe(
        false,
      );
      expect(
        result
          .eventsFor("chat:response:error")
          .some((event) =>
            String(event.payload).includes(
              "App blueprint must be created and approved",
            ),
          ),
      ).toBe(false);
    } finally {
      await harness.db
        .update(apps)
        .set({ needsAppBlueprint: false })
        .where(eq(apps.id, harness.appId));
      writeSettings({ enableAppBlueprint: false });
    }
  });

  it("resolves the stored app path before executing and committing a write tool", async () => {
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("write_file", {
          path: "src/pi-handler.txt",
          content: "written by pi\n",
          description: "pi handler integration",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("PI_TOOL_DONE")),
    ]);

    const result = await harness.streamChat("write a file through pi");

    expect(result.eventsFor("chat:response:error")).toEqual([]);
    expect(result.event("chat:response:end")?.payload).toMatchObject({
      updatedFiles: true,
    });
    expect(harness.readAppFile("src/pi-handler.txt")).toBe("written by pi\n");
    expect(harness.gitLog()[0]).toContain("[dyad]");

    const assistant = [...result.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    expect(assistant?.content).toContain(
      '<dyad-write path="src/pi-handler.txt"',
    );
    expect(assistant?.content).toContain("PI_TOOL_DONE");
    expect(piMessages(assistant).map((message) => message.role)).toEqual([
      "assistant",
      "toolResult",
      "assistant",
    ]);
  });

  it("durably checkpoints a completed mutating tool before the turn settles", async () => {
    const [checkpointChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "local-agent" })
      .returning();
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("write_file", {
          path: "src/checkpointed.txt",
          content: "durable\n",
          description: "checkpoint integration",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("streaming after checkpoint ".repeat(100)),
    ]);
    let settled = false;

    const streamPromise = harness
      .streamChat("write durably", { chatId: checkpointChat.id })
      .finally(() => {
        settled = true;
      });
    let checkpointedAssistant: typeof messages.$inferSelect | undefined;
    await waitUntilAsync(async () => {
      const rows = await harness.db.query.messages.findMany({
        where: eq(messages.chatId, checkpointChat.id),
      });
      checkpointedAssistant = rows.find(
        (message) =>
          message.role === "assistant" &&
          (message.aiMessagesJson as { runtime?: string } | null)?.runtime ===
            "pi" &&
          piMessages(message).some(
            (piMessage) => piMessage.role === "toolResult",
          ),
      );
      return checkpointedAssistant !== undefined;
    });

    expect(settled).toBe(false);
    expect(
      piMessages(checkpointedAssistant).map((message) => message.role),
    ).toEqual(["assistant", "toolResult"]);
    expect(harness.readAppFile("src/checkpointed.txt")).toBe("durable\n");
    await streamPromise;
  }, 30_000);

  it("rebuilds the structured transcript from sqlite on the next handler invocation", async () => {
    let restoredMessages: any[] = [];
    faux.setResponses([
      (context) => {
        restoredMessages = context.messages;
        return fauxAssistantMessage("PI_RESTORED_OK");
      },
    ]);

    const result = await harness.streamChat("continue after restart boundary");

    expect(result.eventsFor("chat:response:error")).toEqual([]);
    expect(restoredMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "toolResult",
      "assistant",
      "user",
    ]);
    const restoredToolCall = restoredMessages
      .filter((message) => message.role === "assistant")
      .flatMap((message) => message.content)
      .find((part) => part.type === "toolCall");
    expect(restoredToolCall).toMatchObject({
      name: "write_file",
      arguments: { path: "src/pi-handler.txt" },
    });
    expect(
      restoredMessages.some((message) => message.role === "toolResult"),
    ).toBe(true);
  });

  it("performs owed compaction before rebuilding provider history", async () => {
    const [compactionChat] = await harness.db
      .insert(chats)
      .values({
        appId: harness.appId,
        chatMode: "local-agent",
        pendingCompaction: true,
      })
      .returning();
    await harness.db.insert(messages).values([
      {
        chatId: compactionChat.id,
        role: "user",
        content: "old request",
      },
      {
        chatId: compactionChat.id,
        role: "assistant",
        content: "old response",
      },
    ]);
    let providerMessages: any[] = [];
    faux.setResponses([
      fauxAssistantMessage("compact summary"),
      (context) => {
        providerMessages = context.messages;
        return fauxAssistantMessage("AFTER_COMPACTION_OK");
      },
    ]);

    const result = await harness.streamChat("new request", {
      chatId: compactionChat.id,
    });

    expect(result.eventsFor("chat:response:error")).toEqual([]);
    expect(providerMessages.map((message) => message.role)).toEqual([
      "assistant",
      "user",
    ]);
    expect(providerMessages[0].content[0].text).toContain("compact summary");
    const compacted = await harness.db.query.chats.findFirst({
      where: eq(chats.id, compactionChat.id),
    });
    expect(compacted?.pendingCompaction).toBe(false);
    const compactedRows = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, compactionChat.id),
    });
    expect(compactedRows.some((message) => message.isCompactionSummary)).toBe(
      true,
    );
  });

  it("cancels a pi stream once and persists the aborted assistant transcript", async () => {
    faux.setResponses([fauxAssistantMessage("streaming ".repeat(2_000))]);
    const events: Array<{ channel: string; payload: any }> = [];
    const event = createFakeIpcEvent(events);
    const streamHandler = h.ipcHandlers.get("chat:stream")!;
    const cancelHandler = h.ipcHandlers.get("chat:cancel")!;

    const streamPromise = streamHandler(event, {
      chatId: harness.chatId,
      prompt: "cancel this pi response",
    });
    await waitUntil(() =>
      events.some((entry) => entry.channel === "chat:response:chunk"),
    );
    await cancelHandler(event, harness.chatId);
    await streamPromise;

    const cancelledEnds = events.filter(
      (entry) =>
        entry.channel === "chat:response:end" &&
        entry.payload?.wasCancelled === true,
    );
    expect(cancelledEnds).toHaveLength(1);
    const rows = await harness.db.query.messages.findMany();
    const assistant = [...rows]
      .reverse()
      .find((message) => message.role === "assistant");
    expect(assistant?.content).toContain("Response cancelled by user");
    expect(assistant?.aiMessagesJson).toMatchObject({
      runtime: "pi",
      version: 1,
    });
    const abortedAssistant = piMessages(assistant).find(
      (message) =>
        message.role === "assistant" && message.stopReason === "aborted",
    );
    expect(abortedAssistant).toBeDefined();
  }, 30_000);

  it("keeps ask mode read-only even when the model requests a write tool", async () => {
    const [askChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "ask" })
      .returning();
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("write_file", {
          path: "src/ask-must-not-write.txt",
          content: "forbidden\n",
          description: "must not run",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("ASK_READ_ONLY_OK"),
    ]);

    const result = await harness.streamChat("do not change files", {
      chatId: askChat.id,
    });

    expect(result.eventsFor("chat:response:error")).toEqual([]);
    expect(harness.appFileExists("src/ask-must-not-write.txt")).toBe(false);
    const askRows = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, askChat.id),
    });
    const assistant = askRows.find((message) => message.role === "assistant");
    const toolResult = piMessages(assistant).find(
      (message) => message.role === "toolResult",
    );
    expect(toolResult).toMatchObject({
      role: "toolResult",
      toolName: "write_file",
      isError: true,
    });
  });

  it("runs plan mode with planning tools and persists the draft", async () => {
    const [planChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "plan" })
      .returning();
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("write_plan", {
          title: "Pi integration plan",
          summary: "Verify plan mode",
          plan: "## Steps\n\n1. Keep the workspace read-only.\n",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("PLAN_MODE_OK"),
    ]);

    const result = await harness.streamChat("make a plan", {
      chatId: planChat.id,
    });

    expect(result.eventsFor("chat:response:error")).toEqual([]);
    expect(result.event("plan:update")?.payload).toMatchObject({
      chatId: planChat.id,
      title: "Pi integration plan",
    });
    expect(
      harness.readAppFile(`.dyad/plans/chat-${planChat.id}-plan.md`),
    ).toContain("## Steps");
    expect(result.event("chat:response:end")?.payload).toMatchObject({
      chatId: planChat.id,
      updatedFiles: false,
    });
  });

  it("passes image attachments to pi and persists them in the user transcript", async () => {
    const [imageChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "local-agent" })
      .returning();
    let providerMessages: any[] = [];
    faux.setResponses([
      (context) => {
        providerMessages = context.messages;
        return fauxAssistantMessage("IMAGE_OK");
      },
    ]);

    const result = await harness.streamChat("inspect this image", {
      chatId: imageChat.id,
      attachments: [
        {
          name: "pixel.png",
          type: "image/png",
          data: "data:image/png;base64,aW1hZ2U=",
          attachmentType: "chat-context",
        },
      ],
    });

    expect(result.eventsFor("chat:response:error")).toEqual([]);
    const providerUser = providerMessages.at(-1);
    expect(providerUser.role).toBe("user");
    expect(providerUser.content).toContainEqual({
      type: "image",
      mimeType: "image/png",
      data: "aW1hZ2U=",
    });
    const imageRows = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, imageChat.id),
    });
    const user = imageRows.find((message) => message.role === "user");
    expect(piMessages(user)[0].content).toContainEqual({
      type: "image",
      mimeType: "image/png",
      data: "aW1hZ2U=",
    });
  });

  it("persists provider errors as structured assistant history", async () => {
    const [errorChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "local-agent" })
      .returning();
    faux.setResponses([
      fauxAssistantMessage("partial provider output", {
        stopReason: "error",
        errorMessage: "provider integration failure",
      }),
    ]);

    const result = await harness.streamChat("trigger provider error", {
      chatId: errorChat.id,
    });

    expect(result.result).toBe("error");
    const errorPayload = result.event("chat:response:error")?.payload as
      | { error?: string }
      | undefined;
    expect(errorPayload?.error).toContain("provider integration failure");
    const errorRows = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, errorChat.id),
    });
    const assistant = errorRows.find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("");
    const failedAssistant = piMessages(assistant).at(-1);
    expect(failedAssistant).toMatchObject({
      role: "assistant",
      stopReason: "error",
      errorMessage: "provider integration failure",
      content: [],
    });
    expect(JSON.stringify(failedAssistant)).not.toContain(
      "partial provider output",
    );
  });

  it("persists model refusals as a clean inline warning", async () => {
    const [refusalChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "local-agent" })
      .returning();
    faux.setResponses([
      fauxAssistantMessage("partial refusal output", {
        stopReason: "error",
        errorMessage: "The model refused to complete the request",
      }),
    ]);

    const result = await harness.streamChat("trigger model refusal", {
      chatId: refusalChat.id,
    });

    expect(result.eventsFor("chat:response:error")).toEqual([]);
    expect(result.event("chat:response:end")).toBeDefined();
    const refusalRows = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, refusalChat.id),
    });
    const assistant = refusalRows.find(
      (message) => message.role === "assistant",
    );
    expect(assistant?.content).toContain("Model refused to respond");
    expect(assistant?.content).not.toContain("partial refusal output");
    expect(piMessages(assistant).at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "stop",
      content: [
        expect.objectContaining({
          text: expect.stringContaining("Model refused to respond"),
        }),
      ],
    });
  });

  it("parks a pi write tool until the user grants consent", async () => {
    const [consentChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "local-agent" })
      .returning();
    writeSettings({ agentToolConsents: { write_file: "ask" } });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("write_file", {
          path: "src/consented.txt",
          content: "consented\n",
          description: "consent integration",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("CONSENT_OK"),
    ]);

    try {
      const streamPromise = harness.streamChat("write after approval", {
        chatId: consentChat.id,
      });
      await waitUntil(() =>
        userInputRegistry
          .getPending()
          .some(
            (pending) =>
              pending.descriptor.kind === "agent-consent" &&
              pending.descriptor.chatId === consentChat.id,
          ),
      );
      const pending = userInputRegistry
        .getPending()
        .find(
          (request) =>
            request.descriptor.kind === "agent-consent" &&
            request.descriptor.chatId === consentChat.id,
        );
      expect(pending?.descriptor).toMatchObject({
        kind: "agent-consent",
        toolName: "write_file",
      });
      await userInputRegistry.respond(pending!.descriptor.requestId, {
        kind: "agent-consent",
        decision: "accept-once",
      });
      const result = await streamPromise;

      expect(result.eventsFor("chat:response:error")).toEqual([]);
      expect(harness.readAppFile("src/consented.txt")).toBe("consented\n");
    } finally {
      writeSettings({ agentToolConsents: { write_file: "always" } });
    }
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for event");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitUntilAsync(
  predicate: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for event");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
