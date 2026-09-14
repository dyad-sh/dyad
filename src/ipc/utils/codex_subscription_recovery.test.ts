// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";

const account = vi.hoisted(() => ({ id: "account-a" }));
vi.mock("../services/codex_subscription_auth", () => ({
  getCodexSubscriptionCredentials: async () => ({
    access: "access",
    accountId: account.id,
  }),
}));
vi.mock("../services/codex_subscription_account", () => ({
  markSubscriptionLimited: vi.fn(),
}));
vi.mock("../services/codex_subscription_usage", () => ({
  startSubscriptionUsage: vi.fn(async () => "usage-id"),
  finishSubscriptionUsage: vi.fn(async () => {}),
  interruptSubscriptionUsage: vi.fn(),
}));

import { createCodexSubscriptionModel } from "./codex_subscription_provider";
import {
  finishSubscriptionUsage,
  startSubscriptionUsage,
} from "../services/codex_subscription_usage";

let chatId = 1000;
beforeEach(() => {
  chatId++;
  account.id = "account-a";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function history(encrypted = "old-reasoning"): LanguageModelV3Prompt {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "Thinking",
          providerOptions: { openai: { reasoningEncryptedContent: encrypted } },
        },
        { type: "text", text: "I'll inspect the file." },
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "read_file",
          input: { path: "index.ts" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "read_file",
          output: { type: "text", value: "file contents" },
        },
      ],
    },
    { role: "user", content: [{ type: "text", text: "Continue" }] },
  ];
}

function rejected(code = "invalid_encrypted_content", status = 400) {
  return new Response(
    JSON.stringify({ error: { code, message: "Cannot read reasoning" } }),
    { status },
  );
}

function completed(failed = false) {
  const response = {
    id: "resp_1",
    created_at: 1,
    model: "test",
    output: [],
    usage: {
      input_tokens: 10,
      output_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
  const events = failed
    ? [
        {
          type: "error",
          code: "server_error",
          message: "Stream failed",
          param: null,
        },
      ]
    : [
        {
          type: "response.created",
          response: { ...response, status: "in_progress" },
        },
        {
          type: "response.completed",
          response: { ...response, status: "completed" },
        },
      ];
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    {
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

async function run(
  prompt = history(),
  modelName = "test",
  signal?: AbortSignal,
) {
  const model = await createCodexSubscriptionModel(modelName, { chatId });
  const result = await model.doStream({ prompt, abortSignal: signal });
  const reader = result.stream.getReader();
  while (!(await reader.read()).done) {
    /* consume the real SDK stream */
  }
}

function capture(respond: (call: number) => Response) {
  const requests: Array<{ input: Array<Record<string, unknown>> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return respond(requests.length);
    }),
  );
  return requests;
}

describe("subscription encrypted reasoning recovery", () => {
  it("retries only the HTTP request, then remembers old hashes across model instances and preserves new reasoning", async () => {
    const requests = capture((call) => (call === 1 ? rejected() : completed()));
    const prompt = history();
    const original = structuredClone(prompt);
    await run(prompt);
    expect(requests).toHaveLength(2);
    expect(
      requests[0].input.some(
        (item) => item.encrypted_content === "old-reasoning",
      ),
    ).toBe(true);
    expect(requests[1].input).toEqual(
      requests[0].input.filter((item) => item.type !== "reasoning"),
    );
    expect(requests[1].input.map((item) => item.type)).toContain(
      "function_call",
    );
    expect(requests[1].input.map((item) => item.type)).toContain(
      "function_call_output",
    );
    expect(startSubscriptionUsage).toHaveBeenCalledTimes(1);
    expect(finishSubscriptionUsage).toHaveBeenCalledTimes(1);
    expect(prompt).toEqual(original);

    await run([...history(), ...history("new-reasoning")]);
    expect(requests).toHaveLength(3);
    expect(
      requests[2].input
        .filter((item) => item.type === "reasoning")
        .map((item) => item.encrypted_content),
    ).toEqual(["new-reasoning"]);
  });

  it.each(["chat", "account", "model"])(
    "isolates exclusions by %s",
    async (boundary) => {
      const requests = capture((call) =>
        call === 1 ? rejected() : completed(),
      );
      await run();
      if (boundary === "chat") chatId++;
      if (boundary === "account") account.id = "account-b";
      await run(history(), boundary === "model" ? "other-model" : "test");
      expect(
        requests[2].input.some(
          (item) => item.encrypted_content === "old-reasoning",
        ),
      ).toBe(true);
    },
  );

  it("retries once and does not remember exclusions after a second HTTP rejection", async () => {
    const requests = capture((call) => (call <= 2 ? rejected() : completed()));
    await expect(run()).rejects.toThrow("invalid_encrypted_content");
    expect(requests).toHaveLength(2);
    await run();
    expect(
      requests[2].input.some(
        (item) => item.encrypted_content === "old-reasoning",
      ),
    ).toBe(true);
  });

  it("does not remember exclusions when HTTP 200 carries a stream error", async () => {
    const requests = capture((call) =>
      call === 1 ? rejected() : completed(call === 2),
    );
    await run();
    await run();
    expect(
      requests[2].input.some(
        (item) => item.encrypted_content === "old-reasoning",
      ),
    ).toBe(true);
  });

  it.each([
    [400, "other_error"],
    [401, "invalid_encrypted_content"],
    [500, "invalid_encrypted_content"],
  ] as const)("does not recover HTTP %i with code %s", async (status, code) => {
    const requests = capture(() => rejected(code, status));
    await expect(run()).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it("does not retry based on error message text", async () => {
    const requests = capture(
      () =>
        new Response(
          JSON.stringify({
            error: {
              message: "invalid_encrypted_content",
              code: "other_error",
            },
          }),
          { status: 400 },
        ),
    );
    await expect(run()).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it("does not retry when there are no encrypted reasoning items to remove", async () => {
    const requests = capture(() => rejected());
    await expect(
      run([{ role: "user", content: [{ type: "text", text: "hello" }] }]),
    ).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it("honors cancellation before the recovery request", async () => {
    const controller = new AbortController();
    const requests = capture(() => {
      controller.abort();
      return rejected();
    });
    await expect(run(history(), "test", controller.signal)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
});
