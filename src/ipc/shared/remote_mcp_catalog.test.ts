import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMcpCatalogCacheForTests,
  getRemoteMcpCatalog,
} from "./remote_mcp_catalog";

const VALID_ENTRY = {
  slug: "figma",
  name: "Figma",
  transport: "http",
  url: "https://mcp.figma.com/mcp",
  oauth: { required: true },
};

function mockCatalogResponse(servers: unknown[], extra?: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ servers, ...extra }),
    })),
  );
}

describe("remote_mcp_catalog", () => {
  beforeEach(() => {
    process.env.DYAD_MCP_CATALOG_URL = "http://localhost:9/mcp-catalog";
    clearMcpCatalogCacheForTests();
  });

  afterEach(() => {
    delete process.env.DYAD_MCP_CATALOG_URL;
    vi.unstubAllGlobals();
  });

  it("returns valid entries", async () => {
    mockCatalogResponse([VALID_ENTRY]);
    const entries = await getRemoteMcpCatalog();
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe("figma");
  });

  it("accepts a mixed-case http(s) scheme", async () => {
    mockCatalogResponse([{ ...VALID_ENTRY, url: "HTTPS://mcp.figma.com/mcp" }]);
    const entries = await getRemoteMcpCatalog();
    expect(entries).toHaveLength(1);
  });

  it("drops a malformed entry without losing the rest", async () => {
    mockCatalogResponse([
      { slug: "broken" }, // missing everything else
      VALID_ENTRY,
      { ...VALID_ENTRY, slug: "bad url", url: "not-a-url" },
    ]);
    const entries = await getRemoteMcpCatalog();
    expect(entries.map((e) => e.slug)).toEqual(["figma"]);
  });

  it("drops entries with transports this client does not support", async () => {
    // Forward compatibility: a newer catalog may serve stdio entries.
    mockCatalogResponse([
      {
        slug: "mongodb",
        name: "MongoDB",
        transport: "stdio",
        command: "npx",
        args: ["-y", "mongodb-mcp-server@1.13.0"],
      },
      { ...VALID_ENTRY, transport: "sse" },
      VALID_ENTRY,
    ]);
    const entries = await getRemoteMcpCatalog();
    expect(entries.map((e) => e.slug)).toEqual(["figma"]);
  });

  it("drops duplicate slugs, keeping the first", async () => {
    mockCatalogResponse([
      VALID_ENTRY,
      { ...VALID_ENTRY, name: "Figma Duplicate" },
    ]);
    const entries = await getRemoteMcpCatalog();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Figma");
  });

  it("returns an empty catalog when the endpoint is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const entries = await getRemoteMcpCatalog();
    expect(entries).toEqual([]);
  });

  it("returns an empty catalog on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    const entries = await getRemoteMcpCatalog();
    expect(entries).toEqual([]);
  });

  it("caches entries across calls", async () => {
    mockCatalogResponse([VALID_ENTRY]);
    await getRemoteMcpCatalog();
    await getRemoteMcpCatalog();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("drops entries whose URL is not http(s)", async () => {
    mockCatalogResponse([
      { ...VALID_ENTRY, slug: "ftp-server", url: "ftp://example.com/mcp" },
      VALID_ENTRY,
    ]);
    const entries = await getRemoteMcpCatalog();
    expect(entries.map((e) => e.slug)).toEqual(["figma"]);
  });

  it("caps a far-future server expiry to the max TTL", async () => {
    vi.useFakeTimers();
    try {
      const farFuture = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
      mockCatalogResponse([VALID_ENTRY], { expiresAt: farFuture });
      await getRemoteMcpCatalog();
      // Past the 24h cap the cache is stale and refetches, even though
      // the server asked for a year.
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);
      await getRemoteMcpCatalog();
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not pin an empty result to the server expiry", async () => {
    vi.useFakeTimers();
    try {
      const farFuture = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
      // A 200 with no servers is cached with the short failure TTL, not
      // the hour the server asked for, so a transient bad response
      // refetches within a minute.
      mockCatalogResponse([], { expiresAt: farFuture });
      await getRemoteMcpCatalog();
      vi.advanceTimersByTime(60 * 1000);
      await getRemoteMcpCatalog();
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
