import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { fetchLMStudioModels } from "@/ipc/handlers/local_model_lmstudio_handler";
import { afterEach, describe, it, expect, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetchWith(data: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data, object: "list" }),
    }),
  );
}

describe("fetchLMStudioModels", () => {
  it("includes generative models (llm and vlm) and drops embedding models", async () => {
    // Example response shape taken from LM Studio's /api/v0/models endpoint.
    stubFetchWith([
      {
        id: "google/gemma-4-e4b",
        object: "model",
        type: "vlm",
        publisher: "google",
        state: "loaded",
      },
      {
        id: "qwen/qwen3-8b",
        object: "model",
        type: "llm",
        publisher: "qwen",
        state: "loaded",
      },
      {
        id: "text-embedding-nomic-embed-text-v1.5",
        object: "model",
        type: "embeddings",
        publisher: "nomic-ai",
        state: "not-loaded",
      },
    ]);

    const { models } = await fetchLMStudioModels();

    expect(models.map((model) => model.modelName)).toEqual([
      "google/gemma-4-e4b",
      "qwen/qwen3-8b",
    ]);
    expect(models).toEqual([
      {
        modelName: "google/gemma-4-e4b",
        displayName: "google/gemma-4-e4b",
        provider: "lmstudio",
      },
      {
        modelName: "qwen/qwen3-8b",
        displayName: "qwen/qwen3-8b",
        provider: "lmstudio",
      },
    ]);
  });

  it("also drops the legacy singular 'embedding' type", async () => {
    stubFetchWith([
      { id: "chat-model", object: "model", type: "llm", state: "loaded" },
      {
        id: "legacy-embedding",
        object: "model",
        type: "embedding",
        state: "loaded",
      },
    ]);

    const { models } = await fetchLMStudioModels();

    expect(models.map((model) => model.modelName)).toEqual(["chat-model"]);
  });

  it("throws an external DyadError when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Service Unavailable",
      }),
    );

    await expect(fetchLMStudioModels()).rejects.toEqual(
      new DyadError(
        "Failed to fetch models from LM Studio",
        DyadErrorKind.External,
      ),
    );
  });
});
