import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { apps, chats, messages } from "@/db/schema";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import {
  ChatStreamExecutor,
  parseMcpToolKey,
  type ChatStreamExecutorConfig,
  type ChatStreamExecutorDeps,
} from "./chat_stream_executor";

function makeFullStream(parts: Array<Record<string, unknown>>): any {
  return (async function* () {
    for (const part of parts) {
      yield part;
    }
  })();
}

describe("parseMcpToolKey", () => {
  it("splits on the last double-underscore", () => {
    expect(parseMcpToolKey("my__server__tool")).toEqual({
      serverName: "my__server",
      toolName: "tool",
    });
  });

  it("returns the whole key as tool name when there is no separator", () => {
    expect(parseMcpToolKey("plain")).toEqual({
      serverName: "",
      toolName: "plain",
    });
  });
});

describe("ChatStreamExecutor", () => {
  let harness: HandlerTestHarness;
  let placeholderMessageId: number;
  let sentChunks: Array<Record<string, unknown>>;
  let sentErrors: string[];
  let partials: string[];
  let cleanupCalls: number;
  let streamTextImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    harness = setupHandlerTestHarness();
    const appRow = harness.db
      .insert(apps)
      .values({ name: "test-app", path: "test-app" })
      .run();
    const chatRow = harness.db
      .insert(chats)
      .values({ appId: Number(appRow.lastInsertRowid) })
      .run();
    const messageRow = harness.db
      .insert(messages)
      .values({
        chatId: Number(chatRow.lastInsertRowid),
        role: "assistant",
        content: "",
      })
      .run();
    placeholderMessageId = Number(messageRow.lastInsertRowid);
    sentChunks = [];
    sentErrors = [];
    partials = [];
    cleanupCalls = 0;
    streamTextImpl = vi.fn();
  });

  afterEach(() => {
    harness.dispose();
  });

  function createExecutor({
    abortController = new AbortController(),
    settingsOverrides = {},
  }: {
    abortController?: AbortController;
    settingsOverrides?: Record<string, unknown>;
  } = {}) {
    const deps: ChatStreamExecutorDeps = {
      db: harness.ctx.db,
      sendChunk: (payload) => sentChunks.push(payload),
      sendError: (error) => sentErrors.push(error),
      onPartialResponse: (partial) => partials.push(partial),
      onStreamErrorCleanup: () => {
        cleanupCalls++;
      },
      streamTextImpl: streamTextImpl as any,
    };
    const config: ChatStreamExecutorConfig = {
      chatId: 1,
      appId: 1,
      appPath: "/tmp/nonexistent-app",
      chatContext: { contextPaths: [], smartContextAutoIncludes: [] },
      placeholderMessageId,
      abortController,
      settings: { ...harness.readSettings(), ...settingsOverrides } as any,
      modelClient: { model: {} as any, builtinProviderId: undefined } as any,
      isEngineEnabled: false,
      isDeepContextEnabled: false,
      dyadRequestId: undefined,
      systemPrompt: "test system prompt",
      mentionedAppsCodebases: [],
    };
    return new ChatStreamExecutor(deps, config);
  }

  it("accumulates text deltas, streams patches, and persists the response", async () => {
    streamTextImpl.mockReturnValueOnce({
      fullStream: makeFullStream([
        { type: "text-delta", text: "Hello " },
        { type: "text-delta", text: "world" },
      ]),
      usage: Promise.resolve({}),
    });

    const executor = createExecutor();
    const fullResponse = await executor.runMainStream({
      chatMessages: [{ role: "user", content: "hi" }],
      files: [],
    });

    expect(fullResponse).toBe("Hello world");
    // Patches must reconstruct the full content
    expect(sentChunks.length).toBeGreaterThan(0);
    const lastPartial = partials[partials.length - 1];
    expect(lastPartial).toBe("Hello world");
    // First chunk update always persists (throttle window starts at 0)
    const row = harness.db
      .select()
      .from(messages)
      .where(eq(messages.id, placeholderMessageId))
      .get();
    expect(row?.content).toContain("Hello");
    // System prompt and messages were passed through to streamText
    const callOptions = streamTextImpl.mock.calls[0][0];
    expect(callOptions.system).toBe("test system prompt");
    expect(callOptions.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("wraps reasoning deltas in think tags", async () => {
    streamTextImpl.mockReturnValueOnce({
      fullStream: makeFullStream([
        { type: "reasoning-delta", text: "pondering" },
        { type: "text-delta", text: "answer" },
      ]),
      usage: Promise.resolve({}),
    });

    const executor = createExecutor();
    const fullResponse = await executor.runMainStream({
      chatMessages: [{ role: "user", content: "hi" }],
      files: [],
    });

    expect(fullResponse).toBe("<think>pondering</think>answer");
  });

  it("escapes dyad tags inside reasoning content", async () => {
    streamTextImpl.mockReturnValueOnce({
      fullStream: makeFullStream([
        { type: "reasoning-delta", text: '<dyad-write path="x">' },
        { type: "text-delta", text: "done" },
      ]),
      usage: Promise.resolve({}),
    });

    const executor = createExecutor();
    const fullResponse = await executor.runMainStream({
      chatMessages: [{ role: "user", content: "hi" }],
      files: [],
    });

    expect(fullResponse).toContain("＜dyad-write");
    expect(fullResponse).not.toContain('<dyad-write path="x">');
  });

  it("renders MCP tool calls and results as dyad tags", async () => {
    streamTextImpl.mockReturnValueOnce({
      fullStream: makeFullStream([
        {
          type: "tool-call",
          toolName: "myserver__mytool",
          input: { a: 1 },
        },
        {
          type: "tool-result",
          toolName: "myserver__mytool",
          output: "result-text",
        },
      ]),
      usage: Promise.resolve({}),
    });

    const executor = createExecutor();
    const fullResponse = await executor.runMainStream({
      chatMessages: [{ role: "user", content: "hi" }],
      files: [],
    });

    expect(fullResponse).toContain(
      '<dyad-mcp-tool-call server="myserver" tool="mytool">',
    );
    expect(fullResponse).toContain(
      '<dyad-mcp-tool-result server="myserver" tool="mytool">',
    );
    expect(fullResponse).toContain("result-text");
  });

  it("continues the stream when a dyad-write tag is left unclosed", async () => {
    streamTextImpl
      .mockReturnValueOnce({
        fullStream: makeFullStream([
          {
            type: "text-delta",
            text: '<dyad-write path="src/a.ts">const a = 1;',
          },
        ]),
        usage: Promise.resolve({}),
      })
      .mockReturnValueOnce({
        fullStream: makeFullStream([
          { type: "text-delta", text: "\nconst b = 2;</dyad-write>" },
        ]),
        usage: Promise.resolve({}),
      });

    const executor = createExecutor();
    const fullResponse = await executor.runMainStream({
      chatMessages: [{ role: "user", content: "write code" }],
      files: [],
    });

    expect(streamTextImpl).toHaveBeenCalledTimes(2);
    expect(fullResponse).toContain("</dyad-write>");
    // The continuation request replays history plus the partial response
    const continuationOptions = streamTextImpl.mock.calls[1][0];
    const continuationMessages = continuationOptions.messages;
    expect(
      continuationMessages[continuationMessages.length - 1].content,
    ).toContain("Continue exactly where you left off");
  });

  it("gives up continuation after two attempts", async () => {
    const unclosed = {
      fullStream: makeFullStream([
        { type: "text-delta", text: '<dyad-write path="a.ts">x' },
      ]),
      usage: Promise.resolve({}),
    };
    streamTextImpl
      .mockReturnValueOnce(unclosed)
      .mockReturnValueOnce({
        fullStream: makeFullStream([
          { type: "text-delta", text: "still open" },
        ]),
        usage: Promise.resolve({}),
      })
      .mockReturnValueOnce({
        fullStream: makeFullStream([{ type: "text-delta", text: "more" }]),
        usage: Promise.resolve({}),
      });

    const executor = createExecutor();
    await executor.runMainStream({
      chatMessages: [{ role: "user", content: "write code" }],
      files: [],
    });

    // 1 main pass + max 2 continuation attempts
    expect(streamTextImpl).toHaveBeenCalledTimes(3);
  });

  it("stops processing chunks when aborted", async () => {
    const abortController = new AbortController();
    streamTextImpl.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "first" };
        abortController.abort();
        yield { type: "text-delta", text: "second" };
        yield { type: "text-delta", text: "third" };
      })(),
      usage: Promise.resolve({}),
    });

    const executor = createExecutor({ abortController });
    const fullResponse = await executor.runMainStream({
      chatMessages: [{ role: "user", content: "hi" }],
      files: [],
    });

    // The loop breaks after the chunk during which the abort happened
    expect(fullResponse).toContain("first");
    expect(fullResponse).not.toContain("third");
  });

  it("reports stream errors through sendError and cleans up", async () => {
    streamTextImpl.mockImplementationOnce((options: any) => {
      options.onError({ error: { message: "model exploded" } });
      return {
        fullStream: makeFullStream([]),
        usage: Promise.resolve({}),
      };
    });

    const executor = createExecutor();
    await executor.runMainStream({
      chatMessages: [{ role: "user", content: "hi" }],
      files: [],
    });

    expect(sentErrors).toHaveLength(1);
    expect(sentErrors[0]).toContain("model exploded");
    expect(cleanupCalls).toBe(1);
  });

  it("persists token usage from onFinish to the placeholder message", async () => {
    streamTextImpl.mockImplementationOnce((options: any) => {
      return {
        fullStream: (async function* () {
          yield { type: "text-delta", text: "done" };
          await options.onFinish({ usage: { totalTokens: 1234 } });
        })(),
        usage: Promise.resolve({ totalTokens: 1234 }),
      };
    });

    const executor = createExecutor();
    await executor.runMainStream({
      chatMessages: [{ role: "user", content: "hi" }],
      files: [],
    });

    const row = harness.db
      .select()
      .from(messages)
      .where(eq(messages.id, placeholderMessageId))
      .get();
    expect(row?.maxTokensUsed).toBe(1234);
  });

  it("starts from the provided initial response (MCP pre-pass)", async () => {
    streamTextImpl.mockReturnValueOnce({
      fullStream: makeFullStream([{ type: "text-delta", text: " suffix" }]),
      usage: Promise.resolve({}),
    });

    const executor = createExecutor();
    const fullResponse = await executor.runMainStream({
      chatMessages: [{ role: "user", content: "hi" }],
      files: [],
      initialFullResponse: "prefix",
    });

    expect(fullResponse).toBe("prefix suffix");
  });
});
