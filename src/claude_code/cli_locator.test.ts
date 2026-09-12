import { describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({}),
}));
vi.mock("fix-path", () => ({ default: () => {} }));

import {
  buildClaudeCliEnvironment,
  compareVersions,
  isSupportedClaudeCodeVersion,
  MIN_SUPPORTED_CLAUDE_CODE_VERSION,
  parseAuthStatusOutput,
  parseCliVersion,
} from "./cli_locator";

describe("cli_locator", () => {
  it("parses the CLI version banner", () => {
    expect(parseCliVersion("2.1.260 (Claude Code)\n")).toBe("2.1.260");
    expect(parseCliVersion("garbage")).toBeNull();
  });

  it("compares semantic versions numerically", () => {
    expect(compareVersions("2.1.260", "2.1.9")).toBe(1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("1.9.9", MIN_SUPPORTED_CLAUDE_CODE_VERSION)).toBe(
      -1,
    );
    expect(isSupportedClaudeCodeVersion("1.0.130")).toBe(false);
    expect(isSupportedClaudeCodeVersion("2.1.260")).toBe(true);
    expect(isSupportedClaudeCodeVersion(null)).toBe(false);
  });

  it("parses `claude auth status` JSON", () => {
    expect(
      parseAuthStatusOutput(
        JSON.stringify({
          loggedIn: true,
          authMethod: "claude.ai",
          subscriptionType: "max",
          email: "user@example.com",
        }),
      ),
    ).toEqual({
      state: "authenticated",
      method: "claude.ai",
      subscriptionType: "max",
      email: "user@example.com",
      detail: null,
    });
    expect(
      parseAuthStatusOutput(JSON.stringify({ loggedIn: false })),
    ).toMatchObject({
      state: "unauthenticated",
      detail: expect.stringContaining("/login"),
    });
    expect(parseAuthStatusOutput("not json")).toMatchObject({
      state: "unknown",
    });
  });

  it("strips API-key and provider credentials so the CLI can only use the subscription", () => {
    const env = buildClaudeCliEnvironment({
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-ant-secret",
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_BASE_URL: "https://proxy",
      CLAUDE_CODE_USE_BEDROCK: "1",
      ANTHROPIC_FEDERATION_RULE_ID: "rule",
      HOME: "/home/user",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/user");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(env.ANTHROPIC_FEDERATION_RULE_ID).toBeUndefined();
    expect(env.DISABLE_AUTOUPDATER).toBe("1");
  });
});
