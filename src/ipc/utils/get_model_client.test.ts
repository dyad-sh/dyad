import { describe, expect, test, vi } from "vitest";

import type { UserSettings } from "../../lib/schemas";
import { getModelClient } from "./get_model_client";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("../shared/language_model_helpers", () => ({
  getLanguageModelProviders: vi.fn(async () => [
    {
      id: "anthropic",
      name: "Anthropic",
      gatewayPrefix: "anthropic/",
      type: "cloud",
    },
  ]),
}));

describe("getModelClient", () => {
  test("keeps the Anthropic gateway prefix for Dyad Engine models", async () => {
    const { modelClient } = await getModelClient(
      {
        provider: "anthropic",
        name: "claude-sonnet-4-20250514",
      },
      {
        enableDyadPro: true,
        providerSettings: {
          auto: {
            apiKey: {
              value: "dyad-pro-key",
            },
          },
        },
      } as unknown as UserSettings,
    );

    expect((modelClient.model as { modelId: string }).modelId).toBe(
      "anthropic/claude-sonnet-4-20250514",
    );
  });
});
