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

const VALID_STDIO_ENTRY = {
  slug: "mongodb",
  name: "MongoDB",
  transport: "stdio",
  command: "npx",
  args: ["-y", "mongodb-mcp-server@1.13.0"],
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
    // Forward compatibility: a newer catalog may serve entry kinds this
    // client doesn't know about yet.
    mockCatalogResponse([{ ...VALID_ENTRY, transport: "sse" }, VALID_ENTRY]);
    const entries = await getRemoteMcpCatalog();
    expect(entries.map((e) => e.slug)).toEqual(["figma"]);
  });

  it("keeps entries that declare setup inputs and carries them through", async () => {
    mockCatalogResponse([
      {
        ...VALID_ENTRY,
        slug: "asana",
        inputs: [{ kind: "oauthClientId" }, { kind: "oauthClientSecret" }],
      },
      {
        ...VALID_ENTRY,
        slug: "render",
        oauth: undefined,
        inputs: [
          {
            kind: "header",
            name: "Authorization",
            prefix: "Bearer ",
            label: "API key",
          },
        ],
      },
    ]);
    const entries = await getRemoteMcpCatalog();
    expect(entries.map((e) => e.slug)).toEqual(["asana", "render"]);
    const asana = entries[0];
    if (asana.transport === "http") {
      expect(asana.inputs).toEqual([
        { kind: "oauthClientId" },
        { kind: "oauthClientSecret" },
      ]);
    }
  });

  it("drops an entry whose input kind this client doesn't know", async () => {
    // A whole entry drops if any input kind is unrecognized, so a newer
    // field type can't cause a half-configured add on this client.
    mockCatalogResponse([
      { ...VALID_ENTRY, slug: "future", inputs: [{ kind: "instanceUrl" }] },
      VALID_ENTRY,
    ]);
    const entries = await getRemoteMcpCatalog();
    expect(entries.map((e) => e.slug)).toEqual(["figma"]);
  });

  it("keeps stdio entries alongside http ones", async () => {
    mockCatalogResponse([
      VALID_STDIO_ENTRY,
      VALID_ENTRY,
      {
        ...VALID_STDIO_ENTRY,
        slug: "mongodb-env",
        env: { MDB_MCP_READ_ONLY: "true" },
      },
    ]);
    const entries = await getRemoteMcpCatalog();
    expect(entries.map((e) => e.slug)).toEqual([
      "mongodb",
      "figma",
      "mongodb-env",
    ]);
    const withEnv = entries[2];
    expect(withEnv.transport).toBe("stdio");
    if (withEnv.transport === "stdio") {
      expect(withEnv.env).toEqual({ MDB_MCP_READ_ONLY: "true" });
    }
  });

  it("drops stdio entries with a non-npx command or no args", async () => {
    mockCatalogResponse([
      { ...VALID_STDIO_ENTRY, command: "node" },
      { ...VALID_STDIO_ENTRY, slug: "bash-server", command: "bash" },
      { ...VALID_STDIO_ENTRY, slug: "no-args", args: [] },
      VALID_ENTRY,
    ]);
    const entries = await getRemoteMcpCatalog();
    expect(entries.map((e) => e.slug)).toEqual(["figma"]);
  });

  it("keeps unpinned stdio entries (pinning is enforced upstream)", async () => {
    // The desktop only checks the shape; cloud CI pins the catalog data
    // and the consent prompt shows the exact command.
    mockCatalogResponse([
      { ...VALID_STDIO_ENTRY, args: ["-y", "mongodb-mcp-server@latest"] },
      {
        ...VALID_STDIO_ENTRY,
        slug: "eq-package",
        args: ["-y", "--package=other@latest", "mongodb-mcp-server@1.13.0"],
      },
    ]);
    const entries = await getRemoteMcpCatalog();
    expect(entries.map((e) => e.slug)).toEqual(["mongodb", "eq-package"]);
  });

  it("accepts scoped and prerelease pinned packages", async () => {
    mockCatalogResponse([
      {
        ...VALID_STDIO_ENTRY,
        slug: "scoped",
        args: ["-y", "@azure/mcp@0.9.3"],
      },
      {
        ...VALID_STDIO_ENTRY,
        slug: "prerelease",
        args: ["-y", "snyk-mcp@2.0.0-beta.1"],
      },
    ]);
    const entries = await getRemoteMcpCatalog();
    expect(entries.map((e) => e.slug)).toEqual(["scoped", "prerelease"]);
  });

  it("accepts npx flags and server-CLI args around the spec", async () => {
    // Real catalog shapes: leading npx flags and trailing subcommands.
    mockCatalogResponse([
      {
        ...VALID_STDIO_ENTRY,
        slug: "azure",
        args: ["-y", "@azure/mcp@3.0.0-beta.23", "server", "start"],
      },
      {
        ...VALID_STDIO_ENTRY,
        slug: "snyk",
        args: ["-y", "snyk@1.1305.2", "mcp", "-t", "stdio"],
      },
      {
        ...VALID_STDIO_ENTRY,
        slug: "meta-quest",
        args: ["-y", "--ignore-scripts", "@meta-quest/metavr@1.3.2", "mcp"],
      },
    ]);
    const entries = await getRemoteMcpCatalog();
    expect(entries.map((e) => e.slug)).toEqual(["azure", "snyk", "meta-quest"]);
  });

  it("passes through stdio env vars", async () => {
    mockCatalogResponse([
      {
        ...VALID_STDIO_ENTRY,
        env: { MDB_MCP_READ_ONLY: "true", LOG_LEVEL: "debug" },
      },
    ]);
    const entries = await getRemoteMcpCatalog();
    const entry = entries[0];
    expect(entry.transport).toBe("stdio");
    if (entry.transport === "stdio") {
      expect(entry.env).toEqual({
        MDB_MCP_READ_ONLY: "true",
        LOG_LEVEL: "debug",
      });
    }
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
