import { describe, expect, it } from "vitest";
import {
  formatAssistantModelAttribution,
  getBackendForModel,
  resolveChatExecutionBackend,
  wouldChangeChatBackend,
} from "./chat_backend";

describe("chat_backend", () => {
  it("maps the claude-code provider to the subscription backend", () => {
    expect(getBackendForModel({ provider: "claude-code" })).toBe("claude-code");
    expect(getBackendForModel({ provider: "auto" })).toBe("dyad");
    expect(getBackendForModel({ provider: "ollama" })).toBe("dyad");
    expect(getBackendForModel(null)).toBe("dyad");
  });

  it("prefers the persisted chat backend over the model selection", () => {
    expect(
      resolveChatExecutionBackend({
        executionBackend: "dyad",
        modelSelection: { provider: "claude-code" },
      }),
    ).toBe("dyad");
    expect(
      resolveChatExecutionBackend({
        executionBackend: null,
        modelSelection: { provider: "claude-code" },
      }),
    ).toBe("claude-code");
    expect(resolveChatExecutionBackend({ modelSelection: null })).toBeNull();
  });

  it("only requires a new chat when the backend changes", () => {
    const dyadChat = {
      executionBackend: "dyad" as const,
      modelSelection: { provider: "openai" },
    };
    expect(wouldChangeChatBackend(dyadChat, { provider: "anthropic" })).toBe(
      false,
    );
    expect(wouldChangeChatBackend(dyadChat, { provider: "claude-code" })).toBe(
      true,
    );
    const claudeChat = { executionBackend: "claude-code" as const };
    expect(
      wouldChangeChatBackend(claudeChat, { provider: "claude-code" }),
    ).toBe(false);
    expect(wouldChangeChatBackend(claudeChat, { provider: "auto" })).toBe(true);
    expect(wouldChangeChatBackend({}, { provider: "claude-code" })).toBe(false);
  });

  it("formats subscription attribution from the persisted resolved model", () => {
    expect(
      formatAssistantModelAttribution({
        executionBackend: "claude-code",
        model: "claude-opus-4-8",
      }),
    ).toBe("Claude Code (claude-opus-4-8)");
    expect(
      formatAssistantModelAttribution({
        executionBackend: "claude-code",
        model: null,
      }),
    ).toBe("Claude Code (model not reported)");
    expect(
      formatAssistantModelAttribution({
        executionBackend: "claude-code",
        model: "   ",
      }),
    ).toBe("Claude Code (model not reported)");
  });

  it("keeps plain attribution for Dyad-backed messages", () => {
    expect(
      formatAssistantModelAttribution({
        executionBackend: "dyad",
        model: "gpt-5",
      }),
    ).toBe("gpt-5");
    expect(formatAssistantModelAttribution({ model: "auto" })).toBe("auto");
    expect(formatAssistantModelAttribution({ model: null })).toBeNull();
  });
});
