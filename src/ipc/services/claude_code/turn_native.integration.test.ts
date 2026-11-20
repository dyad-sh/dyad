import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getUserDataPath } from "@/paths/paths";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { chats, messages } from "@/db/schema";
import { writeSettings } from "@/main/settings";
import { ipc } from "@/ipc/types";
import type { BackendTurn } from "./runtime";

const calls = vi.hoisted(() => ({
  run: vi.fn(),
  /** Extra work done "by the CLI" in the middle of a turn. */
  during: vi.fn(),
  version: "2.1.325",
}));
vi.mock("./runtime", async (original) => ({
  ...(await original<typeof import("./runtime")>()),
  claudeStatus: async () => ({
    connected: true,
    compatible: true,
    version: calls.version,
    detail: "ready",
  }),
  runClaudeTurn: calls.run,
}));

let harness: HybridChatHarness;
beforeAll(async () => {
  harness = await setupHybridChatHarness({
    electronMock: h,
    settings: { isTestMode: true },
    engine: true,
  });
}, 60_000);
afterAll(async () => harness?.dispose());

let uuidCounter = 0;
/** Simulates one native CLI turn: init, a Write tool call that really edits
 * the app, Dyad's PostToolUse hook, text and a result. */
async function nativeTurn(turn: BackendTurn) {
  const sessionId =
    turn.resume && turn.resumeAt ? `forked-${++uuidCounter}` : turn.sessionId;
  await turn.onEvent({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    tools: ["Read", "Write", "Edit", "Bash", ...(turn.dyadTools ?? [])],
    mcp_servers: [{ name: "dyad", status: "connected" }],
  });
  const steered: string[] = [];
  turn.onInputReady?.((text) => {
    steered.push(text);
    return true;
  });
  const filePath = path.join(turn.cwd, `native-${uuidCounter}.txt`);
  const input = { file_path: filePath, content: "written natively" };
  await turn.onEvent({
    type: "assistant",
    uuid: `assistant-${++uuidCounter}`,
    parent_tool_use_id: null,
    message: {
      model: "claude-resolved",
      content: [
        { type: "tool_use", id: `w${uuidCounter}`, name: "Write", input },
      ],
    },
  });
  await writeFile(filePath, input.content);
  await turn.onControlRequest!(
    {
      subtype: "hook_callback",
      callback_id: "dyad-post-tool",
      input: {
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: input,
      },
    },
    new AbortController().signal,
  );
  await turn.onEvent({
    type: "user",
    parent_tool_use_id: null,
    message: {
      content: [
        { type: "tool_result", tool_use_id: `w${uuidCounter}`, content: "ok" },
      ],
    },
  });
  await calls.during(turn, steered);
  const lastUuid = `assistant-${++uuidCounter}`;
  await turn.onEvent({
    type: "assistant",
    uuid: lastUuid,
    parent_tool_use_id: null,
    message: { model: "claude-resolved", content: [] },
  });
  await turn.onEvent({
    type: "stream_event",
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Done" },
    },
  });
  await turn.onEvent({
    type: "result",
    result: "Done",
    modelUsage: {
      "claude-resolved": {
        inputTokens: uuidCounter,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    },
  });
  return lastUuid;
}

beforeEach(() => {
  writeSettings({
    selectedModel: { provider: "claude-code", name: "sonnet" },
    enableDyadPro: false,
    enableClaudeCodeSubscription: true,
    enableClaudeCodeNativeTools: true,
    selectedChatMode: "local-agent",
    defaultChatMode: "local-agent",
  });
  calls.run.mockReset();
  calls.during.mockReset();
  calls.version = "2.1.325";
  calls.run.mockImplementation(nativeTurn);
});

const manifestFor = async (chatId: number) =>
  JSON.parse(
    await readFile(
      path.join(getUserDataPath(), "claude-sessions", `${chatId}.json`),
      "utf8",
    ),
  );
const assistantMessages = (chatId: number) =>
  harness.db.query.messages.findMany({
    where: and(eq(messages.chatId, chatId), eq(messages.role, "assistant")),
    orderBy: (m, { asc }) => [asc(m.id)],
  });

it("runs Agent turns with native tools and only Dyad-specific MCP tools", async () => {
  const chatId = await ipc.chat.createChat({
    appId: harness.appId,
    initialChatMode: "local-agent",
  });
  let prompt = "";
  calls.during.mockImplementationOnce(async (turn: BackendTurn) => {
    // The prompt file only lives as long as the turn.
    prompt = await readFile(turn.native!.appendSystemPromptPath, "utf8");
  });
  const result = await harness.streamChat("Write a file", { chatId });
  expect(result.event("chat:response:error")).toBeUndefined();
  const turn: BackendTurn = calls.run.mock.calls[0][0];
  expect(turn.native?.tools).toEqual(expect.arrayContaining(["Bash", "Edit"]));
  expect(turn.native?.permissionMode).toBe("auto");
  expect(turn.freshSystemPrompt).toBe(true);
  // Claude Code's own tools replace Dyad's; Dyad-only tools stay on MCP.
  expect(turn.dyadTools).toContain("mcp__dyad__restart_app");
  expect(turn.dyadTools).not.toContain("mcp__dyad__write_file");
  expect(turn.dyadTools).not.toContain("mcp__dyad__run_shell");
  expect(turn.dyadTools).not.toContain("mcp__dyad__spawn_agent");
  expect(prompt).toContain(
    "Background processes you start end when your turn ends",
  );
  expect(prompt).toContain("mcp__dyad__");

  const [assistant] = await assistantMessages(chatId);
  // The native Write shows as a card in stream order with Claude's text.
  expect(assistant.content).toMatch(/<dyad-claude-tool>[\s\S]*"kind":"write"/);
  expect(assistant.content.indexOf("<dyad-claude-tool>")).toBeLessThan(
    assistant.content.indexOf("Done"),
  );
  // Dyad's finalizer committed the file the CLI wrote.
  expect(assistant.commitHash).toBeTruthy();
  const manifest = await manifestFor(chatId);
  expect(manifest).toMatchObject({
    continuity: true,
    lastMessageId: assistant.id,
    ledger: { [String(assistant.id)]: expect.stringMatching(/^assistant-/) },
  });
});

it("keeps one session across turns and Agent/Ask mode switches", async () => {
  const chatId = await ipc.chat.createChat({
    appId: harness.appId,
    initialChatMode: "local-agent",
  });
  await harness.streamChat("First", { chatId });
  const first: BackendTurn = calls.run.mock.calls[0][0];
  // Ask turns use Dyad's tools, but resume the same CLI session.
  calls.run.mockImplementationOnce(async (turn: BackendTurn) => {
    expect(turn.native).toBeUndefined();
    await turn.onEvent({
      type: "system",
      subtype: "init",
      session_id: turn.sessionId,
      tools: turn.dyadTools,
      mcp_servers: [{ name: "dyad", status: "connected" }],
    });
    await turn.onEvent({
      type: "assistant",
      uuid: "ask-uuid",
      parent_tool_use_id: null,
      message: { model: "claude-resolved", content: [] },
    });
    await turn.onEvent({
      type: "result",
      result: "Answer",
      modelUsage: {
        "claude-resolved": {
          inputTokens: 100,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
    });
  });
  await harness.streamChat("Explain", { chatId, requestedChatMode: "ask" });
  await harness.streamChat("Third", { chatId });
  const turns: BackendTurn[] = calls.run.mock.calls.map((c) => c[0]);
  expect(turns).toHaveLength(3);
  for (const turn of turns.slice(1)) {
    expect(turn.resume).toBe(true);
    expect(turn.sessionId).toBe(first.sessionId);
    expect(turn.resumeAt).toBeUndefined();
  }
});

it("rewinds the session in a fork when the last answer was undone", async () => {
  const chatId = await ipc.chat.createChat({
    appId: harness.appId,
    initialChatMode: "local-agent",
  });
  await harness.streamChat("First", { chatId });
  await harness.streamChat("Second", { chatId });
  const [firstAnswer, secondAnswer] = await assistantMessages(chatId);
  const manifest = await manifestFor(chatId);
  const firstUuid = manifest.ledger[String(firstAnswer.id)];
  // Undo/retry removes the second exchange from Dyad's history.
  await harness.db.delete(messages).where(eq(messages.id, secondAnswer.id));
  await harness.streamChat("Second, again", { chatId });
  const rewound: BackendTurn = calls.run.mock.calls[2][0];
  expect(rewound.resume).toBe(true);
  expect(rewound.resumeAt).toBe(firstUuid);
  // The fork's new id is adopted for later turns.
  const chat = await harness.db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });
  expect(chat?.claudeSessionId).toMatch(/^forked-/);
  expect((await manifestFor(chatId)).sessionId).toBe(chat?.claudeSessionId);
  await harness.streamChat("Third", { chatId });
  const next: BackendTurn = calls.run.mock.calls[3][0];
  expect(next.sessionId).toBe(chat?.claudeSessionId);
  expect(next.resumeAt).toBeUndefined();
});

it("delivers Send now messages into the running turn and shows them inline", async () => {
  const chatId = await ipc.chat.createChat({
    appId: harness.appId,
    initialChatMode: "local-agent",
  });
  calls.during.mockImplementationOnce(async (_turn, steered: string[]) => {
    await expect(
      ipc.chat.claudeCodeSteer({ chatId, text: "Also add a footer" }),
    ).resolves.toEqual({ delivered: true });
    expect(steered).toEqual(["Also add a footer"]);
  });
  await harness.streamChat("Build a page", { chatId });
  const [assistant] = await assistantMessages(chatId);
  expect(assistant.content).toMatch(/"tool":"steer"[\s\S]*Also add a footer/);
  // Once the turn is over, nothing can be steered into it.
  await expect(
    ipc.chat.claudeCodeSteer({ chatId, text: "Too late" }),
  ).resolves.toEqual({ delivered: false });
});

it("keeps Dyad's tools when the app does not run on this computer", async () => {
  writeSettings({ runtimeMode2: "docker" });
  try {
    const chatId = await ipc.chat.createChat({
      appId: harness.appId,
      initialChatMode: "local-agent",
    });
    calls.run.mockImplementationOnce(async (turn: BackendTurn) => {
      expect(turn.native).toBeUndefined();
      await turn.onEvent({
        type: "system",
        subtype: "init",
        session_id: turn.sessionId,
        tools: turn.dyadTools,
        mcp_servers: [{ name: "dyad", status: "connected" }],
      });
      await turn.onEvent({
        type: "result",
        result: "Answer",
        modelUsage: {},
      });
    });
    const result = await harness.streamChat("Hello", { chatId });
    expect(calls.run).toHaveBeenCalledOnce();
    expect(JSON.stringify(result.event("chat:response:end"))).toContain(
      "Native Claude Code tools only run when the app runs on this computer",
    );
  } finally {
    writeSettings({ runtimeMode2: "host" });
  }
});

it("asks the user to update an outdated CLI instead of running natively", async () => {
  calls.version = "2.1.300";
  const chatId = await ipc.chat.createChat({
    appId: harness.appId,
    initialChatMode: "local-agent",
  });
  const result = await harness.streamChat("Write a file", { chatId });
  expect(calls.run).not.toHaveBeenCalled();
  expect(JSON.stringify(result.event("chat:response:error"))).toContain(
    "Native Claude Code tools need Claude Code 2.1.325 or later",
  );
});
