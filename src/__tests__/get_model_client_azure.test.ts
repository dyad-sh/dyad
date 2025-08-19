import { describe, it, expect, vi, beforeEach } from "vitest";
import { getModelClient } from "@/ipc/utils/get_model_client";
import type { LargeLanguageModel, UserSettings } from "@/lib/schemas";

// Mock the azure SDK
vi.mock("@ai-sdk/azure", () => ({
  azure: vi.fn((modelName: string) => ({
    modelName,
    provider: "azure",
  })),
}));

// Mock environment variable reading
vi.mock("@/ipc/utils/read_env", () => ({
  getEnvVar: vi.fn(),
}));

// Mock language model providers
vi.mock("@/ipc/shared/language_model_helpers", () => ({
  getLanguageModelProviders: vi.fn().mockResolvedValue([
    {
      id: "azure",
      name: "Azure OpenAI",
      type: "cloud",
      envVarName: undefined,
    },
  ]),
}));

describe("getModelClient - Azure Provider", () => {
  const mockModel: LargeLanguageModel = {
    provider: "azure",
    name: "gpt-4o",
  };

  const mockSettings: UserSettings = {
    selectedModel: {
      provider: "azure",
      name: "gpt-4o",
    },
    selectedChatMode: "ask",
    releaseChannel: "stable",
    enableDyadPro: false,
    enableProLazyEditsMode: false,
    enableProSmartFilesContextMode: false,
    providerSettings: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create Azure model client with valid environment variables", async () => {
    // Mock environment variables
    const { getEnvVar } = await import("@/ipc/utils/read_env");
    (getEnvVar as any).mockImplementation((varName: string) => {
      if (varName === "AZURE_API_KEY") return "test-api-key";
      if (varName === "AZURE_RESOURCE_NAME") return "test-resource";
      return undefined;
    });

    const result = await getModelClient(mockModel, mockSettings);

    expect(result.modelClient.builtinProviderId).toBe("azure");
    expect(getEnvVar).toHaveBeenCalledWith("AZURE_API_KEY");
    expect(getEnvVar).toHaveBeenCalledWith("AZURE_RESOURCE_NAME");
  });

  it("should throw error when AZURE_API_KEY is missing", async () => {
    const { getEnvVar } = await import("@/ipc/utils/read_env");
    (getEnvVar as any).mockImplementation((varName: string) => {
      if (varName === "AZURE_RESOURCE_NAME") return "test-resource";
      return undefined; // Missing API key
    });

    await expect(getModelClient(mockModel, mockSettings)).rejects.toThrow(
      "Azure OpenAI API key is required",
    );
  });

  it("should throw error when AZURE_RESOURCE_NAME is missing", async () => {
    const { getEnvVar } = await import("@/ipc/utils/read_env");
    (getEnvVar as any).mockImplementation((varName: string) => {
      if (varName === "AZURE_API_KEY") return "test-api-key";
      return undefined; // Missing resource name
    });

    await expect(getModelClient(mockModel, mockSettings)).rejects.toThrow(
      "Azure OpenAI resource name is required",
    );
  });

  it("should call azure SDK with correct model name", async () => {
    const { getEnvVar } = await import("@/ipc/utils/read_env");
    (getEnvVar as any).mockImplementation((varName: string) => {
      if (varName === "AZURE_API_KEY") return "test-api-key";
      if (varName === "AZURE_RESOURCE_NAME") return "test-resource";
      return undefined;
    });

    const { azure } = await import("@ai-sdk/azure");

    await getModelClient(mockModel, mockSettings);

    expect(azure).toHaveBeenCalledWith("gpt-4o");
  });
});
