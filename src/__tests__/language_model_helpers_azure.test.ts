import { describe, it, expect, vi } from "vitest";
import { getLanguageModelProviders } from "@/ipc/shared/language_model_helpers";

// Mock the database
vi.mock("@/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue([]), // Return empty array for custom providers
    }),
  },
}));

describe("Azure Language Model Configuration", () => {
  it("should include Azure provider in language model providers", async () => {
    const providers = await getLanguageModelProviders();
    const azureProvider = providers.find((p) => p.id === "azure");

    expect(azureProvider).toBeDefined();
    expect(azureProvider?.name).toBe("Azure OpenAI");
    expect(azureProvider?.type).toBe("cloud");
  });

  it("should have Azure models available in MODEL_OPTIONS", async () => {
    // Test that Azure models are defined in the MODEL_OPTIONS constant
    const module = await import("@/ipc/shared/language_model_helpers");
    const modelOptions = (module as any).MODEL_OPTIONS;

    expect(modelOptions).toBeDefined();
    expect(modelOptions.azure).toBeDefined();
    expect(Array.isArray(modelOptions.azure)).toBe(true);
    expect(modelOptions.azure.length).toBeGreaterThan(0);

    const gpt4oModel = modelOptions.azure.find((m: any) => m.name === "gpt-4o");
    expect(gpt4oModel).toBeDefined();
    expect(gpt4oModel?.displayName).toBe("GPT-4o");
    expect(gpt4oModel?.description).toBe("Azure OpenAI GPT-4o model");
  });

  it("should include all expected Azure models in MODEL_OPTIONS", async () => {
    const module = await import("@/ipc/shared/language_model_helpers");
    const modelOptions = (module as any).MODEL_OPTIONS;

    const expectedModels = [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4",
      "gpt-4-turbo",
      "gpt-35-turbo",
    ];
    const actualModelNames = modelOptions.azure?.map((m: any) => m.name) || [];

    expectedModels.forEach((modelName) => {
      expect(actualModelNames).toContain(modelName);
    });
  });

  it("should have Azure provider included in CLOUD_PROVIDERS", async () => {
    // Import the constants to test they include Azure
    const module = await import("@/ipc/shared/language_model_helpers");

    // Check that Azure is in the providers list
    const providers = await module.getLanguageModelProviders();
    const cloudProviders = providers.filter((p) => p.type === "cloud");
    const azureProvider = cloudProviders.find((p) => p.id === "azure");

    expect(azureProvider).toBeDefined();
  });

  it("should have correct Azure provider configuration", async () => {
    const providers = await getLanguageModelProviders();
    const azureProvider = providers.find((p) => p.id === "azure");

    expect(azureProvider?.id).toBe("azure");
    expect(azureProvider?.name).toBe("Azure OpenAI");
    expect(azureProvider?.type).toBe("cloud");
    expect(azureProvider?.websiteUrl).toBe("https://portal.azure.com/");
    expect(azureProvider?.hasFreeTier).toBe(false);
    expect(azureProvider?.envVarName).toBe("AZURE_API_KEY");
  });
});
