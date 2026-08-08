import { describe, expect, it, vi } from "vitest";
import {
  discoverLMStudioModels,
  mergeLocalModels,
  parseLMStudioV0Models,
  parseLMStudioV1Models,
  parseOpenAICompatibleModels,
} from "./lm_studio_models";

describe("parseOpenAICompatibleModels", () => {
  it("maps OpenAI list response", () => {
    const models = parseOpenAICompatibleModels({
      data: [{ id: "qwen/qwen2.5-35b-a3b" }],
    });
    expect(models).toEqual([
      {
        modelName: "qwen/qwen2.5-35b-a3b",
        displayName: "qwen/qwen2.5-35b-a3b",
        provider: "lmstudio",
      },
    ]);
  });
});

describe("parseLMStudioV1Models", () => {
  it("prefers loaded instance ids", () => {
    const models = parseLMStudioV1Models([
      {
        type: "llm",
        key: "qwen/qwen2.5-35b-a3b",
        display_name: "Qwen 2.5",
        loaded_instances: [{ id: "qwen/qwen2.5-35b-a3b" }],
      },
    ]);
    expect(models[0]?.modelName).toBe("qwen/qwen2.5-35b-a3b");
    expect(models[0]?.displayName).toBe("Qwen 2.5");
  });

  it("falls back to catalog keys when nothing is loaded", () => {
    const models = parseLMStudioV1Models([
      {
        type: "llm",
        key: "meta-llama-3.1-8b-instruct",
        display_name: "Llama 3.1 8B",
        loaded_instances: [],
      },
    ]);
    expect(models).toHaveLength(1);
    expect(models[0]?.modelName).toBe("meta-llama-3.1-8b-instruct");
  });

  it("returns only loaded models when any are loaded", () => {
    const models = parseLMStudioV1Models([
      {
        type: "llm",
        key: "loaded-model",
        loaded_instances: [{ id: "loaded-model" }],
      },
      {
        type: "llm",
        key: "not-loaded",
        loaded_instances: [],
      },
    ]);
    expect(models).toHaveLength(1);
    expect(models[0]?.modelName).toBe("loaded-model");
  });
});

describe("parseLMStudioV0Models", () => {
  it("includes loaded models regardless of type filter edge cases", () => {
    const models = parseLMStudioV0Models([
      {
        id: "qwen/qwen2.5-35b-a3b",
        type: "llm",
        state: "loaded",
      },
    ]);
    expect(models).toHaveLength(1);
  });

  it("skips embeddings that are not loaded", () => {
    const models = parseLMStudioV0Models([
      {
        id: "text-embedding-nomic",
        type: "embeddings",
        state: "not-loaded",
      },
    ]);
    expect(models).toHaveLength(0);
  });
});

describe("mergeLocalModels", () => {
  it("dedupes by modelName", () => {
    const merged = mergeLocalModels([
      [
        {
          modelName: "a",
          displayName: "a",
          provider: "lmstudio",
        },
      ],
      [
        {
          modelName: "a",
          displayName: "a2",
          provider: "lmstudio",
        },
        {
          modelName: "b",
          displayName: "b",
          provider: "lmstudio",
        },
      ],
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.modelName)).toEqual(["a", "b"]);
  });
});

describe("discoverLMStudioModels", () => {
  it("uses OpenAI endpoint first when it returns models", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/models")) {
        return new Response(
          JSON.stringify({ data: [{ id: "qwen/qwen2.5-35b-a3b" }] }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });

    const result = await discoverLMStudioModels("http://localhost:1234", {
      fetchFn: fetchFn as typeof fetch,
    });
    expect(result.source).toBe("openai");
    expect(result.models).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("reports unreachable when all endpoints fail", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await discoverLMStudioModels("http://localhost:1234", {
      fetchFn: fetchFn as typeof fetch,
    });
    expect(result.reachable).toBe(false);
    expect(result.models).toHaveLength(0);
  });
});
