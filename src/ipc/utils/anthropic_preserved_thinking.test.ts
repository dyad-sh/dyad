// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
const { debug } = vi.hoisted(() => ({ debug: vi.fn() }));
import {
  THINKING_BINDING_BETA,
  withAnthropicPreservedThinking,
} from "./anthropic_preserved_thinking";

vi.mock("electron-log", () => ({ default: { scope: () => ({ debug }) } }));

const dropped = {
  type: "thinking_dropped",
  path: "messages.1.content.0",
  reason: "prefix_binding_mismatch",
};

describe("Anthropic preserved thinking", () => {
  it.each(["adaptive", "enabled"])(
    "configures %s thinking without losing SDK betas or options",
    async (type) => {
      const fetchFn = vi.fn(async () =>
        Response.json({ input_transformations: [] }),
      );
      await withAnthropicPreservedThinking(fetchFn)(
        "https://example.test/messages",
        {
          headers: {
            "anthropic-beta": "existing-beta",
            authorization: "Bearer test-key",
          },
          body: JSON.stringify({
            thinking: { type, budget_tokens: 1024, display: "summarized" },
          }),
        },
      );
      const init = (
        fetchFn.mock.calls[0] as unknown as [unknown, RequestInit]
      )[1];
      expect(new Headers(init.headers).get("anthropic-beta")).toBe(
        `existing-beta,${THINKING_BINDING_BETA}`,
      );
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer test-key",
      );
      expect(JSON.parse(String(init.body)).thinking).toEqual({
        type,
        budget_tokens: 1024,
        display: "summarized",
        block_binding: { prefix_mismatch_behavior: "drop_block" },
      });
    },
  );

  it.each([undefined, { type: "disabled" }, { type: "between_tools" }])(
    "leaves unsupported or absent thinking unchanged: %j",
    async (thinking) => {
      const response = Response.json({});
      const fetchFn = vi.fn(async () => response);
      const init = { body: JSON.stringify({ thinking }) };
      expect(
        await withAnthropicPreservedThinking(fetchFn)(
          "https://example.test",
          init,
        ),
      ).toBe(response);
      expect(fetchFn).toHaveBeenCalledWith("https://example.test", init);
    },
  );

  it("observes chunked SSE start and fallback transformations without changing bytes", async () => {
    debug.mockClear();
    const wrap = withAnthropicPreservedThinking;
    const wire = [
      {
        type: "message_start",
        message: {
          input_transformations: [dropped],
          content: "private prompt",
        },
      },
      { type: "content_block_delta", delta: { text: "private answer 🦀" } },
      { type: "message_delta", input_transformations: [] },
    ]
      .map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`)
      .join("");
    const bytes = new TextEncoder().encode(wire);
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 7)
            controller.enqueue(bytes.slice(i, i + 7));
          controller.close();
        },
      }),
      {
        headers: {
          "content-type": "text/event-stream",
          "request-id": "req-test",
        },
      },
    );
    const result = await wrap(async () => response)("https://example.test", {
      body: JSON.stringify({
        model: "claude-test",
        thinking: { type: "adaptive" },
      }),
    });
    expect(await result.text()).toBe(wire);
    expect(debug).toHaveBeenCalledTimes(2);
    expect(debug).toHaveBeenNthCalledWith(1, "input_transformations", {
      model: "claude-test",
      requestId: "req-test",
      input_transformations: [dropped],
    });
    expect(debug).toHaveBeenNthCalledWith(2, "input_transformations", {
      model: "claude-test",
      requestId: "req-test",
      input_transformations: [],
    });
    expect(JSON.stringify(debug.mock.calls)).not.toContain("private");
  });

  it("logs JSON transformations without consuming the response or extra fields", async () => {
    debug.mockClear();
    const payload = {
      input_transformations: [{ ...dropped, private: "secret" }],
      content: "private",
    };
    const result = await withAnthropicPreservedThinking(async () =>
      Response.json(payload),
    )("https://example.test", {
      headers: { "X-Dyad-Request-Id": "dyad-1" },
      body: JSON.stringify({
        model: "claude-test",
        thinking: { type: "enabled" },
      }),
    });
    expect(await result.json()).toEqual(payload);
    expect(debug).toHaveBeenCalledWith("input_transformations", {
      model: "claude-test",
      requestId: "dyad-1",
      input_transformations: [dropped],
    });
    expect(JSON.stringify(debug.mock.calls)).not.toContain("secret");
  });

  it("propagates stream cancellation upstream", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { "content-type": "text/event-stream" },
    });
    const result = await withAnthropicPreservedThinking(async () => response)(
      "https://example.test",
      { body: JSON.stringify({ thinking: { type: "adaptive" } }) },
    );
    await result.body!.cancel("stop");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledWith("stop");
  });

  it("leaves errors intact", async () => {
    const response = new Response("upstream failure", { status: 400 });
    expect(
      await withAnthropicPreservedThinking(async () => response)(
        "https://example.test",
        { body: JSON.stringify({ thinking: { type: "adaptive" } }) },
      ),
    ).toBe(response);
  });
});
