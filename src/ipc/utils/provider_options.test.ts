import { describe, expect, it } from "vitest";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import type { ModelSelection, UserSettings } from "@/lib/schemas";
import {
  DYAD_INTERNAL_REQUEST_ID_HEADER,
  getAiHeaders,
  getProviderOptions,
} from "./provider_options";

const settingsFor = (provider: string, name: string, effortLevel: string) =>
  ({
    selectedModel: { provider, name, effortLevel },
    selectedChatMode: "build",
  }) as unknown as UserSettings;

const optionsFor = (
  settings: UserSettings,
  builtinProviderId?: string,
  reasoningEffortProviderId?: string,
  modelSelection = settings.selectedModel as ModelSelection,
) =>
  getProviderOptions({
    dyadAppId: 1,
    files: [],
    mentionedAppsCodebases: [],
    builtinProviderId,
    reasoningEffortProviderId,
    modelSelection,
  });

describe("getProviderOptions model effort", () => {
  it("uses thinking levels for Gemini 3 direct requests", () => {
    expect(
      optionsFor(settingsFor("google", "gemini-3-pro", "minimal"), "google")
        .google,
    ).toEqual({
      thinkingConfig: { includeThoughts: true, thinkingLevel: "minimal" },
    });
  });

  it("uses thinking budgets for earlier Gemini direct requests", () => {
    expect(
      optionsFor(settingsFor("google", "gemini-2.5-pro", "high"), "google")
        .google,
    ).toEqual({
      thinkingConfig: { includeThoughts: true, thinkingBudget: -1 },
    });
  });

  it("uses the resolved Gemini model when Auto routes to Google", () => {
    expect(
      optionsFor(settingsFor("auto", "auto", "medium"), "google", undefined, {
        provider: "google",
        name: "gemini-3.5-flash",
        effortLevel: "high",
      }).google,
    ).toEqual({
      thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
    });
  });

  it("does not coerce catalog-defined Gemini effort levels to medium", () => {
    expect(
      optionsFor(settingsFor("google", "gemini-2.5-pro", "xhigh"), "google")
        .google,
    ).toEqual({ thinkingConfig: { includeThoughts: true } });
  });

  it("does not send Gemini thinking config to other Google model families", () => {
    expect(
      optionsFor(settingsFor("google", "partner/model", "medium"), "google")
        .google,
    ).toBeUndefined();
  });

  it.each(["lmstudio", "custom::local"])(
    "passes None effort to %s",
    (provider) => {
      expect(
        optionsFor(settingsFor(provider, "gemma2", "none"), provider, provider)[
          provider
        ],
      ).toEqual({ reasoningEffort: "none" });
    },
  );

  it.each(["lmstudio", "custom::local"])(
    "serializes None effort in the %s request",
    async (providerId) => {
      let requestBody: Record<string, unknown> | undefined;
      const provider = createOpenAICompatible({
        name: providerId,
        baseURL: "http://localhost:1234/v1",
        fetch: async (_url, init) => {
          requestBody = JSON.parse(init!.body as string);
          return new Response(
            JSON.stringify({
              id: "test",
              object: "chat.completion",
              created: 0,
              model: "gemma2",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "Hello" },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        },
      });
      await generateText({
        model: provider("gemma2"),
        prompt: "Hello",
        providerOptions: optionsFor(
          settingsFor(providerId, "gemma2", "none"),
          providerId,
          providerId,
        ),
      });
      expect(requestBody).toMatchObject({
        model: "gemma2",
        reasoning_effort: "none",
      });
    },
  );

  it("passes effort to OpenAI-compatible local and custom providers", () => {
    expect(
      optionsFor(
        settingsFor("ollama", "qwen3-coder:30b", "none"),
        "ollama",
        "ollama",
      ).ollama,
    ).toEqual({ reasoningEffort: "none" });
    expect(
      optionsFor(
        settingsFor("lmstudio", "local-model", "high"),
        "lmstudio",
        "lmstudio",
      ).lmstudio,
    ).toEqual({ reasoningEffort: "high" });
    expect(
      optionsFor(
        settingsFor("custom-provider", "custom-model", "low"),
        "custom-provider",
        "custom-provider",
      )["custom-provider"],
    ).toEqual({ reasoningEffort: "low" });
  });
});

describe("getAiHeaders", () => {
  it("forwards the Dyad request ID for fallback diagnostics", () => {
    expect(
      getAiHeaders({
        builtinProviderId: "dyad-engine",
        dyadRequestId: "request-123",
      }),
    ).toEqual({ [DYAD_INTERNAL_REQUEST_ID_HEADER]: "request-123" });
  });

  it("omits headers when there is no request ID", () => {
    expect(getAiHeaders({ builtinProviderId: "openai" })).toBeUndefined();
  });
});
