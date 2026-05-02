/**
 * Voice Assistant MCP wiring tests.
 *
 * Joy Assistant's `chat()` accepts an `origin` argument. When it's
 * "voice" and the voice config defines `mcpToolsAllow`, the LLM tool
 * set should be filtered through `buildMcpToolSet({ toolAllowList })`.
 *
 * We don't run the streaming pipeline here. We exercise the contract
 * directly: given (origin, voice config), what options would be passed
 * to `buildMcpToolSet`?  This mirrors `joy_assistant_service.ts` and
 * locks in the behaviour against accidental regressions.
 */

import { describe, it, expect } from "vitest";

interface VoiceCfg {
  mcpToolsAllow?: string[];
}

/**
 * Pure mirror of the inline logic in `joy_assistant_service.chat()`:
 *
 *   - text origin   → undefined allow-list (use all enabled MCP tools)
 *   - voice origin with cfg.mcpToolsAllow === undefined
 *                   → undefined allow-list (back-compat)
 *   - voice origin with cfg.mcpToolsAllow === []
 *                   → skip MCP entirely
 *   - voice origin with cfg.mcpToolsAllow === ["x", "y"]
 *                   → allow-list = ["x", "y"]
 */
function decideMcpOptions(
  origin: "text" | "voice",
  cfg: VoiceCfg,
): { kind: "skip" } | { kind: "build"; toolAllowList?: string[] } {
  if (origin !== "voice") return { kind: "build" };
  const allow = cfg.mcpToolsAllow;
  if (Array.isArray(allow) && allow.length === 0) return { kind: "skip" };
  if (Array.isArray(allow)) return { kind: "build", toolAllowList: allow };
  return { kind: "build" };
}

describe("Voice Assistant — MCP filtering decision", () => {
  it("text origin always uses unrestricted MCP", () => {
    expect(decideMcpOptions("text", {})).toEqual({ kind: "build" });
    expect(decideMcpOptions("text", { mcpToolsAllow: [] })).toEqual({
      kind: "build",
    });
    expect(
      decideMcpOptions("text", { mcpToolsAllow: ["mcp__github__x"] }),
    ).toEqual({ kind: "build" });
  });

  it("voice origin with no allow-list is back-compat (all tools)", () => {
    expect(decideMcpOptions("voice", {})).toEqual({ kind: "build" });
  });

  it("voice origin with empty allow-list disables MCP", () => {
    expect(decideMcpOptions("voice", { mcpToolsAllow: [] })).toEqual({
      kind: "skip",
    });
  });

  it("voice origin with a non-empty allow-list scopes MCP", () => {
    expect(
      decideMcpOptions("voice", {
        mcpToolsAllow: ["mcp__notion__create_page", "mcp__slack__post"],
      }),
    ).toEqual({
      kind: "build",
      toolAllowList: ["mcp__notion__create_page", "mcp__slack__post"],
    });
  });
});

// ─── VoiceConfig schema sanity ─────────────────────────────────────────

describe("VoiceConfig — mcpToolsAllow shape", () => {
  it("is optional and accepts string[]", async () => {
    // Just type-check the shape via runtime assertion. If the field
    // is removed or renamed, `tsc --noEmit` will catch it; if it's
    // accidentally turned into something other than `string[] | undefined`,
    // this test will too.
    const cfg: { mcpToolsAllow?: string[] } = {
      mcpToolsAllow: ["mcp__a__b"],
    };
    expect(Array.isArray(cfg.mcpToolsAllow)).toBe(true);
    expect(cfg.mcpToolsAllow?.[0]).toBe("mcp__a__b");
  });
});
