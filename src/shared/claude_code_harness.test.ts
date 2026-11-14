import { describe, expect, it } from "vitest";
import {
  resolveClaudeCodeHarness,
  wantsClaudeSessionContinuity,
} from "./claude_code_harness";

const on = {
  enableClaudeCodeSubscription: true,
  enableClaudeCodeNativeTools: true,
};
const decide = (
  overrides: Partial<Parameters<typeof resolveClaudeCodeHarness>[0]> = {},
) =>
  resolveClaudeCodeHarness({
    settings: on,
    provider: "claude-code",
    agentMode: true,
    runtimeMode: "host",
    ...overrides,
  });

describe("resolveClaudeCodeHarness", () => {
  it("uses native tools for Claude Code Agent turns on the host", () => {
    expect(decide()).toEqual({ harness: "native" });
  });

  it("keeps Dyad's tools for other modes, models or when opted out", () => {
    expect(decide({ agentMode: false })).toEqual({ harness: "dyad-tools" });
    expect(decide({ provider: "anthropic" })).toEqual({
      harness: "dyad-tools",
    });
    expect(
      decide({ settings: { ...on, enableClaudeCodeNativeTools: false } }),
    ).toEqual({ harness: "dyad-tools" });
    // A remembered opt-in is inert while the parent experiment is off.
    expect(
      decide({ settings: { ...on, enableClaudeCodeSubscription: false } }),
    ).toEqual({ harness: "dyad-tools" });
  });

  it("explains the fallback for apps that do not run on this computer", () => {
    expect(decide({ runtimeMode: "docker" })).toEqual({
      harness: "dyad-tools",
      fallbackReason: "runtime",
    });
    expect(decide({ runtimeMode: "cloud" })).toEqual({
      harness: "dyad-tools",
      fallbackReason: "runtime",
    });
  });
});

describe("wantsClaudeSessionContinuity", () => {
  it("follows the native tools opt-in", () => {
    expect(wantsClaudeSessionContinuity(on)).toBe(true);
    expect(
      wantsClaudeSessionContinuity({
        ...on,
        enableClaudeCodeNativeTools: false,
      }),
    ).toBe(false);
  });
});
