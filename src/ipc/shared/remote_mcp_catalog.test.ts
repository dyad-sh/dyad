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
  oauth: "required",
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
});
