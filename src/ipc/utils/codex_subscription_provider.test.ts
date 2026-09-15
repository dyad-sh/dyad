vi.mock("../services/codex_subscription_account", () => ({
  markSubscriptionLimited: vi.fn(),
}));
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, streamText } from "ai";
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
  shapeSubscriptionRequest,
} from "./codex_subscription_provider";
import {
  finishSubscriptionUsage,
  startSubscriptionUsage,
} from "../services/codex_subscription_usage";
import {
  DyadErrorKind,
  isDyadErrorKindFilteredFromTelemetry,
} from "@/errors/dyad_error";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("Codex subscription Responses adapter", () => {
  it.each([undefined, false, true])(
    "sets priority only when Fast mode is enabled (%s)",
    async (fastMode) => {
      const fetch = vi.fn(
        async () =>
          new Response("data: [DONE]\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
      );
      vi.stubGlobal("fetch", fetch);
      const model = await createCodexSubscriptionModel(
        "test",
        null,
        undefined,
        fastMode,
      );
      const result = await model.doStream({ prompt: [] });
      await result.stream.cancel();
      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
      const body = JSON.parse(String(init?.body));
      if (fastMode) expect(body.service_tier).toBe("priority");
      else expect(body).not.toHaveProperty("service_tier");
    },
  );

  it.each([null, "accepted-key"])(
    "retains the billing source across model requests (%s)",
    async (key) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("data: [DONE]\n\n", {
              headers: { "content-type": "text/event-stream" },
            }),
        ),
      );
      const model = await createCodexSubscriptionModel("test", key);
      for (let step = 0; step < 2; step++) {
        const result = await model.doStream({ prompt: [] });
        await result.stream.cancel();
      }
      expect(startSubscriptionUsage).toHaveBeenCalledTimes(2);
      expect(startSubscriptionUsage).toHaveBeenNthCalledWith(
        2,
        "test",
        undefined,
        undefined,
        key,
        undefined,
      );
    },
  );
  it.each([502, 503])(
    "retries HTTP %s on the same subscription",
    async (status) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("private upstream context", { status }),
        )
        .mockResolvedValueOnce(
          new Response("data: [DONE]\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
        );
      vi.stubGlobal("fetch", fetch);
      const model = await createCodexSubscriptionModel("test", null);
      const result = await model.doStream({ prompt: [] });
      await result.stream.cancel();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[1]).toEqual(fetch.mock.calls[0]);
    },
  );

  it("bounds server retries and preserves a sanitized final error", async () => {
    const fetch = vi.fn(async () => new Response("secret", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const model = await createCodexSubscriptionModel("test", null);
    await expect(model.doStream({ prompt: [] })).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message: "ChatGPT subscription request failed (HTTP 503).",
      cause: undefined,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("cancels during server retry backoff", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
      setTimeout(() => controller.abort(), 10);
      return new Response("unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetch);
    const model = await createCodexSubscriptionModel("test", null);
    await expect(
      model.doStream({ prompt: [], abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  async function rejectedRequest(body: string, status = 400) {
    vi.stubGlobal("fetch", async () => new Response(body, { status }));
    const model = await createCodexSubscriptionModel("test", null);
    return model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
  }

  it.each([
    {
      error: {
        message: "Encrypted content could not be verified.",
        code: "invalid_encrypted_content",
      },
    },
    {
      message: "Encrypted content could not be verified.",
      code: "invalid_encrypted_content",
    },
  ])(
    "includes the provider message and code for HTTP 400: %j",
    async (body) => {
      await expect(rejectedRequest(JSON.stringify(body))).rejects.toMatchObject(
        {
          name: "DyadError",
          kind: DyadErrorKind.Validation,
          message:
            "ChatGPT subscription request failed (HTTP 400). Encrypted content could not be verified. (code: invalid_encrypted_content)",
        },
      );
      expect(
        isDyadErrorKindFilteredFromTelemetry(DyadErrorKind.Validation),
      ).toBe(true);
    },
  );

  it.each([
    { detail: "Unsupported parameter: temperature" },
    { error: "Unsupported parameter: temperature" },
  ])("supports alternate provider error envelopes: %j", async (body) => {
    await expect(rejectedRequest(JSON.stringify(body))).rejects.toThrow(
      "Unsupported parameter: temperature",
    );
  });

  it("redacts credentials and excludes unrelated response fields", async () => {
    await expect(
      rejectedRequest(
        JSON.stringify({
          error: {
            message:
              "Rejected test-access for test-account; bearer another-secret-token",
            code: "invalid_request",
          },
          request: { prompt: "private prompt", authorization: "test-access" },
        }),
      ),
    ).rejects.toMatchObject({
      message:
        "ChatGPT subscription request failed (HTTP 400). Rejected [redacted] for [redacted]; Bearer [redacted secret] (code: invalid_request)",
      cause: undefined,
    });
  });

  it.each([
    "",
    "<html>Proxy error</html>",
    "{invalid json",
    JSON.stringify({ error: { message: 42 } }),
    "x".repeat(20_000),
  ])("falls back to HTTP status for unusable bodies (%#)", async (body) => {
    await expect(rejectedRequest(body)).rejects.toThrow(
      "ChatGPT subscription request failed (HTTP 400).",
    );
  });

  it("bounds displayed provider details", async () => {
    const error = await rejectedRequest(
      JSON.stringify({ error: { message: "Invalid input. ".repeat(500) } }),
    ).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message.length).toBeLessThanOrEqual(2_100);
  });

  it("keeps upstream details out of reportable server errors", async () => {
    await expect(
      rejectedRequest(
        JSON.stringify({ error: { message: "private upstream context" } }),
        500,
      ),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message: "ChatGPT subscription request failed (HTTP 500).",
    });
  });

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
  it.each([false, true])(
    "finishes real SDK calls without waiting for usage reporting (generate=%s)",
    async (nonStreaming) => {
      vi.mocked(finishSubscriptionUsage).mockImplementationOnce(
        () => new Promise<void>(() => {}),
      );
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
            events
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(""),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }),
      );
      const options = {
        model: await createCodexSubscriptionModel("requested-model", null),
        system: "Dyad",
        prompt: "Hello",
        maxRetries: 0,
      };
      const result = nonStreaming
        ? await generateText(options)
        : streamText(options);
      if ("consumeStream" in result) await result.consumeStream();
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
    },
  );
  it("redacts rejected provider responses instead of retaining upstream content", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("sensitive upstream detail", { status: 401 }),
    );
    const result = streamText({
      model: await createCodexSubscriptionModel("test", null),
      prompt: "hello",
      maxRetries: 0,
    });
    const errors: unknown[] = [];
    await result.consumeStream({ onError: (error) => errors.push(error) });
    expect(JSON.stringify(errors)).not.toContain("sensitive upstream detail");
    expect(JSON.stringify(errors)).not.toContain("test-access");
  });
});
