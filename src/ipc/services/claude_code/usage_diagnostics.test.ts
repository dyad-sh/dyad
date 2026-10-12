// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ debug: vi.fn() }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ debug: mocks.debug }) },
}));
import { logClaudeUsageDiagnostics } from "./usage_diagnostics";

const context = {
  chatId: 1,
  messageId: 2,
  sessionId: "session",
  resume: false,
  billingEventId: "billing-event",
  requestedModel: "sonnet",
};
beforeEach(() => vi.clearAllMocks());

it("logs message counters and IDs without private CLI event fields", () => {
  logClaudeUsageDiagnostics(context, {
    type: "assistant",
    message: {
      id: "assistant-message",
      model: "claude-sonnet",
      content: [{ text: "private response" }],
      usage: { input_tokens: 10, output_tokens: 2, secret: "private key" },
    },
    prompt: "private prompt",
  });
  expect(mocks.debug).toHaveBeenCalledExactlyOnceWith(
    "Claude Code assistant usage",
    {
      ...context,
      assistantMessageId: "assistant-message",
      modelId: "claude-sonnet",
      usage: { input_tokens: 10, output_tokens: 2 },
    },
  );
});

it("logs separate turn and model counters across a resumed session", () => {
  const modelUsage = (inputTokens: number) => ({
    "claude-sonnet": {
      inputTokens,
      outputTokens: 2,
      cacheReadInputTokens: 20,
      cacheCreationInputTokens: 3,
      secret: "private key",
    },
  });
  for (const resume of [false, true]) {
    logClaudeUsageDiagnostics(
      { ...context, resume },
      {
        type: "result",
        num_turns: 1,
        usage: { input_tokens: 10, output_tokens: 2 },
        modelUsage: modelUsage(resume ? 20 : 10),
        result: "private response",
      },
    );
  }
  expect(mocks.debug).toHaveBeenCalledTimes(2);
  expect(mocks.debug).toHaveBeenLastCalledWith("Claude Code result usage", {
    ...context,
    resume: true,
    numTurns: 1,
    usage: { input_tokens: 10, output_tokens: 2 },
    modelUsage: {
      "claude-sonnet": {
        inputTokens: 20,
        outputTokens: 2,
        cacheReadInputTokens: 20,
        cacheCreationInputTokens: 3,
      },
    },
  });
  expect(JSON.stringify(mocks.debug.mock.calls)).not.toContain("private");
});

it("ignores unrelated or malformed events without logging their contents", () => {
  for (const event of [
    { type: "user", message: "private prompt" },
    { type: "assistant", message: { usage: { input_tokens: "private" } } },
    { type: "result", modelUsage: { model: { inputTokens: -1 } } },
    undefined,
  ])
    logClaudeUsageDiagnostics(context, event);
  expect(mocks.debug).not.toHaveBeenCalled();
});
