import { describe, expect, it } from "vitest";

import {
  getEnabledLovableMcpServerIds,
  isLovableMcpServerUrl,
  LOVABLE_MCP_OAUTH_SUPPORTED,
  LOVABLE_MCP_SERVER_URL,
  LOVABLE_OAUTH_PUBLIC_CLIENT_ID,
} from "./lovableMcp";
import {
  LOVABLE_WEB_DEV_AGENT,
  LOVABLE_WEB_DEV_AGENT_ID,
} from "./lovable_web_dev";

describe("Lovable Web Dev agent", () => {
  it("is a stable built-in MCP agent", () => {
    expect(LOVABLE_MCP_OAUTH_SUPPORTED).toBe(true);
    expect(LOVABLE_WEB_DEV_AGENT).toMatchObject({
      id: LOVABLE_WEB_DEV_AGENT_ID,
      name: "Web Dev",
      type: "MCP",
      endpoint: LOVABLE_MCP_SERVER_URL,
      enabled: true,
    });
    expect(LOVABLE_MCP_SERVER_URL).toBe("https://mcp.lovable.dev");
    expect(LOVABLE_OAUTH_PUBLIC_CLIENT_ID).toBe(
      "6d465f583e1e4ce5801b1616f735670c",
    );
  });

  it("matches only the official Lovable MCP endpoint", () => {
    expect(isLovableMcpServerUrl("https://mcp.lovable.dev")).toBe(true);
    expect(isLovableMcpServerUrl("https://mcp.lovable.dev/")).toBe(true);
    // Keep recognizing the previous endpoint so existing saved servers migrate.
    expect(isLovableMcpServerUrl("https://mcp.lovable.dev/mcp")).toBe(true);
    expect(isLovableMcpServerUrl("https://mcp.lovable.dev/mcp/")).toBe(true);
    expect(isLovableMcpServerUrl("https://example.com/mcp.lovable.dev")).toBe(
      false,
    );
    expect(isLovableMcpServerUrl("not a url")).toBe(false);
  });

  it("isolates Web Dev to enabled Lovable servers", () => {
    expect(
      getEnabledLovableMcpServerIds([
        { id: 1, url: "https://mcp.lovable.dev", enabled: true },
        { id: 2, url: "https://other.example/mcp", enabled: true },
        { id: 3, url: "https://mcp.lovable.dev/mcp/", enabled: false },
      ]),
    ).toEqual([1]);
  });
});
