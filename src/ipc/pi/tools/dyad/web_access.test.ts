import { describe, expect, it, vi } from "vitest";

import {
  assertPublicHttpUrl,
  searchWeb,
  type WebSearchConfig,
  webSearchTool,
} from "./web_access";

describe("web access", () => {
  it.each([
    "http://127.0.0.1:3000/private",
    "http://localhost/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.4/internal",
    "http://[::7f00:1]/internal",
    "http://[::ffff:7f00:1]/internal",
    "http://[64:ff9b::7f00:1]/internal",
    "http://[fec0::1]/internal",
    "https://user:password@example.com/private",
    "file:///etc/passwd",
  ])("rejects non-public URL %s", async (url) => {
    await expect(assertPublicHttpUrl(url)).rejects.toThrow();
  });

  it("uses Exa first when auto mode has both keys", async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Pi docs",
                url: "https://example.com/pi",
                text: "Current documentation",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const config: WebSearchConfig = {
      provider: "auto",
      exaApiKey: "exa-key",
      braveApiKey: "brave-key",
    };

    const result = await searchWeb(
      { queries: ["pi agent docs"], numResults: 3 },
      config,
      { fetchFn },
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://api.exa.ai/search");
    expect(result.provider).toBe("exa");
    expect(result.text).toContain("https://example.com/pi");
  });

  it("requires a configured key", async () => {
    await expect(
      searchWeb(
        { query: "latest docs" },
        { provider: "auto" },
        { fetchFn: vi.fn() },
      ),
    ).rejects.toThrow("API key");
  });

  it("only enables search for the configured provider", () => {
    const isEnabled = webSearchTool.isEnabled!;

    expect(
      isEnabled({
        webAccessEnabled: true,
        webSearchConfig: { provider: "exa", braveApiKey: "brave-key" },
      } as any),
    ).toBe(false);
    expect(
      isEnabled({
        webAccessEnabled: true,
        webSearchConfig: { provider: "brave", braveApiKey: "brave-key" },
      } as any),
    ).toBe(true);
    expect(
      webSearchTool.inputSchema.parse({
        query: "Dyad docs",
        provider: "brave",
      }),
    ).toEqual({ query: "Dyad docs" });
  });
});
