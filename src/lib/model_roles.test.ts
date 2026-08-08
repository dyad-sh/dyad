import { describe, expect, it } from "vitest";
import {
  filterModelsForRole,
  inferModelCapabilities,
  selectBestModelForRole,
  type RoleModelOption,
} from "./model_roles";

function option(
  name: string,
  capabilities: RoleModelOption["capabilities"],
  local = false,
): RoleModelOption {
  return {
    provider: local ? "ollama" : "openrouter",
    providerName: local ? "Ollama" : "OpenRouter",
    name,
    displayName: name,
    capabilities,
    local,
  };
}

describe("model roles", () => {
  it("classifies generation, embedding, coding, and vision models", () => {
    expect(
      inferModelCapabilities({
        provider: "openrouter",
        name: "flux-1",
        displayName: "FLUX Image Generation",
        local: false,
      }),
    ).toContain("Image Generation");
    expect(
      inferModelCapabilities({
        provider: "ollama",
        name: "nomic-embed-text",
        displayName: "Nomic Embed",
        local: true,
      }),
    ).toEqual(expect.arrayContaining(["Embeddings", "Local"]));
    expect(
      inferModelCapabilities({
        provider: "lmstudio",
        name: "qwen2.5-vl-coder",
        displayName: "Qwen VL Coder",
        local: true,
      }),
    ).toEqual(expect.arrayContaining(["Vision", "OCR", "Coding"]));
  });

  it("never offers an incompatible model for a role", () => {
    const models = [
      option("chat", ["Text", "Cloud"]),
      option("embed", ["Embeddings", "Cloud"]),
      option("image", ["Image Generation", "Cloud"]),
    ];
    expect(
      filterModelsForRole(models, "embeddings").map((model) => model.name),
    ).toEqual(["embed"]);
    expect(
      filterModelsForRole(models, "image").map((model) => model.name),
    ).toEqual(["image"]);
  });

  it("prefers a suitable local model when automatic selection is enabled", () => {
    const best = selectBestModelForRole(
      [
        option("cloud-coder", ["Text", "Coding", "Cloud"]),
        option("local-coder", ["Text", "Coding", "Local"], true),
      ],
      "coding",
    );
    expect(best?.name).toBe("local-coder");
  });
});
