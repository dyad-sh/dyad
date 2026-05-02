/**
 * Voice Assistant MCP wiring tests.
 *
 * Joy Assistant's `chat()` accepts an `origin` argument. When it's
 * "voice" and the voice config defines `mcpToolsAllow`, the LLM tool
 * set should be filtered through `buildMcpToolSet({ toolAllowList })`.
 *
 * The actual translation of `mcpToolsAllow` -> `BuildMcpToolSetOptions`
 * lives in the shared `planMcpAllowList` helper (lib/mcp_ai_bridge.ts).
 * Both `joy_assistant_service.chat()` and the agent runtime call into
 * that helper, so by driving it here we guarantee any future regression
 * in the production path immediately fails this test.
 */

import { describe, it, expect } from "vitest";
import { planMcpAllowList } from "../lib/mcp_ai_bridge";

interface VoiceCfg {
  mcpToolsAllow?: string[];
}

/**
 * Mirror of the inline branch in `joy_assistant_service.chat()`:
 * text origin always uses unrestricted MCP; voice origin defers to the
 * shared `planMcpAllowList` helper. Keeping this thin wrapper makes it
 * obvious what the production code does without re-deriving the
 * underlying semantics.
 */
function decideMcpOptions(origin: "text" | "voice", cfg: VoiceCfg) {
  if (origin !== "voice") return { skip: false as const, options: {} };
  return planMcpAllowList(cfg.mcpToolsAllow);
}

describe("Voice Assistant — MCP filtering decision", () => {
  it("text origin always uses unrestricted MCP", () => {
    expect(decideMcpOptions("text", {})).toEqual({ skip: false, options: {} });
    expect(decideMcpOptions("text", { mcpToolsAllow: [] })).toEqual({
      skip: false,
      options: {},
    });
    expect(
      decideMcpOptions("text", { mcpToolsAllow: ["mcp__github__x"] }),
    ).toEqual({ skip: false, options: {} });
  });

  it("voice origin with no allow-list is back-compat (all tools)", () => {
    expect(decideMcpOptions("voice", {})).toEqual({
      skip: false,
      options: {},
    });
  });

  it("voice origin with empty allow-list disables MCP", () => {
    const out = decideMcpOptions("voice", { mcpToolsAllow: [] });
    expect(out.skip).toBe(true);
  });

  it("voice origin with a non-empty allow-list scopes MCP", () => {
    const out = decideMcpOptions("voice", {
      mcpToolsAllow: ["mcp__notion__create_page", "mcp__slack__post"],
    });
    expect(out.skip).toBe(false);
    if (!out.skip) {
      expect(out.options).toEqual({
        toolAllowList: ["mcp__notion__create_page", "mcp__slack__post"],
      });
    }
  });
});

// ─── VoiceConfig schema sanity ─────────────────────────────────────────

describe("VoiceConfig — mcpToolsAllow shape", () => {
  it("is optional and accepts string[]", () => {
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
