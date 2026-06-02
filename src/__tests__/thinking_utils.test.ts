import { describe, expect, it } from "vitest";
import {
  getAnthropicProviderOptions,
  getExtraProviderOptionsForEngine,
  getOpenAIProviderOptions,
  getThinkingBudgetEffort,
} from "@/ipc/utils/thinking_utils";
import type { UserSettings } from "@/lib/schemas";

const baseSettings = {
  thinkingBudget: "medium",
  selectedChatMode: "build",
} as UserSettings;

describe("getThinkingBudgetEffort", () => {
  it("maps thinking budget settings to effort", () => {
    expect(getThinkingBudgetEffort("low")).toBe("low");
    expect(getThinkingBudgetEffort("medium")).toBe("medium");
    expect(getThinkingBudgetEffort("high")).toBe("high");
    expect(getThinkingBudgetEffort(undefined)).toBe("medium");
  });
});

describe("getOpenAIProviderOptions", () => {
  it("maps thinking budget to reasoning_effort for build mode", () => {
    expect(getOpenAIProviderOptions(baseSettings)).toEqual({
      reasoning_effort: "medium",
    });
  });

  it("maps thinking budget to reasoning effort for local-agent mode", () => {
    expect(
      getOpenAIProviderOptions({
        ...baseSettings,
        selectedChatMode: "local-agent",
        thinkingBudget: "high",
      }),
    ).toEqual({
      reasoning: {
        summary: "detailed",
        effort: "high",
      },
      include: ["reasoning.encrypted_content"],
      store: false,
    });
  });
});

describe("getExtraProviderOptions", () => {
  it("returns OpenAI engine body reasoning options", () => {
    expect(
      getExtraProviderOptionsForEngine("openai", {
        ...baseSettings,
        thinkingBudget: "low",
      }),
    ).toEqual({
      reasoning_effort: "low",
    });
  });

  it("returns Anthropic engine body thinking options", () => {
    expect(getExtraProviderOptionsForEngine("anthropic", baseSettings)).toEqual(
      {
        thinking: {
          type: "adaptive",
          display: "summarized",
        },
        output_config: { effort: "medium" },
      },
    );
  });

  it("maps Anthropic thinking budget settings to effort", () => {
    expect(
      getExtraProviderOptionsForEngine("anthropic", {
        ...baseSettings,
        thinkingBudget: "low",
      }),
    ).toEqual({
      thinking: {
        type: "adaptive",
        display: "summarized",
      },
      output_config: { effort: "low" },
    });

    expect(
      getExtraProviderOptionsForEngine("anthropic", {
        ...baseSettings,
        thinkingBudget: "high",
      }),
    ).toEqual({
      thinking: {
        type: "adaptive",
        display: "summarized",
      },
      output_config: { effort: "high" },
    });
  });

  it("keeps Gemini gateway thinking options unchanged", () => {
    expect(getExtraProviderOptionsForEngine("google", baseSettings)).toEqual({
      thinking: {
        type: "enabled",
        include_thoughts: true,
        budget_tokens: 4_000,
      },
    });
  });
});

describe("getAnthropicProviderOptions", () => {
  it("returns AI SDK Anthropic provider options", () => {
    expect(getAnthropicProviderOptions(baseSettings)).toEqual({
      thinking: {
        type: "adaptive",
        display: "summarized",
      },
      effort: "medium",
      sendReasoning: true,
    });
  });
});
