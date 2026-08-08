import { describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ debug: vi.fn(), error: vi.fn() }),
  },
}));

import { createLovableMcpFetch } from "./lovable_mcp_transport";

describe("createLovableMcpFetch", () => {
  it("requests both MCP response formats and leaves SSE parsing to the transport", async () => {
    const response = new Response(
      'data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n',
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Mcp-Session-Id": "session-123",
        },
      },
    );
    const fetchFn = vi.fn<typeof fetch>(async () => response);
    const mcpFetch = createLovableMcpFetch(fetchFn);

    const received = await mcpFetch("https://mcp.lovable.dev", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: "{}",
    });

    const request = fetchFn.mock.calls[0]!;
    const headers = new Headers(request[1]?.headers);
    expect(headers.get("Accept")).toBe("application/json, text/event-stream");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer token");
    expect(received).toBe(response);
    expect(await received.text()).toContain("data:");
  });

  it("preserves OAuth token exchange form headers and body", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("Content-Type")).toBe(
        "application/x-www-form-urlencoded",
      );
      expect(init?.body).toBe(
        "grant_type=authorization_code&code=lovable-code",
      );
      return new Response(
        JSON.stringify({
          access_token: "token",
          token_type: "Bearer",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    const lovableFetch = createLovableMcpFetch(fetchFn);

    await lovableFetch("https://auth.lovable.dev/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=authorization_code&code=lovable-code",
    });

    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
