import { fetchOllamaModels } from "@/ipc/handlers/local_model_ollama_handler";
import { describe, it, expect, vi } from "vitest";

global.fetch = vi.fn();

describe("fetchOllamaModels", () => {
  it("should fetch and process models correctly", async () => {
    const mockResponse = {
      models: [
        {
          name: "test-model:latest",
          modified_at: "2024-05-01T10:00:00.000Z",
          size: 4700000000,
          digest: "abcdef123456",
          details: {
            format: "gguf",
            family: "llama",
            families: ["llama"],
            parameter_size: "8B",
            quantization_level: "Q4_0",
          },
        },
      ],
    };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await fetchOllamaModels();

    expect(result.models).toEqual([
      {
        modelName: "test-model:latest",
        displayName: "Test Model",
        provider: "ollama",
      },
    ]);
    expect(fetch).toHaveBeenCalledWith("http://localhost:11434/api/tags");
  });

  it("should throw an error if the fetch fails", async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      statusText: "Not Found",
    });

    await expect(fetchOllamaModels()).rejects.toThrow("Failed to fetch models from Ollama");
  });

  it("should throw a connection error for fetch failures", async () => {
    (fetch as any).mockRejectedValue(new TypeError("fetch failed"));

    await expect(fetchOllamaModels()).rejects.toThrow(
      "Could not connect to Ollama. Make sure it's running at http://localhost:11434",
    );
  });
});
