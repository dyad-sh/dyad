import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";

interface Row {
  catalogSlug: string;
  enabled: boolean;
  oauthState: string | null;
}

const mocks = vi.hoisted(() => ({
  request: vi.fn(() => "request-id"),
  park: vi.fn(),
  catalog: vi.fn(async (): Promise<unknown[]> => []),
  peekCatalog: vi.fn((): unknown[] | null => null),
  rows: [] as {
    catalogSlug: string;
    enabled: boolean;
    oauthState: string | null;
  }[],
  neverSlugs: undefined as string[] | undefined,
  tryWriteSettings: vi.fn(() => true),
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

// The column holds the client registration before any token, so only the
// literal "tokens" counts as authorized here.
vi.mock("@/ipc/utils/mcp_oauth_provider", () => ({
  oauthStateHasTokens: (stored: string | null) => stored === "tokens",
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => ({ neverSuggestPluginSlugs: mocks.neverSlugs }),
  tryWriteSettings: mocks.tryWriteSettings,
}));

// Two queries run against the servers table: every catalog row, and the
// row for one slug. `eq` carries the slug so `where` can tell them apart.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async (condition?: { slug?: string }) =>
          condition?.slug !== undefined
            ? mocks.rows.filter((row) => row.catalogSlug === condition.slug)
            : mocks.rows,
      }),
    }),
  },
}));

vi.mock("@/db/schema", () => ({
  mcpServers: {
    catalogSlug: "catalog_slug",
    enabled: "enabled",
    oauthState: "oauth_state",
  },
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
  collectSuggestablePlugins,
  resetSuggestPluginStateForTests,
  suggestPluginTool,
} from "./suggest_plugin";

const row = (
  catalogSlug: string,
  overrides: Partial<Omit<Row, "catalogSlug">> = {},
): Row => ({ catalogSlug, enabled: true, oauthState: null, ...overrides });

const VERCEL = {
  slug: "vercel",
  name: "Vercel",
  description: "Deployments, logs and projects on Vercel.",
  oauthRequired: true,
  needsOAuth: true,
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

const slugs = (servers: { slug: string }[]) =>
  servers.map((server) => server.slug);

function resetMocks() {
  vi.clearAllMocks();
  resetSuggestPluginStateForTests();
  mocks.rows = [];
  mocks.neverSlugs = undefined;
  mocks.peekCatalog.mockReturnValue(null);
  mocks.catalog.mockResolvedValue(CATALOG);
}

describe("collectSuggestablePlugins", () => {
  beforeEach(resetMocks);

  it("keeps only featured one-click http entries that are not usable yet", async () => {
    mocks.rows = [row("stripe")];

    await expect(collectSuggestablePlugins({ chatId: 7 })).resolves.toEqual([
      VERCEL,
      {
        slug: "exa",
        name: "Exa",
        description: undefined,
        oauthRequired: false,
        needsOAuth: false,
      },
    ]);
  });

  it("re-suggests a plugin that is added but disabled or not authorized", async () => {
    mocks.rows = [row("exa", { enabled: false }), row("vercel"), row("stripe")];

    await expect(collectSuggestablePlugins({ chatId: 7 })).resolves.toEqual([
      VERCEL,
      {
        slug: "exa",
        name: "Exa",
        description: undefined,
        oauthRequired: false,
        needsOAuth: false,
      },
    ]);
  });

  it("skips authorization for a disabled plugin that already holds tokens", async () => {
    mocks.rows = [row("vercel", { enabled: false, oauthState: "tokens" })];

    const [vercel] = await collectSuggestablePlugins({ chatId: 7 });
    expect(vercel).toMatchObject({ slug: "vercel", needsOAuth: false });
  });

  it("still suggests a plugin whose authorization was started but never finished", async () => {
    mocks.rows = [row("vercel", { oauthState: "registration-only" })];

    const [vercel] = await collectSuggestablePlugins({ chatId: 7 });
    expect(vercel).toMatchObject({ slug: "vercel", needsOAuth: true });
  });

  it("leaves out an authorized, enabled plugin", async () => {
    mocks.rows = [row("vercel", { oauthState: "tokens" })];

    expect(slugs(await collectSuggestablePlugins({ chatId: 7 }))).toEqual([
      "exa",
      "stripe",
    ]);
  });

  it("leaves out plugins the user asked never to be offered", async () => {
    mocks.neverSlugs = ["vercel", "stripe"];

    expect(slugs(await collectSuggestablePlugins({ chatId: 7 }))).toEqual([
      "exa",
    ]);
  });

  it("returns nothing when the catalog is unavailable", async () => {
    mocks.catalog.mockResolvedValue([]);
    await expect(collectSuggestablePlugins({ chatId: 7 })).resolves.toEqual([]);
  });

  it("reads only the cache when asked, without fetching", async () => {
    await expect(
      collectSuggestablePlugins({ chatId: 7, cachedOnly: true }),
    ).resolves.toEqual([]);
    expect(mocks.catalog).not.toHaveBeenCalled();

    mocks.peekCatalog.mockReturnValue(CATALOG);
    const cached = await collectSuggestablePlugins({
      chatId: 7,
      cachedOnly: true,
    });
    expect(slugs(cached)).toEqual(["vercel", "exa", "stripe"]);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it("gives up on a cold cache after a bounded wait", async () => {
    vi.useFakeTimers();
    try {
      mocks.catalog.mockReturnValue(new Promise(() => {}));
      const pending = collectSuggestablePlugins({ chatId: 7 });
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops plugins the user declined in that chat only", async () => {
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "declined",
    });
    await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      {
        chatId: 7,
        messageId: 99,
        onXmlComplete: vi.fn(),
        suggestablePlugins: [VERCEL],
      } as unknown as AgentContext,
    );

    expect(slugs(await collectSuggestablePlugins({ chatId: 7 }))).toEqual([
      "exa",
      "stripe",
    ]);
    expect(slugs(await collectSuggestablePlugins({ chatId: 8 }))).toEqual([
      "vercel",
      "exa",
      "stripe",
    ]);
  });
});

describe("suggestPluginTool", () => {
  let onXmlComplete: ReturnType<typeof vi.fn>;

  const context = (overrides: Partial<AgentContext> = {}) =>
    ({
      chatId: 7,
      messageId: 99,
      onXmlComplete,
      suggestablePlugins: [VERCEL],
      ...overrides,
    }) as unknown as AgentContext;

  beforeEach(() => {
    resetMocks();
    onXmlComplete = vi.fn();
  });

  it("is hidden until a suggestable plugin exists", () => {
    expect(
      suggestPluginTool.isEnabled?.(context({ suggestablePlugins: [] })),
    ).toBe(false);
    expect(suggestPluginTool.isEnabled?.(context())).toBe(true);
  });

  it("lists the suggestable plugins in its description", () => {
    const description = suggestPluginTool.getDescription?.(context());
    expect(description).toContain(
      "- vercel: Vercel — Deployments, logs and projects on Vercel.",
    );
    expect(
      suggestPluginTool.getDescription?.(context({ suggestablePlugins: [] })),
    ).not.toContain("Plugins available");
  });

  it("persists the pending card with its request id before parking", async () => {
    let parked = false;
    const writtenBeforePark: boolean[] = [];
    mocks.park.mockImplementation(async () => {
      parked = true;
      return { kind: "plugin-suggestion", outcome: "connected" };
    });
    onXmlComplete.mockImplementation(() => {
      writtenBeforePark.push(!parked);
    });

    await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );

    expect(writtenBeforePark).toEqual([true, false]);
    expect(onXmlComplete).toHaveBeenNthCalledWith(
      1,
      '<dyad-suggest-plugin slug="vercel" name="Vercel" reason="Read the build logs." request-id="request-id" outcome="pending"></dyad-suggest-plugin>',
    );
    expect(onXmlComplete).toHaveBeenNthCalledWith(
      2,
      '<dyad-suggest-plugin slug="vercel" name="Vercel" reason="Read the build logs." outcome="connected"></dyad-suggest-plugin>',
    );
  });

  it("requests a follow-up-capable suggestion and reports a connection", async () => {
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "connected",
    });

    const result = await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs for the failed deploy." },
      context(),
    );

    expect(mocks.request).toHaveBeenCalledWith({
      kind: "plugin-suggestion",
      chatId: 7,
      slug: "vercel",
      serverName: "Vercel",
      serverDescription: VERCEL.description,
      needsOAuth: true,
      reason: "Read the build logs for the failed deploy.",
      classifier: "none",
      followUpPrompt:
        "Continue. I have connected the Vercel plugin. Resume what you needed it for: Read the build logs for the failed deploy.",
    });
    expect(result).toContain("queued a follow-up turn");
  });

  it("still offers a plugin that is added but disabled", async () => {
    mocks.rows = [row("vercel", { enabled: false, oauthState: "tokens" })];
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "connected",
    });

    await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context({ suggestablePlugins: [{ ...VERCEL, needsOAuth: false }] }),
    );

    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "vercel", needsOAuth: false }),
    );
  });

  it("tells the agent to continue without a declined plugin", async () => {
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "declined",
    });

    const result = await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );

    expect(result).toContain("declined to connect the Vercel plugin");
    expect(result).toContain("do not suggest it again");
    expect(mocks.tryWriteSettings).not.toHaveBeenCalled();
    expect(onXmlComplete).toHaveBeenLastCalledWith(
      '<dyad-suggest-plugin slug="vercel" name="Vercel" reason="Read the build logs." outcome="declined"></dyad-suggest-plugin>',
    );
  });

  it("stores a never-suggest choice for that plugin", async () => {
    mocks.neverSlugs = ["stripe"];
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "never",
    });

    const result = await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );

    expect(mocks.tryWriteSettings).toHaveBeenCalledWith(
      { neverSuggestPluginSlugs: ["stripe", "vercel"] },
      expect.any(String),
    );
    expect(result).toContain("never suggest it again");
    expect(onXmlComplete).toHaveBeenLastCalledWith(
      '<dyad-suggest-plugin slug="vercel" name="Vercel" reason="Read the build logs." outcome="never"></dyad-suggest-plugin>',
    );
  });

  it("still settles the card when the never-suggest choice cannot be stored", async () => {
    mocks.tryWriteSettings.mockReturnValueOnce(false);
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "never",
    });

    const result = await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );

    expect(result).toContain("never suggest it again");
    expect(onXmlComplete).toHaveBeenLastCalledWith(
      '<dyad-suggest-plugin slug="vercel" name="Vercel" reason="Read the build logs." outcome="never"></dyad-suggest-plugin>',
    );
  });

  it("treats a swept or timed-out request as dismissed", async () => {
    mocks.park.mockResolvedValue(null);

    const result = await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );

    expect(result).toContain("did not respond");
    expect(onXmlComplete).toHaveBeenLastCalledWith(
      '<dyad-suggest-plugin slug="vercel" name="Vercel" reason="Read the build logs." outcome="dismissed"></dyad-suggest-plugin>',
    );
  });

  it("rejects a slug outside the suggestable set without asking the user", async () => {
    const result = await suggestPluginTool.execute(
      { slug: "github", reason: "Open a pull request." },
      context(),
    );

    expect(mocks.request).not.toHaveBeenCalled();
    expect(result).toContain('"github" is not a plugin you can suggest');
    expect(result).toContain("Available slugs: vercel");
    expect(onXmlComplete).toHaveBeenCalledWith(
      '<dyad-suggest-plugin slug="github" name="github" reason="Open a pull request." outcome="dismissed"></dyad-suggest-plugin>',
    );
  });

  it("refuses a plugin the user already declined this chat, even within the turn", async () => {
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "declined",
    });
    await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );
    mocks.request.mockClear();

    // The turn's suggestable set still lists vercel.
    const result = await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs again." },
      context(),
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(result).toContain("already declined");
  });

  it("refuses a plugin that became usable since the turn started", async () => {
    mocks.rows = [row("vercel", { oauthState: "tokens" })];

    const result = await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(result).toContain("already connected");
    // No follow-up is armed on this path, so the model must not stop.
    expect(result).toContain("next time the user sends a message");
    expect(result).not.toContain("end your response");
  });

  it("does not park the same plugin twice in one turn after a dismissal", async () => {
    mocks.park.mockResolvedValue(null);
    await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );
    mocks.request.mockClear();

    const sameTurn = await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(sameTurn).toContain("already suggested");

    // A later turn (a new assistant message) may offer it again.
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "connected",
    });
    await expect(
      suggestPluginTool.execute(
        { slug: "vercel", reason: "Read the build logs." },
        context({ messageId: 100 }),
      ),
    ).resolves.toContain("queued a follow-up turn");
  });

  it("refuses a second suggestion while one is parked in the same chat", async () => {
    let settleFirst!: (value: unknown) => void;
    mocks.park.mockReturnValueOnce(
      new Promise((resolve) => {
        settleFirst = resolve;
      }),
    );
    const first = suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs." },
      context(),
    );
    await Promise.resolve();

    const second = await suggestPluginTool.execute(
      { slug: "vercel", reason: "Read the build logs again." },
      context(),
    );
    expect(second).toContain("already waiting for the user");

    settleFirst({ kind: "plugin-suggestion", outcome: "connected" });
    await expect(first).resolves.toContain("queued a follow-up turn");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
