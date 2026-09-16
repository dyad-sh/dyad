import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";

const mocks = vi.hoisted(() => ({
  request: vi.fn(() => "request-id"),
  park: vi.fn(),
  catalog: vi.fn(async (): Promise<unknown[]> => []),
  peekCatalog: vi.fn((): unknown[] | null => null),
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
  peekRemoteMcpCatalog: mocks.peekCatalog,
}));

// Two queries run against the servers table: every added slug, and
// whether one slug is added. `eq` carries the slug so `where` can tell them
// apart.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async (condition?: { slug?: string }) =>
          condition?.slug !== undefined
            ? mocks.addedSlugs.includes(condition.slug)
              ? [{ id: 1 }]
              : []
            : mocks.addedSlugs.map((catalogSlug) => ({ catalogSlug })),
      }),
    }),
  },
}));

vi.mock("@/db/schema", () => ({
  mcpServers: { id: "id", catalogSlug: "catalog_slug" },
}));

vi.mock("drizzle-orm", () => ({
  isNotNull: vi.fn(),
  eq: (_column: unknown, slug: string) => ({ slug }),
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
  resetSuggestMcpServerStateForTests,
  suggestMcpServerTool,
} from "./suggest_mcp_server";

const VERCEL = {
  slug: "vercel",
  name: "Vercel",
  description: "Deployments, logs and projects on Vercel.",
  oauthRequired: true,
};

const CATALOG = [
  {
    slug: "vercel",
    name: "Vercel",
    description: VERCEL.description,
    transport: "http",
    url: "https://mcp.vercel.com",
    featured: true,
    oauth: { required: true },
  },
  {
    slug: "exa",
    name: "Exa",
    transport: "http",
    url: "https://mcp.exa.ai/mcp",
    featured: true,
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
];

describe("collectSuggestableMcpServers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSuggestMcpServerStateForTests();
    mocks.addedSlugs = [];
    mocks.peekCatalog.mockReturnValue(null);
  });

  it("keeps only featured one-click http entries the user has not added", async () => {
    mocks.addedSlugs = ["stripe"];
    mocks.catalog.mockResolvedValue(CATALOG);

    await expect(collectSuggestableMcpServers({ chatId: 7 })).resolves.toEqual([
      VERCEL,
      {
        slug: "exa",
        name: "Exa",
        description: undefined,
        oauthRequired: false,
      },
    ]);
  });

  it("returns nothing when the catalog is unavailable", async () => {
    mocks.catalog.mockResolvedValue([]);
    await expect(collectSuggestableMcpServers({ chatId: 7 })).resolves.toEqual(
      [],
    );
  });

  it("reads only the cache when asked, without fetching", async () => {
    mocks.catalog.mockResolvedValue(CATALOG);
    await expect(
      collectSuggestableMcpServers({ chatId: 7, cachedOnly: true }),
    ).resolves.toEqual([]);
    expect(mocks.catalog).not.toHaveBeenCalled();

    mocks.peekCatalog.mockReturnValue(CATALOG);
    const cached = await collectSuggestableMcpServers({
      chatId: 7,
      cachedOnly: true,
    });
    expect(cached.map((server) => server.slug)).toEqual([
      "vercel",
      "exa",
      "stripe",
    ]);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it("gives up on a cold cache after a bounded wait", async () => {
    vi.useFakeTimers();
    try {
      mocks.catalog.mockReturnValue(new Promise(() => {}));
      const pending = collectSuggestableMcpServers({ chatId: 7 });
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops plugins the user declined in that chat only", async () => {
    mocks.catalog.mockResolvedValue(CATALOG);
    mocks.park.mockResolvedValue({
      kind: "mcp-suggestion",
      outcome: "declined",
    });
    await suggestMcpServerTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      {
        chatId: 7,
        messageId: 99,
        onXmlComplete: vi.fn(),
        suggestableMcpServers: [VERCEL],
      } as unknown as AgentContext,
    );

    const sameChat = await collectSuggestableMcpServers({ chatId: 7 });
    expect(sameChat.map((server) => server.slug)).toEqual(["exa", "stripe"]);
    const otherChat = await collectSuggestableMcpServers({ chatId: 8 });
    expect(otherChat.map((server) => server.slug)).toEqual([
      "vercel",
      "exa",
      "stripe",
    ]);
  });
});

describe("suggestMcpServerTool", () => {
  let onXmlComplete: ReturnType<typeof vi.fn>;

  const context = (overrides: Partial<AgentContext> = {}) =>
    ({
      chatId: 7,
      messageId: 99,
      onXmlComplete,
      suggestableMcpServers: [VERCEL],
      ...overrides,
    }) as unknown as AgentContext;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSuggestMcpServerStateForTests();
    mocks.addedSlugs = [];
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

  it("streams a preview while arguments arrive but persists nothing itself", () => {
    expect(suggestMcpServerTool.buildXml?.({ slug: "vercel" }, false)).toBe(
      '<dyad-suggest-mcp-server slug="vercel" outcome="pending"></dyad-suggest-mcp-server>',
    );
    expect(
      suggestMcpServerTool.buildXml?.(
        { slug: "vercel", reason: 'Read the "failed" build logs' },
        false,
      ),
    ).toBe(
      '<dyad-suggest-mcp-server slug="vercel" reason="Read the &quot;failed&quot; build logs" outcome="pending"></dyad-suggest-mcp-server>',
    );
    expect(suggestMcpServerTool.buildXml?.({}, false)).toBeUndefined();
    // The durable card is written by execute() with the request id.
    expect(
      suggestMcpServerTool.buildXml?.(
        { slug: "vercel", reason: "Read the build logs." },
        true,
      ),
    ).toBeUndefined();
  });

  it("persists the pending card with its request id before parking", async () => {
    let parked = false;
    const writtenBeforePark: boolean[] = [];
    mocks.park.mockImplementation(async () => {
      parked = true;
      return { kind: "mcp-suggestion", outcome: "connected" };
    });
    onXmlComplete.mockImplementation(() => {
      writtenBeforePark.push(!parked);
    });

    await suggestMcpServerTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );

    expect(writtenBeforePark).toEqual([true, false]);
    expect(onXmlComplete).toHaveBeenNthCalledWith(
      1,
      '<dyad-suggest-mcp-server slug="vercel" name="Vercel" reason="Read the build logs." request-id="request-id" outcome="pending"></dyad-suggest-mcp-server>',
    );
    expect(onXmlComplete).toHaveBeenNthCalledWith(
      2,
      '<dyad-suggest-mcp-server slug="vercel" name="Vercel" reason="Read the build logs." outcome="connected"></dyad-suggest-mcp-server>',
    );
  });

  it("does not park the same plugin twice in one turn after a dismissal", async () => {
    mocks.park.mockResolvedValue(null);
    await suggestMcpServerTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );
    mocks.request.mockClear();

    const sameTurn = await suggestMcpServerTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(sameTurn).toContain("already suggested");

    // A later turn (a new assistant message) may offer it again.
    mocks.park.mockResolvedValue({
      kind: "mcp-suggestion",
      outcome: "connected",
    });
    await expect(
      suggestMcpServerTool.execute(
        { slug: "vercel", reason: "Read the build logs." },
        context({ messageId: 100 }),
      ),
    ).resolves.toContain("queued a follow-up turn");
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
      oauthRequired: true,
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

  it("refuses a plugin the user already declined this chat, even within the turn", async () => {
    mocks.park.mockResolvedValue({
      kind: "mcp-suggestion",
      outcome: "declined",
    });
    await suggestMcpServerTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );
    mocks.request.mockClear();

    // The turn's suggestable set still lists vercel.
    const result = await suggestMcpServerTool.execute(
      { slug: "vercel", reason: "Read the build logs again." },
      context(),
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(result).toContain("already declined");
    expect(onXmlComplete).toHaveBeenLastCalledWith(
      '<dyad-suggest-mcp-server slug="vercel" name="Vercel" reason="Read the build logs again." outcome="dismissed"></dyad-suggest-mcp-server>',
    );
  });

  it("refuses a plugin that was added since the turn started", async () => {
    mocks.addedSlugs = ["vercel"];

    const result = await suggestMcpServerTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(result).toContain("already added");
    // No follow-up is armed on this path, so the model must not stop.
    expect(result).toContain("next time the user sends a message");
    expect(result).not.toContain("end your response");
  });

  it("refuses a second suggestion while one is parked in the same chat", async () => {
    let settleFirst!: (value: unknown) => void;
    mocks.park.mockReturnValueOnce(
      new Promise((resolve) => {
        settleFirst = resolve;
      }),
    );
    const first = suggestMcpServerTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );
    await Promise.resolve();

    const second = await suggestMcpServerTool.execute(
      { slug: "vercel", reason: "Read the build logs again." },
      context(),
    );
    expect(second).toContain("already waiting for the user");
    expect(mocks.request).toHaveBeenCalledTimes(1);

    settleFirst({ kind: "mcp-suggestion", outcome: "connected" });
    await expect(first).resolves.toContain("queued a follow-up turn");

    // The slot frees once the first settles; a later turn can suggest again.
    mocks.park.mockResolvedValue({
      kind: "mcp-suggestion",
      outcome: "connected",
    });
    await expect(
      suggestMcpServerTool.execute(
        { slug: "vercel", reason: "Read the build logs." },
        context({ messageId: 100 }),
      ),
    ).resolves.toContain("queued a follow-up turn");
  });
});
