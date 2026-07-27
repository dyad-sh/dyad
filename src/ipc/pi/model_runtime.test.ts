// @vitest-environment node
import { describe, expect, it, afterEach, vi } from "vitest";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

const environment = vi.hoisted(() => ({
  values: {} as Record<string, string | undefined>,
}));
vi.mock("@/ipc/utils/read_env", () => ({
  getEnvVar: (name: string) => environment.values[name],
}));

import type { UserSettings } from "@/lib/schemas";
import {
  DyadSettingsCredentialStore,
  createDyadProviderAuthContext,
  getPiModels,
  resolveDyadModel,
  resetPiModelRuntimeForTesting,
  toDyadProviderId,
  toPiProviderId,
} from "./model_runtime";

describe("createDyadProviderAuthContext", () => {
  afterEach(() => {
    environment.values = {};
  });

  it("reads provider credentials from Dyad's shell environment bridge", async () => {
    environment.values.ANTHROPIC_API_KEY = "  shell-key  ";

    const context = createDyadProviderAuthContext();

    expect(await context.env("ANTHROPIC_API_KEY")).toBe("shell-key");
    expect(await context.env("OPENAI_API_KEY")).toBeUndefined();
  });

  it("configures a built-in provider from the shell environment bridge", async () => {
    environment.values.ANTHROPIC_API_KEY = "shell-key";
    const models = builtinModels({
      credentials: new DyadSettingsCredentialStore(() => settingsWithKeys({})),
      authContext: createDyadProviderAuthContext(),
    });

    await expect(models.getAuth("anthropic")).resolves.toMatchObject({
      auth: { apiKey: "shell-key" },
      source: "ANTHROPIC_API_KEY",
    });
  });

  it("preserves pi's ambient credential file lookup", async () => {
    const context = createDyadProviderAuthContext();

    expect(await context.fileExists("package.json")).toBe(true);
    expect(await context.fileExists("does-not-exist.pi-auth-test")).toBe(false);
  });
});

/** Build a minimal UserSettings with the given provider api keys. */
function settingsWithKeys(
  keys: Record<string, string | undefined>,
): UserSettings {
  const providerSettings: Record<string, { apiKey?: { value: string } }> = {};
  for (const [providerId, value] of Object.entries(keys)) {
    providerSettings[providerId] =
      value === undefined ? {} : { apiKey: { value } };
  }
  return { providerSettings } as unknown as UserSettings;
}

describe("provider id mapping", () => {
  it("maps Dyad provider ids to pi provider ids", () => {
    expect(toPiProviderId("vertex")).toBe("google-vertex");
    expect(toPiProviderId("azure")).toBe("azure-openai-responses");
    expect(toPiProviderId("bedrock")).toBe("amazon-bedrock");
    expect(toPiProviderId("openai")).toBe("openai");
  });

  it("maps pi provider ids back to Dyad provider ids", () => {
    expect(toDyadProviderId("google-vertex")).toBe("vertex");
    expect(toDyadProviderId("azure-openai-responses")).toBe("azure");
    expect(toDyadProviderId("amazon-bedrock")).toBe("bedrock");
    expect(toDyadProviderId("anthropic")).toBe("anthropic");
  });

  it("passes through unknown provider ids unchanged (custom providers)", () => {
    expect(toPiProviderId("custom::my-provider")).toBe("custom::my-provider");
    expect(toDyadProviderId("custom::my-provider")).toBe("custom::my-provider");
  });
});

describe("DyadSettingsCredentialStore", () => {
  it("reads a Dyad api key under the pi provider id", async () => {
    const store = new DyadSettingsCredentialStore(() =>
      settingsWithKeys({ vertex: "vertex-key" }),
    );
    // pi asks by pi provider id; the store must translate back to Dyad's id.
    const credential = await store.read("google-vertex");
    expect(credential).toEqual({ type: "api_key", key: "vertex-key" });
  });

  it("returns undefined when the provider has no key", async () => {
    const store = new DyadSettingsCredentialStore(() =>
      settingsWithKeys({ openai: undefined }),
    );
    expect(await store.read("openai")).toBeUndefined();
  });

  it("trims whitespace-only keys down to undefined", async () => {
    const store = new DyadSettingsCredentialStore(() =>
      settingsWithKeys({ openai: "   " }),
    );
    expect(await store.read("openai")).toBeUndefined();
  });

  it("lists configured providers under their pi provider ids", async () => {
    const store = new DyadSettingsCredentialStore(() =>
      settingsWithKeys({
        openai: "openai-key",
        vertex: "vertex-key",
        anthropic: undefined,
      }),
    );
    const list = await store.list();
    const ids = list.map((c) => c.providerId).sort();
    expect(ids).toEqual(["google-vertex", "openai"]);
    expect(list.every((c) => c.type === "api_key")).toBe(true);
  });

  it("modify is a no-op (Dyad owns credential writes)", async () => {
    const store = new DyadSettingsCredentialStore(() =>
      settingsWithKeys({ openai: "openai-key" }),
    );
    const result = await store.modify("openai", async () => ({
      type: "api_key",
      key: "should-be-ignored",
    }));
    expect(result).toBeUndefined();
  });
});

describe("resolveDyadModel", () => {
  afterEach(() => {
    environment.values = {};
    resetPiModelRuntimeForTesting();
  });

  it("resolves a known built-in model from the pi catalog", async () => {
    const model = await resolveDyadModel({
      provider: "anthropic",
      name: "claude-opus-4-7",
    });
    expect(model.provider).toBe("anthropic");
    expect(model.id).toBe("claude-opus-4-7");
    expect(model.api).toBe("anthropic-messages");
  });

  it("fabricates a model for a known provider but unknown model id", async () => {
    const model = await resolveDyadModel({
      provider: "openai",
      name: "gpt-does-not-exist-yet",
    });
    expect(model.provider).toBe("openai");
    expect(model.name).toBe("gpt-does-not-exist-yet");
    // Fabricated models still carry an api so the stream path can dispatch.
    expect(typeof model.api).toBe("string");
  });

  it("restores a custom provider URL after switching away and back", async () => {
    const providerId = "custom::switching";
    const findProvider = async (_id: string) => ({
      id: providerId,
      name: "Switching provider",
      type: "custom" as const,
      apiBaseUrl: "https://first.example/v1",
      envVarName: "SWITCHING_API_KEY",
    });

    await resolveDyadModel(
      { provider: providerId, name: "test-model" },
      findProvider,
    );
    await resolveDyadModel(
      { provider: providerId, name: "test-model" },
      async () => ({
        ...(await findProvider(providerId)),
        apiBaseUrl: "https://second.example/v1",
      }),
    );
    await resolveDyadModel(
      { provider: providerId, name: "test-model" },
      findProvider,
    );

    expect(getPiModels().getProvider(providerId)?.baseUrl).toBe(
      "https://first.example/v1",
    );
  });

  it("reads a custom provider key from its configured environment variable", async () => {
    const providerId = "custom::environment";
    environment.values.CUSTOM_PROVIDER_API_KEY = "custom-env-key";

    await resolveDyadModel(
      { provider: providerId, name: "test-model" },
      async () => ({
        id: providerId,
        name: "Environment provider",
        type: "custom",
        apiBaseUrl: "https://custom.example/v1",
        envVarName: "CUSTOM_PROVIDER_API_KEY",
      }),
    );

    await expect(getPiModels().getAuth(providerId)).resolves.toMatchObject({
      auth: { apiKey: "custom-env-key" },
      source: "CUSTOM_PROVIDER_API_KEY",
    });
  });
});
