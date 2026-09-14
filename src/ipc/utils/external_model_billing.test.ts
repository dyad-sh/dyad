// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { generateText, streamText } from "ai";
import { wrapExternalModelBilling } from "./external_model_billing";
const mocks = vi.hoisted(() => ({ credits: vi.fn(async () => {}) }));
vi.mock("../services/codex_subscription_credit_check", () => ({
  checkSubscriptionCredits: mocks.credits,
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => {
    throw new Error("Must use captured billing key");
  },
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn() }) },
}));
const usage = {
  inputTokens: { total: 100, noCache: 70, cacheRead: 20, cacheWrite: 10 },
  outputTokens: { total: 50, text: 30, reasoning: 20 },
};
const finishReason = { unified: "stop" as const, raw: "stop" };
beforeEach(() => {
  mocks.credits.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ chargedUsd: 0.1 })),
  );
});
afterEach(() => vi.unstubAllGlobals());
it.each(["local", "byok"] as const)(
  "reports %s generate usage without sending inference content",
  async (connection) => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "private reply" }],
        finishReason,
        usage,
        warnings: [],
        response: { modelId: "resolved-model" },
      }),
    });
    const result = await generateText({
      model: wrapExternalModelBilling(
        model,
        { connection, modelProvider: "custom-provider" },
        "dyad-key",
      ),
      prompt: "private prompt",
    });
    expect(result.text).toBe("private reply");
    expect(mocks.credits).toHaveBeenCalledWith("dyad-key", undefined);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toMatch(/\/track-usage$/);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      connection,
      modelProvider: "custom-provider",
      modelId: "resolved-model",
      totalTokens: 150,
      cachedInputTokens: 20,
      uncachedInputTokens: 80,
      outputTokens: 50,
    });
    expect(String(init?.body)).not.toContain("private");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer dyad-key" });
  },
);
it("reports streamed usage once and uses resolved model attribution", async () => {
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "response-metadata",
            modelId: "resolved-local",
          });
          controller.enqueue({ type: "finish", finishReason, usage });
          controller.enqueue({ type: "finish", finishReason, usage });
          controller.close();
        },
      }),
    }),
  });
  await streamText({
    model: wrapExternalModelBilling(
      model,
      { connection: "local", modelProvider: "ollama" },
      "key",
    ),
    prompt: "test",
  }).consumeStream();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)),
  ).toMatchObject({ modelId: "resolved-local", connection: "local" });
});
it("blocks confirmed credit denial before inference", async () => {
  mocks.credits.mockRejectedValueOnce(new Error("Out of credits"));
  const generate = vi.fn();
  const model = new MockLanguageModelV3({ doGenerate: generate });
  await expect(
    generateText({
      model: wrapExternalModelBilling(
        model,
        { connection: "local", modelProvider: "ollama" },
        "key",
      ),
      prompt: "test",
      maxRetries: 0,
    }),
  ).rejects.toThrow("Out of credits");
  expect(generate).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it("does not charge cancelled streams without final usage", async () => {
  const cancel = vi.fn();
  const model = new MockLanguageModelV3({
    doStream: async () => ({ stream: new ReadableStream({ cancel }) }),
  });
  const wrapped = wrapExternalModelBilling(
    model,
    { connection: "local", modelProvider: "ollama" },
    "key",
  );
  if (typeof wrapped === "string" || wrapped.specificationVersion !== "v3")
    throw new Error("Expected v3");
  const result = await wrapped.doStream({ prompt: [] });
  await result.stream.cancel();
  expect(cancel).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
