import { describe, expect, it } from "vitest";
import { claudeArguments, claudeEnvironment } from "./runtime";
import {
  assistantAttribution,
  executionBackendForModel,
} from "@/shared/execution_backend";

describe("Claude Code execution policy", () => {
  it("uses explicit session IDs, real tool restrictions and no fallback", () => {
    const args = claudeArguments({
      cwd: "/app",
      prompt: "untrusted prompt",
      model: "sonnet",
      sessionId: "session",
      resume: true,
      readOnly: true,
      mcpConfigPath: "/private-config",
    });
    expect(args).toContain("--restricted");
    expect(args[args.indexOf("--resume") + 1]).toBe("session");
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep");
    expect(args).not.toContain("--continue");
    expect(args).not.toContain("--fallback-model");
    expect(args).not.toContain("untrusted prompt");
    expect(args).not.toContain("--bare");
  });
  it("does not inherit API authentication, CLI hooks or arbitrary environment", () => {
    expect(
      claudeEnvironment({
        HOME: "/home",
        PATH: "/bin",
        ANTHROPIC_API_KEY: "unused",
        CLAUDE_CODE_OAUTH_TOKEN: "unused",
        ANTHROPIC_BASE_URL: "unused",
        NODE_OPTIONS: "unused",
      }),
    ).toEqual({ HOME: "/home", PATH: "/bin" });
  });
  it("keeps persisted model attribution independent of current selection", () => {
    expect(assistantAttribution("claude-code", "resolved-model")).toBe(
      "Claude Code (resolved-model)",
    );
    expect(assistantAttribution("claude-code", null)).toBe(
      "Claude Code (model unavailable)",
    );
    expect(assistantAttribution("dyad", "existing-model")).toBe(
      "existing-model",
    );
    expect(executionBackendForModel({ provider: "anthropic" })).toBe("dyad");
    expect(executionBackendForModel({ provider: "claude-code" })).toBe(
      "claude-code",
    );
  });
});
