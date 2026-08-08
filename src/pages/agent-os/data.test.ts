import { describe, expect, it } from "vitest";

import { usesMainChatStyle } from "./data";

describe("usesMainChatStyle", () => {
  it("matches Hermes and OpenClaw by type", () => {
    expect(usesMainChatStyle({ type: "Hermes", name: "Anything" })).toBe(true);
    expect(usesMainChatStyle({ type: "OpenClaw", name: "Anything" })).toBe(
      true,
    );
  });

  it("matches by name regardless of type (case-insensitive)", () => {
    expect(usesMainChatStyle({ type: "Custom", name: "Hermes Phantom" })).toBe(
      true,
    );
    expect(usesMainChatStyle({ type: "MCP", name: "openclaw scout" })).toBe(
      true,
    );
  });

  it("keeps the bubble style for unrelated agents", () => {
    expect(usesMainChatStyle({ type: "Custom", name: "Nano Banana" })).toBe(
      false,
    );
    expect(usesMainChatStyle({ type: "MCP", name: "Postgres Tools" })).toBe(
      false,
    );
  });
});
