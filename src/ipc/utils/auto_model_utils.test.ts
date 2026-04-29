import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({
  getEnvVar: vi.fn(),
  getLanguageModelProviders: vi.fn(),
  resolveBuiltinModelAlias: vi.fn(),
}));

vi.mock("@/ipc/shared/language_model_helpers", () => ({
  getLanguageModelProviders: mocks.getLanguageModelProviders,
}));

vi.mock("@/ipc/shared/remote_language_model_catalog", () => ({
  resolveBuiltinModelAlias: mocks.resolveBuiltinModelAlias,
}));

vi.mock("@/ipc/utils/read_env", () => ({
  getEnvVar: mocks.getEnvVar,
}));

import { resolveAutoModelForSettings } from "./auto_model_utils";

function createSettings(settings: Partial<UserSettings>): UserSettings {
  return settings as UserSettings;
}

describe("resolveAutoModelForSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEnvVar.mockReturnValue(undefined);
    mocks.getLanguageModelProviders.mockResolvedValue([
      { id: "openai", envVarName: "OPENAI_API_KEY" },
      { id: "anthropic", envVarName: "ANTHROPIC_API_KEY" },
      { id: "google", envVarName: "GOOGLE_GENERATIVE_AI_API_KEY" },
    ]);
    mocks.resolveBuiltinModelAlias.mockImplementation(async (aliasId) => {
      switch (aliasId) {
        case "dyad/auto/openai":
          return { providerId: "openai", apiName: "gpt-5.2" };
        case "dyad/auto/anthropic":
          return { providerId: "anthropic", apiName: "claude-sonnet-4-6" };
        case "dyad/auto/google":
          return { providerId: "google", apiName: "gemini-3-flash-preview" };
        default:
          return null;
      }
    });
  });

  it("uses the first auto alias whose resolved provider has an API key", async () => {
    await expect(
      resolveAutoModelForSettings(
        createSettings({
          providerSettings: {
            anthropic: { apiKey: { value: "test-anthropic-key" } },
          },
        }),
      ),
    ).resolves.toEqual({
      provider: "anthropic",
      name: "claude-sonnet-4-6",
    });
  });

  it("uses provider environment variables when settings do not contain a key", async () => {
    mocks.getEnvVar.mockImplementation((name) =>
      name === "GOOGLE_GENERATIVE_AI_API_KEY" ? "test-google-key" : undefined,
    );

    await expect(
      resolveAutoModelForSettings(createSettings({})),
    ).resolves.toEqual({
      provider: "google",
      name: "gemini-3-flash-preview",
    });
  });

  it("returns null when no resolved auto alias has an API key", async () => {
    await expect(
      resolveAutoModelForSettings(createSettings({})),
    ).resolves.toBeNull();
  });
});
