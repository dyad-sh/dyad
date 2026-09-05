import { afterEach, describe, expect, it, vi } from "vitest";
import { streamText } from "ai";
vi.mock("../services/codex_subscription_auth", () => ({
  getCodexSubscriptionCredentials: async () => ({
    access: "test-access",
    accountId: "test-account",
  }),
}));
vi.mock("../services/codex_subscription_usage", () => ({
  startSubscriptionUsage: vi.fn(async () => "usage-id"),
  finishSubscriptionUsage: vi.fn(async () => {}),
  interruptSubscriptionUsage: vi.fn(),
}));
import {
  createCodexSubscriptionModel,
  portableModelParams,
  shapeSubscriptionRequest,
} from "./codex_subscription_provider";
import { finishSubscriptionUsage } from "../services/codex_subscription_usage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("Codex subscription Responses adapter", () => {
  it("shapes requests without dropping user text or tools", () => {
    const body = shapeSubscriptionRequest({
      model: "test",
      input: [
        { role: "system", content: "Dyad instructions" },
        { role: "user", content: "hello" },
      ],
      tools: [{ type: "function", name: "read_file" }],
      max_output_tokens: 100,
      temperature: 0.5,
      previous_response_id: "other-account",
    });
    expect(body).toMatchObject({
      store: false,
      stream: true,
      instructions: "Dyad instructions",
      input: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", name: "read_file" }],
    });
    expect(body).not.toHaveProperty("previous_response_id");
    expect(body).not.toHaveProperty("max_output_tokens");
  });
  it("keeps portable tool history but removes account-bound reasoning and IDs", () => {
    const params = portableModelParams({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "private",
              providerOptions: {
                openai: { itemId: "r1", reasoningEncryptedContent: "opaque" },
              },
            },
            {
              type: "tool-call",
              toolCallId: "call1",
              toolName: "read_file",
              input: { path: "a" },
              providerOptions: { openai: { itemId: "fc1" } },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call1",
              toolName: "read_file",
              output: { type: "text", value: "file contents" },
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(params)).not.toContain("opaque");
    expect(JSON.stringify(params)).not.toContain("fc1");
    expect(params.prompt).toHaveLength(2);
    expect(params.prompt[0].content).toHaveLength(1);
    expect(JSON.stringify(params)).toContain("call1");
    expect(JSON.stringify(params)).toContain("file contents");
  });
  it("runs the real AI SDK stream parser against the subscription transport and reports actual usage", async () => {
    let sent: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
        sent = JSON.parse(init.body as string);
        const response = {
          id: "resp_test",
          created_at: 1,
          model: "resolved-model",
          status: "completed",
          output: [],
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            input_tokens_details: { cached_tokens: 20 },
            output_tokens_details: { reasoning_tokens: 3 },
          },
        };
        const events = [
          {
            type: "response.created",
            response: { ...response, status: "in_progress" },
          },
          {
            type: "response.output_item.added",
            output_index: 0,
            item: {
              type: "message",
              id: "msg_1",
              role: "assistant",
              content: [],
            },
          },
          {
            type: "response.content_part.added",
            item_id: "msg_1",
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          },
          {
            type: "response.output_text.delta",
            item_id: "msg_1",
            output_index: 0,
            content_index: 0,
            delta: "Hello",
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "message",
              id: "msg_1",
              role: "assistant",
              content: [
                { type: "output_text", text: "Hello", annotations: [] },
              ],
            },
          },
          { type: "response.completed", response },
        ];
        return new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }),
    );
    const result = streamText({
      model: await createCodexSubscriptionModel("requested-model"),
      system: "Dyad",
      prompt: "Hello",
      maxRetries: 0,
    });
    await result.consumeStream();
    expect(await result.text).toBe("Hello");
    expect(sent).toMatchObject({
      store: false,
      stream: true,
      instructions: "Dyad",
    });
    expect(finishSubscriptionUsage).toHaveBeenCalledWith(
      "usage-id",
      "resolved-model",
      expect.objectContaining({
        inputTokens: expect.objectContaining({ total: 100, cacheRead: 20 }),
        outputTokens: expect.objectContaining({ total: 10 }),
      }),
    );
  });
  it("redacts rejected provider responses instead of retaining upstream content", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("sensitive upstream detail", { status: 401 }),
    );
    const result = streamText({
      model: await createCodexSubscriptionModel("test"),
      prompt: "hello",
      maxRetries: 0,
    });
    const errors: unknown[] = [];
    await result.consumeStream({ onError: (error) => errors.push(error) });
    expect(JSON.stringify(errors)).not.toContain("sensitive upstream detail");
    expect(JSON.stringify(errors)).not.toContain("test-access");
  });
});
