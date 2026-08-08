import { describe, expect, it } from "vitest";

import {
  CLOUD_PROVIDERS,
  MODEL_OPTIONS,
  PROVIDER_TO_ENV_VAR,
} from "@/ipc/shared/language_model_constants";
import {
  DEFAULT_VIDEO_MODEL,
  MIN_VIDEO_DURATION_SECONDS,
  normalizeVideoDuration,
  VIDEO_FORMAT_META,
} from "@/ipc/types/video_generation";
import {
  filterModelsForRole,
  inferModelCapabilities,
  createRoleModelOption,
} from "@/lib/model_roles";
import { collectSettingsSecrets, providerEnvName } from "@/ipc/utils/vault_env";
import type { UserSettings } from "@/lib/schemas";

describe("fal as a provider", () => {
  it("is listed so it appears in the providers settings", () => {
    expect(CLOUD_PROVIDERS.fal).toBeDefined();
    expect(CLOUD_PROVIDERS.fal.displayName).toBe("fal.ai");
    expect(CLOUD_PROVIDERS.fal.websiteUrl).toContain("fal.ai");
  });

  it("is kept out of the chat model picker", () => {
    expect(CLOUD_PROVIDERS.fal.nonChat).toBe(true);
  });

  it("maps to the env var the fal client already reads", () => {
    expect(PROVIDER_TO_ENV_VAR.fal).toBe("FAL_KEY");
    expect(providerEnvName("fal")).toBe("FAL_KEY");
  });

  it("mirrors its key into the vault .env", () => {
    const entries = collectSettingsSecrets({
      providerSettings: { fal: { apiKey: { value: "fal-key" } } },
    } as unknown as UserSettings);
    expect(entries.FAL_KEY).toBe("fal-key");
  });

  it("offers video models, including the default", () => {
    const names = MODEL_OPTIONS.fal.map((model) => model.name);
    expect(names).toContain(DEFAULT_VIDEO_MODEL);
    expect(MODEL_OPTIONS.fal.length).toBeGreaterThan(1);
  });
});

describe("fal models and the video role", () => {
  const options = MODEL_OPTIONS.fal.map((model) =>
    createRoleModelOption({
      provider: "fal",
      providerName: "fal.ai",
      model: {
        apiName: model.name,
        displayName: model.displayName,
        description: model.description,
      } as never,
      local: false,
    }),
  );

  it("marks every fal model as Video capable", () => {
    for (const option of options) {
      expect(option.capabilities).toContain("Video");
    }
  });

  it("makes them selectable for the video role", () => {
    expect(filterModelsForRole(options, "video")).toHaveLength(options.length);
  });

  it("keeps them out of the chat and coding roles", () => {
    expect(filterModelsForRole(options, "chat")).toHaveLength(0);
    expect(filterModelsForRole(options, "coding")).toHaveLength(0);
  });

  it("treats any fal model as video, whatever it is called", () => {
    const capabilities = inferModelCapabilities({
      provider: "fal",
      name: "some-unreleased-endpoint",
      displayName: "Unreleased",
      description: "",
      local: false,
    });
    expect(capabilities).toContain("Video");
    expect(capabilities).not.toContain("Text");
  });
});

describe("minimum video duration", () => {
  it("raises the old 5 second default to the floor", () => {
    expect(normalizeVideoDuration(undefined)).toBe("10");
    expect(normalizeVideoDuration("5")).toBe("10");
  });

  it("keeps a longer duration", () => {
    expect(normalizeVideoDuration("15")).toBe("15");
    expect(normalizeVideoDuration(30)).toBe("30");
  });

  it("keeps exactly the floor", () => {
    expect(normalizeVideoDuration("10")).toBe("10");
  });

  it("falls back to the floor for junk input", () => {
    expect(normalizeVideoDuration("")).toBe("10");
    expect(normalizeVideoDuration("abc")).toBe("10");
    expect(normalizeVideoDuration("-4")).toBe("10");
  });

  it("rounds a fractional request", () => {
    expect(normalizeVideoDuration("12.4")).toBe("12");
  });

  it("agrees with what the short-form formats advertise", () => {
    for (const meta of Object.values(VIDEO_FORMAT_META)) {
      expect(Number(meta.maxDuration)).toBeGreaterThanOrEqual(
        MIN_VIDEO_DURATION_SECONDS,
      );
    }
  });
});
