import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { writeFile, rename } from "node:fs/promises";
import path from "node:path";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { apps, chats, messages } from "@/db/schema";
import { writeSettings } from "@/main/settings";
import { ipc } from "@/ipc/types";
const calls = vi.hoisted(() => ({
  run: vi.fn(),
  beforeDispatch: vi.fn(),
  beforeAdmission: vi.fn(),
}));
vi.mock("./runtime", async (original) => ({
  ...(await original<typeof import("./runtime")>()),
  claudeStatus: async () => ({
    connected: true,
    compatible: true,
    version: "2.1.261",
    detail: "ready",
  }),
  runClaudeTurn: calls.run,
}));
vi.mock("./disclosure", () => ({ hasClaudeDisclosure: async () => true }));
vi.mock("@/ipc/utils/mention_apps", async (original) => {
  const module = await original<typeof import("@/ipc/utils/mention_apps")>();
  return {
    ...module,
    resolveStickyReferencedApps: async (
      ...args: Parameters<typeof module.resolveStickyReferencedApps>
    ) => {
      await calls.beforeDispatch();
      return module.resolveStickyReferencedApps(...args);
    },
  };
});
vi.mock("../external_model_usage", async (original) => {
  const module = await original<typeof import("../external_model_usage")>();
  return {
    ...module,
    startExternalModelUsage: async (
      ...args: Parameters<typeof module.startExternalModelUsage>
    ) => {
      await calls.beforeAdmission();
      return module.startExternalModelUsage(...args);
    },
  };
});
let harness: HybridChatHarness;
beforeAll(async () => {
  harness = await setupHybridChatHarness({
    electronMock: h,
    settings: { isTestMode: true },
    engine: true,
  });
  writeSettings({
    selectedModel: { provider: "claude-code", name: "sonnet" },
    enableDyadPro: false,
    selectedChatMode: "build",
    defaultChatMode: "build",
  });
}, 60_000);
afterAll(async () => harness?.dispose());
beforeEach(() => {
  calls.run.mockReset();
  calls.beforeDispatch.mockReset();
  calls.beforeAdmission.mockReset();
  calls.run.mockImplementation(async (turn) => {
    await turn.onEvent({
      type: "assistant",
      message: { model: "claude-resolved", content: [] },
    });
    await turn.onEvent({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Answer" },
      },
    });
    await turn.onEvent({
      type: "result",
      result: "Answer",
      modelUsage: {
        "claude-resolved": {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 4,
        },
      },
    });
  });
});
it("creates Claude chats from defaults, expands summaries, and persists attribution/title", async () => {
  const source = await ipc.chat.createChat({ appId: harness.appId });
  await harness.db.insert(messages).values({
    chatId: source,
    role: "user",
    content: "violet lighthouse source context",
  });
  const target = await ipc.chat.createChat({ appId: harness.appId });
  await harness.streamChat(`Summarize from chat-id=${source}`, {
    chatId: target,
  });
  expect(calls.run).toHaveBeenCalledOnce();
  expect(calls.run.mock.calls[0][0]).toMatchObject({
    model: "sonnet",
    readOnly: true,
    resume: false,
  });
  expect(calls.run.mock.calls[0][0].prompt).toContain(
    "violet lighthouse source context",
  );
  const chat = await harness.db.query.chats.findFirst({
    where: eq(chats.id, target),
    with: { messages: true },
  });
  expect(chat).toMatchObject({
    executionBackend: "claude-code",
    claudeSessionState: "ready",
  });
  expect(chat?.title).toBeTruthy();
  expect(
    chat?.messages.find((message) => message.role === "assistant"),
  ).toMatchObject({
    model: "claude-resolved",
    executionBackend: "claude-code",
    content: "Answer",
  });
});
it("keeps security reviews read-only in Build and supplies the finding contract and app rules", async () => {
  await writeFile(
    path.join(harness.appDir, "SECURITY_RULES.md"),
    "Check violet access control",
  );
  const chatId = await ipc.chat.createChat({ appId: harness.appId });
  await harness.streamChat("/security-review", { chatId });
  expect(calls.run).toHaveBeenCalledOnce();
  expect(calls.run.mock.calls[0][0].readOnly).toBe(true);
  expect(calls.run.mock.calls[0][0].prompt).toContain("dyad-security-finding");
  expect(calls.run.mock.calls[0][0].prompt).toContain(
    "Check violet access control",
  );
});
it("rejects redo before deleting history or appending to the CLI session", async () => {
  const chatId = await ipc.chat.createChat({ appId: harness.appId });
  await harness.streamChat("Remember this", { chatId });
  const before = await harness.db.query.messages.findMany({
    where: eq(messages.chatId, chatId),
  });
  const retry = await harness.streamChat("Remember this", {
    chatId,
    redo: true,
  });
  expect(calls.run).toHaveBeenCalledOnce();
  expect(
    await harness.db.query.messages.findMany({
      where: eq(messages.chatId, chatId),
    }),
  ).toEqual(before);
  expect(JSON.stringify(retry.events)).toContain("Start a new chat to retry");
});

it("keeps the admitted model when the picker changes before backend dispatch", async () => {
  const chatId = await ipc.chat.createChat({ appId: harness.appId });
  calls.beforeDispatch.mockImplementationOnce(async () => {
    await harness.db
      .update(chats)
      .set({
        modelSelection: {
          provider: "claude-code",
          name: "opus",
          effortLevel: "medium",
        },
      })
      .where(eq(chats.id, chatId));
  });
  await harness.streamChat("Answer briefly", { chatId });
  expect(calls.run.mock.calls[0][0].model).toBe("sonnet");
  await harness.streamChat("Continue", { chatId });
  expect(calls.run.mock.calls[1][0]).toMatchObject({
    model: "opus",
    resume: true,
  });
});

it("starts a fresh session with copied visible history rather than replaying an old CLI session", async () => {
  const chatId = await ipc.chat.createChat({ appId: harness.appId });
  await harness.db.insert(messages).values([
    { chatId, role: "user", content: "Earlier forked request" },
    {
      chatId,
      role: "assistant",
      content: "Earlier visible answer",
      executionBackend: "claude-code",
      model: "claude-prior",
    },
  ]);
  await harness.streamChat("Continue from the restored files", { chatId });
  const turn = calls.run.mock.calls[0][0];
  expect(turn.resume).toBe(false);
  expect(turn.prompt).toContain("Earlier visible answer");
  expect(turn.prompt).toContain("do not replay historical tool calls or edits");
});

it("resolves the claimed app path after usage preflight", async () => {
  const app = await harness.db.query.apps.findFirst({
    where: eq(apps.id, harness.appId),
  });
  const relocated = harness.appDir + "-relocated";
  let moved = false;
  const chatId = await ipc.chat.createChat({ appId: harness.appId });
  calls.beforeAdmission.mockImplementationOnce(async () => {
    await rename(harness.appDir, relocated);
    moved = true;
    await harness.db
      .update(apps)
      .set({ path: app!.path + "-relocated" })
      .where(eq(apps.id, harness.appId));
  });
  try {
    await harness.streamChat("Read the app; do not edit.", { chatId });
    expect(calls.run).toHaveBeenCalledOnce();
    expect(calls.run.mock.calls[0][0].cwd).toBe(relocated);
  } finally {
    if (moved) await rename(relocated, harness.appDir);
    await harness.db
      .update(apps)
      .set({ path: app!.path })
      .where(eq(apps.id, harness.appId));
  }
});
