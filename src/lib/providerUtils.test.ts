import { describe, expect, it } from "vitest";
import {
  isProviderSetup,
  isNonGoogleProviderSetup,
  isGoogleProviderSetup,
} from "./providerUtils";
import { PROVIDER_TO_ENV_VAR } from "../ipc/shared/language_model_constants";
import type { UserSettings } from "./schemas";

function makeSettings(
  overrides: {
    enableDyadPro?: boolean;
    providerSettings?: Record<string, any>;
  } = {},
): UserSettings {
  return {
    selectedModel: { provider: "auto", name: "auto" },
    providerSettings: overrides.providerSettings ?? {},
    ...("enableDyadPro" in overrides
      ? { enableDyadPro: overrides.enableDyadPro }
      : {}),
  } as unknown as UserSettings;
}

describe("isProviderSetup", () => {
  describe('"auto" (Dyad Pro) provider AND-gates on enableDyadPro', () => {
    it("returns false when Pro is disabled but a Pro token lingers (bug state)", () => {
      const settings = makeSettings({
        enableDyadPro: false,
        providerSettings: { auto: { apiKey: { value: "stale-pro-token" } } },
      });
      expect(isProviderSetup("auto", { settings, envVars: {} })).toBe(false);
    });

    it("returns true when Pro is enabled and a Pro token is saved", () => {
      const settings = makeSettings({
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "pro-token" } } },
      });
      expect(isProviderSetup("auto", { settings, envVars: {} })).toBe(true);
    });

    it("returns false when Pro is enabled but no Pro token is saved", () => {
      const settings = makeSettings({
        enableDyadPro: true,
        providerSettings: { auto: {} },
      });
      expect(isProviderSetup("auto", { settings, envVars: {} })).toBe(false);
    });

    it("returns false when Pro is disabled and no Pro token is saved", () => {
      const settings = makeSettings({
        enableDyadPro: false,
        providerSettings: {},
      });
      expect(isProviderSetup("auto", { settings, envVars: {} })).toBe(false);
    });

    it("returns false when enableDyadPro is unset (undefined) even with a token saved", () => {
      const settings = makeSettings({
        providerSettings: { auto: { apiKey: { value: "pro-token" } } },
      });
      expect(isProviderSetup("auto", { settings, envVars: {} })).toBe(false);
    });

    it("does not fall back to ambient env vars for the auto provider when Pro is disabled", () => {
      const settings = makeSettings({
        enableDyadPro: false,
        providerSettings: { auto: { apiKey: { value: "stale-pro-token" } } },
      });
      const envVars = { OPENAI_API_KEY: "sk-fallback" };
      expect(isProviderSetup("auto", { settings, envVars })).toBe(false);
    });

    it("treats an empty-string Pro token as not set up even when Pro is enabled", () => {
      const settings = makeSettings({
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "" } } },
      });
      expect(isProviderSetup("auto", { settings, envVars: {} })).toBe(false);
    });

    it("returns false for the auto provider when settings is null", () => {
      expect(
        isProviderSetup("auto", {
          settings: null,
          envVars: {},
        }),
      ).toBe(false);
    });
  });

  describe("regular providers are unaffected by the auto gate", () => {
    it("returns true for an API-key provider with a saved key", () => {
      const settings = makeSettings({
        providerSettings: { openai: { apiKey: { value: "sk-..." } } },
      });
      expect(isProviderSetup("openai", { settings, envVars: {} })).toBe(true);
    });

    it("returns false for an API-key provider with no key and no env var", () => {
      const settings = makeSettings({ providerSettings: {} });
      expect(isProviderSetup("openai", { settings, envVars: {} })).toBe(false);
    });

    it("returns true for a provider configured via ambient env var", () => {
      const settings = makeSettings({ providerSettings: {} });
      expect(
        isProviderSetup("anthropic", {
          settings,
          envVars: { ANTHROPIC_API_KEY: "sk-ant-..." },
        }),
      ).toBe(true);
    });

    it("returns true for every api-key provider in PROVIDER_TO_ENV_VAR via its mapped env var", () => {
      const settings = makeSettings({ providerSettings: {} });
      for (const [provider, envVar] of Object.entries(PROVIDER_TO_ENV_VAR)) {
        if (provider === "azure") {
          continue;
        }
        expect(
          isProviderSetup(provider, {
            settings,
            envVars: { [envVar]: `value-for-${provider}` },
          }),
        ).toBe(true);
      }
    });

    it("a saved key takes precedence over a missing env var", () => {
      const settings = makeSettings({
        providerSettings: { google: { apiKey: { value: "gem-key" } } },
      });
      expect(
        isProviderSetup("google", {
          settings,
          envVars: { GEMINI_API_KEY: "" },
        }),
      ).toBe(true);
    });
  });

  describe("vertex", () => {
    it("returns true with service account key, projectId, and location", () => {
      const settings = makeSettings({
        providerSettings: {
          vertex: {
            serviceAccountKey: { value: "sa-key" },
            projectId: "proj",
            location: "us",
          },
        },
      });
      expect(isProviderSetup("vertex", { settings, envVars: {} })).toBe(true);
    });

    it("returns false when partial vertex credentials are present", () => {
      const settings = makeSettings({
        providerSettings: {
          vertex: { serviceAccountKey: { value: "sa-key" } },
        },
      });
      expect(isProviderSetup("vertex", { settings, envVars: {} })).toBe(false);
    });

    it("returns false for vertex when only env vars exist (no service account)", () => {
      const settings = makeSettings({ providerSettings: {} });
      expect(isProviderSetup("vertex", { settings, envVars: {} })).toBe(false);
    });
  });

  describe("azure", () => {
    it("returns true with saved apiKey and resourceName", () => {
      const settings = makeSettings({
        providerSettings: {
          azure: {
            apiKey: { value: "az-key" },
            resourceName: "my-resource",
          },
        },
      });
      expect(isProviderSetup("azure", { settings, envVars: {} })).toBe(true);
    });

    it("returns true with AZURE_API_KEY and AZURE_RESOURCE_NAME env vars", () => {
      const settings = makeSettings({ providerSettings: {} });
      expect(
        isProviderSetup("azure", {
          settings,
          envVars: {
            AZURE_API_KEY: "az-key",
            AZURE_RESOURCE_NAME: "my-resource",
          },
        }),
      ).toBe(true);
    });

    it("returns false when apiKey is saved but resourceName is missing", () => {
      const settings = makeSettings({
        providerSettings: { azure: { apiKey: { value: "az-key" } } },
      });
      expect(isProviderSetup("azure", { settings, envVars: {} })).toBe(false);
    });
  });

  describe("custom providers via providerData", () => {
    it("returns true when a custom provider's envVarName is present in envVars", () => {
      const settings = makeSettings({ providerSettings: {} });
      expect(
        isProviderSetup("mycustom", {
          settings,
          envVars: { MYCUSTOM_KEY: "custom-val" },
          providerData: [{ id: "mycustom", envVarName: "MYCUSTOM_KEY" }],
        }),
      ).toBe(true);
    });

    it("returns false when a custom provider's envVarName is absent from envVars", () => {
      const settings = makeSettings({ providerSettings: {} });
      expect(
        isProviderSetup("mycustom", {
          settings,
          envVars: {},
          providerData: [{ id: "mycustom", envVarName: "MYCUSTOM_KEY" }],
        }),
      ).toBe(false);
    });
  });

  describe("isLoading", () => {
    it("returns false while provider data is still loading", () => {
      const settings = makeSettings({
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "pro-token" } } },
      });
      expect(
        isProviderSetup("auto", { settings, envVars: {}, isLoading: true }),
      ).toBe(false);
    });

    it("returns false for a configured provider while loading", () => {
      const settings = makeSettings({
        providerSettings: { openai: { apiKey: { value: "sk-..." } } },
      });
      expect(
        isProviderSetup("openai", { settings, envVars: {}, isLoading: true }),
      ).toBe(false);
    });
  });
});

describe("isNonGoogleProviderSetup", () => {
  it("excludes the auto provider even when Pro is enabled with a token", () => {
    const settings = makeSettings({
      enableDyadPro: true,
      providerSettings: { auto: { apiKey: { value: "pro-token" } } },
    });
    expect(isNonGoogleProviderSetup(settings, {})).toBe(false);
  });

  it("excludes the auto (Pro disabled) bug state", () => {
    const settings = makeSettings({
      enableDyadPro: false,
      providerSettings: { auto: { apiKey: { value: "stale-pro-token" } } },
    });
    expect(isNonGoogleProviderSetup(settings, {})).toBe(false);
  });

  it("returns true when a non-google, non-auto provider is set up via env var", () => {
    const settings = makeSettings({ providerSettings: {} });
    expect(
      isNonGoogleProviderSetup(settings, { OPENAI_API_KEY: "sk-..." }),
    ).toBe(true);
  });

  it("returns false when only google is set up", () => {
    const settings = makeSettings({
      providerSettings: { google: { apiKey: { value: "gem-key" } } },
    });
    expect(isNonGoogleProviderSetup(settings, {})).toBe(false);
  });

  it("returns true when an azure provider is fully configured via env vars", () => {
    const settings = makeSettings({ providerSettings: {} });
    expect(
      isNonGoogleProviderSetup(settings, {
        AZURE_API_KEY: "az-key",
        AZURE_RESOURCE_NAME: "res",
      }),
    ).toBe(true);
  });
});

describe("isGoogleProviderSetup", () => {
  it("returns true when google has a saved key", () => {
    const settings = makeSettings({
      providerSettings: { google: { apiKey: { value: "gem-key" } } },
    });
    expect(isGoogleProviderSetup(settings, {})).toBe(true);
  });

  it("returns true when GEMINI_API_KEY is in env vars", () => {
    const settings = makeSettings({ providerSettings: {} });
    expect(isGoogleProviderSetup(settings, { GEMINI_API_KEY: "gem-key" })).toBe(
      true,
    );
  });

  it("returns false when google is not configured", () => {
    const settings = makeSettings({ providerSettings: {} });
    expect(isGoogleProviderSetup(settings, {})).toBe(false);
  });
});
