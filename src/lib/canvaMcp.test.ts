import { describe, expect, it } from "vitest";

import { CANVA_MCP_SERVER_URL, isCanvaMcpServerUrl } from "./canvaMcp";

describe("Canva MCP", () => {
  it("recognizes only the official Canva MCP endpoint", () => {
    expect(isCanvaMcpServerUrl(CANVA_MCP_SERVER_URL)).toBe(true);
    expect(isCanvaMcpServerUrl("https://mcp.canva.com/mcp/")).toBe(true);
    expect(isCanvaMcpServerUrl("https://mcp.canva.com/other")).toBe(false);
    expect(isCanvaMcpServerUrl("https://example.com/mcp")).toBe(false);
  });
});
