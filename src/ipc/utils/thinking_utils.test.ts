import { describe, expect, it } from "vitest";
import {
  getAnthropicProviderOptions,
  getExtraProviderOptionsForEngine,
  getModelEffort,
  getOpenAIProviderOptions,
} from "@/ipc/utils/thinking_utils";
import type { ModelSelection, UserSettings } from "@/lib/schemas";

const baseSettings = {
  selectedModel: { provider: "openai", name: "test-model" },
  selectedChatMode: "build",
} as unknown as UserSettings;
const selection = (effortLevel: string): ModelSelection => ({
  provider: "openai",
  name: "test-model",
  effortLevel,
});

describe("getModelEffort", () => {
  it("requires and returns the resolved model selection effort", () => {
    expect(getModelEffort(selection("medium"))).toBe("medium");
  });
});

describe("getOpenAIProviderOptions", () => {
  it("maps effort to reasoning_effort for build mode", () => {
    expect(getOpenAIProviderOptions(baseSettings, selection("medium"))).toEqual(
      { reasoning_effort: "medium" },
    );
  });

  it("maps effort to reasoning options for local-agent mode", () => {
    expect(
      getOpenAIProviderOptions(
        { ...baseSettings, selectedChatMode: "local-agent" },
        selection("high"),
      ),
    ).toEqual({
      reasoning: { summary: "detailed", effort: "high" },
      include: ["reasoning.encrypted_content"],
      store: false,
    });
  });
});

describe("getExtraProviderOptions", () => {
  it("returns OpenAI engine body reasoning options", () => {
    expect(
      getExtraProviderOptionsForEngine(
        "openai",
        baseSettings,
        selection("low"),
      ),
    ).toEqual({ reasoning_effort: "low" });
  });

  it("returns Anthropic engine body thinking options", () => {
    expect(
      getExtraProviderOptionsForEngine(
        "anthropic",
        baseSettings,
        selection("medium"),
      ),
    ).toEqual({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
    });
  });

  it.each([
    ["low", 1_000],
    ["medium", 4_000],
    ["high", -1],
    ["minimal", 0],
  ])("maps Gemini %s effort to gateway budget %s", (effort, budget) => {
    expect(
      getExtraProviderOptionsForEngine(
        "google",
        baseSettings,
        selection(effort),
      ),
    ).toEqual({
      thinking: {
        type: "enabled",
        include_thoughts: true,
        budget_tokens: budget,
      },
    });
  });
});

describe("getAnthropicProviderOptions", () => {
  it("returns AI SDK Anthropic provider options", () => {
    expect(getAnthropicProviderOptions(selection("medium"))).toEqual({
      thinking: { type: "adaptive", display: "summarized" },
      effort: "medium",
      sendReasoning: true,
    });
  });
});
