import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearVercelAiGatewayModelCacheForTests,
  convertVercelGatewayModel,
  getVercelAiGatewayModels,
} from "./vercel_ai_gateway_catalog";

describe("Vercel AI Gateway catalog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearVercelAiGatewayModelCacheForTests();
  });

  it("converts gateway metadata into a role-classifiable model", () => {
    expect(
      convertVercelGatewayModel({
        id: "anthropic/claude-sonnet",
        name: "Claude Sonnet",
        description: "General-purpose model",
        context_window: 200_000,
        max_tokens: 64_000,
        type: "language",
        tags: ["tool-use", "reasoning"],
        modalities: { input: ["text", "image"], output: ["text"] },
      }),
    ).toMatchObject({
      apiName: "anthropic/claude-sonnet",
      displayName: "Claude Sonnet",
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      type: "cloud",
      description:
        "General-purpose model Capabilities: language, tool-use, reasoning, text input, image input, text output.",
    });
  });

  it("loads and caches the public models endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "openai/gpt-test", name: "GPT Test" }],
        }),
        { status: 200 },
      ),
    );

    await expect(getVercelAiGatewayModels()).resolves.toHaveLength(1);
    await expect(getVercelAiGatewayModels()).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
