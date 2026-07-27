// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { UserSettings, LargeLanguageModel } from "@/lib/schemas";

// Mock the electron-dependent token utils so this unit test does not pull in
// @/main/settings (which imports electron).
const tokenUtils = vi.hoisted(() => ({
  getMaxTokens:
    vi.fn<(model: LargeLanguageModel) => Promise<number | undefined>>(),
  getTemperature:
    vi.fn<(model: LargeLanguageModel) => Promise<number | undefined>>(),
}));
vi.mock("@/ipc/utils/token_utils", () => tokenUtils);

const environment = vi.hoisted(() => ({
  values: {} as Record<string, string | undefined>,
}));
vi.mock("@/ipc/utils/read_env", () => ({
  getEnvVar: (name: string) => environment.values[name],
}));

// Mock the model runtime so createDyadStreamFn does not construct the real pi
// Models singleton (and so we can assert delegation).
const modelRuntime = vi.hoisted(() => ({
  streamSimpleMock: vi.fn(),
  getPiModels: vi.fn(),
}));
modelRuntime.getPiModels.mockReturnValue({
  streamSimple: modelRuntime.streamSimpleMock,
});
vi.mock("./model_runtime", () => ({
  getPiModels: modelRuntime.getPiModels,
}));

const vertexCredentials = vi.hoisted(() => ({
  materialize: vi.fn<(json: string) => Promise<string>>(),
}));
vi.mock("./vertex_credentials", () => ({
  materializeVertexServiceAccount: vertexCredentials.materialize,
}));

import {
  buildStreamOptions,
  createDyadStreamFn,
  mapThinkingLevel,
} from "./stream_fn";

const model: LargeLanguageModel = { provider: "openai", name: "gpt-5.2" };

function settings(partial: Partial<UserSettings>): UserSettings {
  return partial as UserSettings;
}

describe("mapThinkingLevel", () => {
  it("maps Dyad thinking budgets onto pi thinking levels", () => {
    expect(mapThinkingLevel("low")).toBe("low");
    expect(mapThinkingLevel("medium")).toBe("medium");
    expect(mapThinkingLevel("high")).toBe("high");
  });

  it("returns undefined when no thinking budget is set", () => {
    expect(mapThinkingLevel(undefined)).toBeUndefined();
  });
});

describe("buildStreamOptions", () => {
  beforeEach(() => {
    tokenUtils.getMaxTokens.mockReset();
    tokenUtils.getTemperature.mockReset();
    vertexCredentials.materialize.mockReset();
    environment.values = {};
  });

  it("includes maxTokens, temperature, and reasoning when available", async () => {
    tokenUtils.getMaxTokens.mockResolvedValue(4096);
    tokenUtils.getTemperature.mockResolvedValue(0.7);

    const options = await buildStreamOptions(
      model,
      settings({ thinkingBudget: "high" }),
    );

    expect(options.maxTokens).toBe(4096);
    expect(options.temperature).toBe(0.7);
    expect(options.reasoning).toBe("high");
  });

  it("omits maxTokens/temperature when the model utils return undefined", async () => {
    tokenUtils.getMaxTokens.mockResolvedValue(undefined);
    tokenUtils.getTemperature.mockResolvedValue(undefined);

    const options = await buildStreamOptions(model, settings({}));

    expect(options).not.toHaveProperty("maxTokens");
    expect(options).not.toHaveProperty("temperature");
    expect(options).not.toHaveProperty("reasoning");
  });

  it("omits reasoning when thinking budget is unset even if tokens exist", async () => {
    tokenUtils.getMaxTokens.mockResolvedValue(8192);
    tokenUtils.getTemperature.mockResolvedValue(undefined);

    const options = await buildStreamOptions(model, settings({}));

    expect(options.maxTokens).toBe(8192);
    expect(options).not.toHaveProperty("reasoning");
  });

  it("bridges Vertex project, location, and service-account JSON into provider env", async () => {
    tokenUtils.getMaxTokens.mockResolvedValue(undefined);
    tokenUtils.getTemperature.mockResolvedValue(undefined);
    vertexCredentials.materialize.mockResolvedValue("/tmp/vertex.json");

    const options = await buildStreamOptions(
      { provider: "vertex", name: "gemini-test" },
      settings({
        providerSettings: {
          vertex: {
            projectId: "project-1",
            location: "us-central1",
            serviceAccountKey: { value: '{"type":"service_account"}' },
          },
        },
      }),
    );

    expect(options.env).toMatchObject({
      GOOGLE_CLOUD_PROJECT: "project-1",
      GOOGLE_CLOUD_LOCATION: "us-central1",
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/vertex.json",
    });
  });

  it("bridges Azure resource name into provider env", async () => {
    tokenUtils.getMaxTokens.mockResolvedValue(undefined);
    tokenUtils.getTemperature.mockResolvedValue(undefined);

    const options = await buildStreamOptions(
      { provider: "azure", name: "gpt-test" },
      settings({
        providerSettings: {
          azure: { resourceName: "dyad-resource" },
        },
      }),
    );

    expect(options.env).toMatchObject({
      AZURE_OPENAI_RESOURCE_NAME: "dyad-resource",
    });
  });

  it("maps legacy Azure environment variables to pi provider names", async () => {
    tokenUtils.getMaxTokens.mockResolvedValue(undefined);
    tokenUtils.getTemperature.mockResolvedValue(undefined);
    environment.values = {
      AZURE_API_KEY: "legacy-azure-key",
      AZURE_RESOURCE_NAME: "legacy-resource",
    };

    const options = await buildStreamOptions(
      { provider: "azure", name: "gpt-test" },
      settings({}),
    );

    expect(options.env).toMatchObject({
      AZURE_OPENAI_API_KEY: "legacy-azure-key",
      AZURE_OPENAI_RESOURCE_NAME: "legacy-resource",
    });
  });

  it("adds OpenRouter attribution headers", async () => {
    tokenUtils.getMaxTokens.mockResolvedValue(undefined);
    tokenUtils.getTemperature.mockResolvedValue(undefined);

    const options = await buildStreamOptions(
      { provider: "openrouter", name: "test" },
      settings({}),
    );

    expect(options.headers).toEqual({
      "HTTP-Referer": "https://www.dyad.sh",
      "X-OpenRouter-Title": "Dyad",
      "X-OpenRouter-Categories": "native-app-builder,programming-app",
    });
  });

  it("adds the Dyad request id correlation header", async () => {
    tokenUtils.getMaxTokens.mockResolvedValue(undefined);
    tokenUtils.getTemperature.mockResolvedValue(undefined);

    const options = await buildStreamOptions(
      model,
      settings({}),
      "request-123",
    );

    expect(options.headers).toMatchObject({
      "x-dyad-internal-request-id": "request-123",
    });
  });

  it("forwards Bedrock shell credentials and region through provider env", async () => {
    tokenUtils.getMaxTokens.mockResolvedValue(undefined);
    tokenUtils.getTemperature.mockResolvedValue(undefined);
    environment.values = {
      AWS_REGION: "ap-southeast-1",
      AWS_PROFILE: "dyad-test",
      AWS_SESSION_TOKEN: "session-token",
    };

    const options = await buildStreamOptions(
      { provider: "bedrock", name: "anthropic.claude-test" },
      settings({}),
    );

    expect(options.env).toMatchObject(environment.values);
  });
});

describe("createDyadStreamFn", () => {
  beforeEach(() => {
    modelRuntime.streamSimpleMock.mockReset();
    modelRuntime.getPiModels.mockClear();
  });

  it("delegates to models.streamSimple with base options merged under per-call options", () => {
    const sentinel = Symbol("stream");
    modelRuntime.streamSimpleMock.mockReturnValue(sentinel);

    const streamFn = createDyadStreamFn({ maxTokens: 4096, temperature: 0.5 });
    const piModel = { id: "gpt-5.2" } as never;
    const context = { messages: [] } as never;

    const result = streamFn(piModel, context, { temperature: 0.9 } as never);

    expect(result).toBe(sentinel);
    expect(modelRuntime.streamSimpleMock).toHaveBeenCalledWith(
      piModel,
      context,
      // per-call temperature overrides the base option
      { maxTokens: 4096, temperature: 0.9 },
    );
  });
});
