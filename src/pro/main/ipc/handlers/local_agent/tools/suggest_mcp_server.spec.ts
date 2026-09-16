import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";

const mocks = vi.hoisted(() => ({
  request: vi.fn(() => "request-id"),
  park: vi.fn(),
  catalog: vi.fn(async (): Promise<unknown[]> => []),
  addedSlugs: [] as string[],
}));

vi.mock("@/user_input/main", () => ({
  userInputRegistry: {
    request: mocks.request,
    park: mocks.park,
  },
}));

vi.mock("@/ipc/shared/remote_mcp_catalog", () => ({
  getRemoteMcpCatalog: mocks.catalog,
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () =>
          mocks.addedSlugs.map((catalogSlug) => ({ catalogSlug })),
      }),
    }),
  },
}));

vi.mock("@/db/schema", () => ({
  mcpServers: { catalogSlug: "catalog_slug" },
}));

vi.mock("drizzle-orm", () => ({
  isNotNull: vi.fn(),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

import {
  collectSuggestableMcpServers,
  suggestMcpServerTool,
} from "./suggest_mcp_server";

const VERCEL = {
  slug: "vercel",
  name: "Vercel",
  description: "Deployments, logs and projects on Vercel.",
};

describe("collectSuggestableMcpServers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addedSlugs = [];
  });

  it("keeps only featured one-click http entries the user has not added", async () => {
    mocks.addedSlugs = ["stripe"];
    mocks.catalog.mockResolvedValue([
      {
        ...VERCEL,
        transport: "http",
        url: "https://mcp.vercel.com",
        featured: true,
        oauth: { required: true },
      },
      {
        slug: "stripe",
        name: "Stripe",
        transport: "http",
        url: "https://mcp.stripe.com",
        featured: true,
      },
      {
        slug: "linear",
        name: "Linear",
        transport: "http",
        url: "https://mcp.linear.app/mcp",
      },
      {
        slug: "sonatype",
        name: "Sonatype",
        transport: "http",
        url: "https://mcp.sonatype.com",
        featured: true,
        inputs: [{ kind: "header", name: "Authorization", label: "Token" }],
      },
      {
        slug: "mongodb",
        name: "MongoDB",
        transport: "stdio",
        command: "npx",
        args: ["-y", "mongodb-mcp-server@1.0.0"],
        featured: true,
      },
    ]);

    await expect(collectSuggestableMcpServers()).resolves.toEqual([VERCEL]);
  });

  it("returns nothing when the catalog is unavailable", async () => {
    mocks.catalog.mockResolvedValue([]);
    await expect(collectSuggestableMcpServers()).resolves.toEqual([]);
  });
});

describe("suggestMcpServerTool", () => {
  let onXmlComplete: ReturnType<typeof vi.fn>;

  const context = (overrides: Partial<AgentContext> = {}) =>
    ({
      chatId: 7,
      onXmlComplete,
      suggestableMcpServers: [VERCEL],
      ...overrides,
    }) as unknown as AgentContext;

  beforeEach(() => {
    vi.clearAllMocks();
    onXmlComplete = vi.fn();
  });

  it("is hidden until a suggestable plugin exists", () => {
    expect(
      suggestMcpServerTool.isEnabled?.(context({ suggestableMcpServers: [] })),
    ).toBe(false);
    expect(suggestMcpServerTool.isEnabled?.(context())).toBe(true);
  });

  it("lists the suggestable plugins in its description", () => {
    const description = suggestMcpServerTool.getDescription?.(context());
    expect(description).toContain(
      "- vercel: Vercel — Deployments, logs and projects on Vercel.",
    );
    expect(
      suggestMcpServerTool.getDescription?.(
        context({ suggestableMcpServers: [] }),
      ),
    ).not.toContain("Plugins available");
  });

  it("persists the pending card before execute parks", () => {
    expect(suggestMcpServerTool.buildXml?.({ slug: "vercel" }, false)).toBe(
      '<dyad-suggest-mcp-server slug="vercel" outcome="pending"></dyad-suggest-mcp-server>',
    );
    expect(
      suggestMcpServerTool.buildXml?.(
        { slug: "vercel", reason: 'Read the "failed" build logs' },
        true,
      ),
    ).toBe(
      '<dyad-suggest-mcp-server slug="vercel" reason="Read the &quot;failed&quot; build logs" outcome="pending"></dyad-suggest-mcp-server>',
    );
    expect(suggestMcpServerTool.buildXml?.({}, false)).toBeUndefined();
  });

  it("requests a follow-up-capable suggestion and reports a connection", async () => {
    mocks.park.mockResolvedValue({
      kind: "mcp-suggestion",
      outcome: "connected",
    });

    const result = await suggestMcpServerTool.execute(
      { slug: "vercel", reason: "Read the build logs for the failed deploy." },
      context(),
    );

    expect(mocks.request).toHaveBeenCalledWith({
      kind: "mcp-suggestion",
      chatId: 7,
      slug: "vercel",
      serverName: "Vercel",
      serverDescription: VERCEL.description,
      reason: "Read the build logs for the failed deploy.",
      classifier: "none",
      followUpPrompt:
        "Continue. I have connected the Vercel plugin. Resume what you needed it for: Read the build logs for the failed deploy.",
    });
    expect(result).toContain("queued a follow-up turn");
    expect(onXmlComplete).toHaveBeenCalledWith(
      '<dyad-suggest-mcp-server slug="vercel" name="Vercel" reason="Read the build logs for the failed deploy." outcome="connected"></dyad-suggest-mcp-server>',
    );
  });

  it("tells the agent to continue without a declined plugin", async () => {
    mocks.park.mockResolvedValue({
      kind: "mcp-suggestion",
      outcome: "declined",
    });

    const result = await suggestMcpServerTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );

    expect(result).toContain("declined to connect the Vercel plugin");
    expect(result).toContain("do not suggest it again");
    expect(onXmlComplete).toHaveBeenCalledWith(
      '<dyad-suggest-mcp-server slug="vercel" name="Vercel" reason="Read the build logs." outcome="declined"></dyad-suggest-mcp-server>',
    );
  });

  it("treats a swept or timed-out request as dismissed", async () => {
    mocks.park.mockResolvedValue(null);

    const result = await suggestMcpServerTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );

    expect(result).toContain("did not respond");
    expect(onXmlComplete).toHaveBeenCalledWith(
      '<dyad-suggest-mcp-server slug="vercel" name="Vercel" reason="Read the build logs." outcome="dismissed"></dyad-suggest-mcp-server>',
    );
  });

  it("rejects a slug outside the suggestable set without asking the user", async () => {
    const result = await suggestMcpServerTool.execute(
      { slug: "github", reason: "Open a pull request." },
      context(),
    );

    expect(mocks.request).not.toHaveBeenCalled();
    expect(result).toContain('"github" is not a plugin you can suggest');
    expect(result).toContain("Available slugs: vercel");
    expect(onXmlComplete).toHaveBeenCalledWith(
      '<dyad-suggest-mcp-server slug="github" name="github" reason="Open a pull request." outcome="dismissed"></dyad-suggest-mcp-server>',
    );
  });
});
