import { describe, expect, it } from "vitest";
import {
  MODEL_ROLES,
  filterModelsForRole,
  inferModelCapabilities,
  isRoleCapabilityGated,
  providerSettingsForRoleSelection,
  selectBestModelForRole,
  selectableModelsForRole,
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
  it("persists the exact local server that supplied a selected model", () => {
    const current = {
      ollama: { apiBaseUrl: "http://192.168.68.108:11434" },
      openrouter: { apiKey: { value: "saved" } },
    };
    const updated = providerSettingsForRoleSelection(current, {
      provider: "ollama",
      local: true,
      serverUrl: "http://localhost:11434",
    });

    expect(updated.ollama).toMatchObject({
      apiBaseUrl: "http://localhost:11434",
    });
    expect(updated.openrouter).toBe(current.openrouter);
  });

  it("does not alter provider settings for cloud selections", () => {
    const current = { openrouter: { apiKey: { value: "saved" } } };
    expect(
      providerSettingsForRoleSelection(current, {
        provider: "openrouter",
        local: false,
      }),
    ).toBe(current);
  });

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
        name: "x/flux2-klein:9b",
        displayName: "Flux 2 Klein 9B",
        local: true,
      }),
    ).toEqual(expect.arrayContaining(["Image Generation", "Local"]));
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

describe("what a role may be assigned", () => {
  /**
   * A provider's whole catalogue, none of which the regex classifier can
   * place. Exactly the case that was emptying the image and embeddings
   * pickers: the models are real and the provider is connected, the naming
   * simply does not announce what they do.
   */
  const catalogue = [
    option("mystery-one", ["Text", "Cloud"]),
    option("mystery-two", ["Text", "Cloud"]),
    option("nomic-embed-text", ["Embeddings", "Local"], true),
    option("flux-pro", ["Image Generation", "Cloud"]),
  ];

  it("offers every model for roles that do not require a video model", () => {
    for (const role of MODEL_ROLES) {
      if (role === "video") continue;
      expect(
        selectableModelsForRole(catalogue, role).length,
        `role "${role}" hides models from connected providers`,
      ).toBe(catalogue.length);
    }
  });

  it("keeps video restricted to models that can generate video", () => {
    expect(isRoleCapabilityGated("video")).toBe(true);
    expect(selectableModelsForRole(catalogue, "video")).toEqual([]);
  });

  it("keeps every configured provider available for image routing", () => {
    expect(isRoleCapabilityGated("image")).toBe(false);
    expect(
      selectableModelsForRole(catalogue, "image").map((model) => model.name),
    ).toEqual(["flux-pro", "mystery-one", "mystery-two", "nomic-embed-text"]);
  });

  it("lists the recommended models first without removing the others", () => {
    const forEmbeddings = selectableModelsForRole(catalogue, "embeddings");
    expect(forEmbeddings[0].name).toBe("nomic-embed-text");
    expect(forEmbeddings.map((model) => model.name)).toContain("mystery-one");
  });

  it("offers local text models as image-routing selections", () => {
    expect(
      selectableModelsForRole(catalogue, "image").some(
        (model) => model.name === "mystery-one",
      ),
    ).toBe(true);
  });

  it("can automatically route image requests when only a text model is online", () => {
    const localTextOnly = [option("local-chat", ["Local"], true)];
    expect(selectBestModelForRole(localTextOnly, "image")?.name).toBe(
      "local-chat",
    );
  });
});
