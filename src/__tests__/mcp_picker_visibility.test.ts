import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The toggle in MCP settings has one job: decide whether a server appears in
 * the chat toolbar's tools menu.
 *
 * It used to decide only whether that menu drew an "Enabled" or "Disabled"
 * badge next to a server it listed either way, which made the setting look
 * like a switch and behave like a label. These assertions are structural
 * because the picker needs a live MCP server to render, but they catch the
 * specific regression: going back to mapping over every configured server.
 */

const picker = fs.readFileSync(
  path.join(process.cwd(), "src", "components", "McpToolsPicker.tsx"),
  "utf8",
);

describe("MCP tools picker", () => {
  it("lists only servers that are switched on", () => {
    expect(picker).toContain("servers.filter((server) => server.enabled)");
    expect(picker).toContain("availableServers.map(");
  });

  it("never maps over the unfiltered server list", () => {
    // The regression is one character of difference at the call site.
    expect(picker).not.toMatch(/\{\s*servers\.map\(/);
  });

  it("says something different when servers exist but none are on", () => {
    // Otherwise "no servers configured" is shown to someone who configured
    // several and switched them off, sending them to add another.
    expect(picker).toContain("servers.length === 0");
    expect(picker).toContain("switched on");
  });
});
