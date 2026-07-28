// @vitest-environment node
//
// Handler-level tests for the MCP IPC surface. The handlers register
// themselves via `ipcMain.handle(channel, fn)`. We mock electron so
// `ipcMain.handle` captures the (channel -> fn) pairs into a map; the
// tests then invoke captured handlers directly with a mock event +
// payload, exercising the real handler logic without an Electron
// process.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { configureTrustedRenderer } from "@/ipc/utils/renderer_security";

// --- ipcMain capture ----------------------------------------------------
const handlers = new Map<string, (event: unknown, input: unknown) => unknown>();

// --- DB mock (in-memory mcp_servers rows) ------------------------------
type Row = {
  id: number;
  name: string;
  transport: string;
  command: string | null;
  args: unknown;
  envJson: unknown;
  headersJson: unknown;
  envEncrypted: string | null;
  headersEncrypted: string | null;
  url: string | null;
  enabled: boolean;
  oauthEnabled: boolean;
  oauthState: string | null;
  catalogSlug: string | null;
  createdAt: Date;
  updatedAt: Date;
};
const dbStore = new Map<number, Row>();
let lastUpdateTargetId = 0;
let lastInsertPayload: Record<string, unknown> | null = null;
let lastUpdatePayload: Record<string, unknown> | null = null;

vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      fn: (event: unknown, input: unknown) => unknown,
    ) => {
      handlers.set(channel, fn);
    },
  },
  // Client secrets, headers and env vars all go through
  // `secret_storage`, which needs safeStorage. `decryptString` is the
  // exact inverse of `encryptString` so round-trips are checkable.
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`, "utf8")),
    decryptString: vi.fn((b: Buffer) => {
      const s = b.toString("utf8");
      if (!s.startsWith("enc:")) throw new Error("not encrypted by this mock");
      return s.slice("enc:".length);
    }),
  },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("@/db", () => ({
  db: {
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            lastUpdatePayload = values;
            const existing = dbStore.get(lastUpdateTargetId);
            const merged = { ...existing, ...values } as Row;
            if (existing) dbStore.set(existing.id, merged);
            return Promise.resolve(existing ? [merged] : []);
          },
        }),
      }),
    })),
    delete: vi.fn(() => ({
      where: () => {
        dbStore.delete(lastUpdateTargetId);
        return Promise.resolve();
      },
    })),
    select: vi.fn(() => ({
      from: () => {
        const all = [...dbStore.values()];
        return Object.assign(Promise.resolve(all), {
          where: (cond: { value?: unknown; notNull?: boolean }) =>
            Promise.resolve(
              cond.notNull
                ? all.filter((r) => r.catalogSlug !== null)
                : all.filter((r) => r.catalogSlug === cond.value),
            ),
        });
      },
    })),
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        const build = () => ({
          returning: () => {
            lastInsertPayload = values;
            // Hand back a synthetic row that looks like what drizzle
            // would: input values + a numeric id + timestamps. The
            // handler runs `toMcpServer` on this, so all schema-
            // required fields must be present.
            const synthetic: Row = {
              id: 1000,
              name: String(values.name ?? "synthetic"),
              transport: String(values.transport ?? "http"),
              command: (values.command as string | null) ?? null,
              args: values.args ?? null,
              envJson: values.envJson ?? null,
              headersJson: values.headersJson ?? null,
              envEncrypted: (values.envEncrypted as string | null) ?? null,
              headersEncrypted:
                (values.headersEncrypted as string | null) ?? null,
              url: (values.url as string | null) ?? null,
              enabled: Boolean(values.enabled),
              oauthEnabled: Boolean(values.oauthEnabled),
              oauthState: (values.oauthState as string | null) ?? null,
              catalogSlug: (values.catalogSlug as string | null) ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return Promise.resolve([synthetic]);
          },
        });
        return { ...build(), onConflictDoNothing: () => build() };
      },
    })),
  },
}));

vi.mock("@/db/schema", () => ({
  mcpServers: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: number) => {
    lastUpdateTargetId = value;
    return { _col, value };
  },
  isNotNull: (_col: unknown) => ({ notNull: true }),
}));

let catalogEntries: unknown[] = [];
vi.mock("@/ipc/shared/remote_mcp_catalog", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getRemoteMcpCatalog: vi.fn(async () => catalogEntries),
}));

const getClientMock = vi.fn();
const disposeMock = vi.fn(async () => {});
vi.mock("@/ipc/utils/mcp_manager", () => ({
  mcpManager: {
    getClient: getClientMock,
    dispose: disposeMock,
  },
}));

const runOAuthFlowMock = vi.fn();
const disconnectOAuthMock = vi.fn(async () => ({ success: true }));
const withMcpOAuthServerMutationMock = vi.fn(
  async <T>(_serverId: number, _reason: string, mutate: () => Promise<T>) =>
    mutate(),
);
vi.mock("@/ipc/utils/mcp_oauth_flow", () => ({
  runOAuthFlow: runOAuthFlowMock,
  disconnectOAuth: disconnectOAuthMock,
  withMcpOAuthServerMutation: withMcpOAuthServerMutationMock,
}));

// Import the module under test last -- the vi.mock factories close
// over file-scope variables (handlers, getClientMock, ...) that must
// exist first. A static import would load too early and crash them.
const handlersModule = await import("@/ipc/handlers/mcp_handlers");
configureTrustedRenderer({
  devServerUrl: "http://localhost:5173",
  packagedRendererUrl: "file:///app/renderer/main_window/index.html",
});
handlersModule.registerMcpHandlers();

const rendererFrame = { url: "http://localhost:5173/" };
const rendererEvent = {
  sender: { mainFrame: rendererFrame },
  senderFrame: rendererFrame,
};

function invoke<T>(channel: string, input: unknown): Promise<T> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for channel ${channel}`);
  return Promise.resolve(fn(rendererEvent, input)).then((result) =>
    isIpcInvokeEnvelope(result) ? unwrapIpcEnvelope(result) : result,
  ) as Promise<T>;
}

function seedRow(row: Partial<Row> & { id: number }): void {
  const full: Row = {
    id: row.id,
    name: row.name ?? `srv${row.id}`,
    transport: row.transport ?? "http",
    command: row.command ?? null,
    args: row.args ?? null,
    envJson: row.envJson ?? null,
    headersJson: row.headersJson ?? null,
    envEncrypted: row.envEncrypted ?? null,
    headersEncrypted: row.headersEncrypted ?? null,
    url: row.url ?? "https://example.com/mcp",
    enabled: row.enabled ?? true,
    oauthEnabled: row.oauthEnabled ?? true,
    oauthState: row.oauthState ?? null,
    catalogSlug: row.catalogSlug ?? null,
    createdAt: row.createdAt ?? new Date(),
    updatedAt: row.updatedAt ?? new Date(),
  };
  dbStore.set(full.id, full);
}

describe("mcp updateServer handler", () => {
  beforeEach(() => {
    dbStore.clear();
    vi.clearAllMocks();
  });

  it("disposes the cached MCP client so the next use rebuilds with the new config", async () => {
    seedRow({ id: 44 });
    await invoke("mcp:update-server", { id: 44, name: "renamed" });
    expect(disposeMock).toHaveBeenCalledWith(44);
  });

  it.each([
    { oauthEnabled: false },
    { enabled: false },
    { url: "https://replacement.example/mcp" },
    { transport: "stdio" },
    { oauthClientId: "replacement-client" },
    { oauthClientSecret: "replacement-secret" },
    { oauthScope: "tools:read" },
  ])("revokes OAuth before an OAuth-relevant update: %o", async (change) => {
    seedRow({ id: 45 });
    await invoke("mcp:update-server", { id: 45, ...change });
    expect(withMcpOAuthServerMutationMock).toHaveBeenCalledWith(
      45,
      expect.stringMatching(/configuration changed/),
      expect.any(Function),
    );
  });

  it("does not revoke OAuth for a display-name-only update", async () => {
    seedRow({ id: 46 });
    await invoke("mcp:update-server", { id: 46, name: "renamed" });
    expect(withMcpOAuthServerMutationMock).not.toHaveBeenCalled();
  });
});

describe("mcp destructive OAuth boundaries", () => {
  beforeEach(() => {
    dbStore.clear();
    vi.clearAllMocks();
  });

  it("revokes OAuth before deleting a server row", async () => {
    seedRow({ id: 47 });
    await invoke("mcp:delete-server", 47);
    expect(withMcpOAuthServerMutationMock).toHaveBeenCalledWith(
      47,
      expect.stringMatching(/deleted/),
      expect.any(Function),
    );
  });

  it("routes disconnect through the server-scoped OAuth cancellation path", async () => {
    await invoke("mcp:disconnect-oauth", 48);
    expect(disconnectOAuthMock).toHaveBeenCalledWith(48);
  });
});

describe("mcp createServer handler (client_secret handling)", () => {
  beforeEach(() => {
    dbStore.clear();
    lastInsertPayload = null;
    vi.clearAllMocks();
  });

  it("encrypts oauthClientSecret before insert (never persists plaintext)", async () => {
    await invoke("mcp:create-server", {
      name: "confidential-server",
      transport: "http",
      url: "https://example.com/mcp",
      oauthEnabled: true,
      oauthClientId: "id",
      oauthClientSecret: "plaintext-secret",
    });

    expect(lastInsertPayload).not.toBeNull();
    const stored = lastInsertPayload!.oauthClientSecret;
    expect(typeof stored).toBe("string");
    expect(stored).not.toBe("plaintext-secret");
    expect(stored).not.toContain("plaintext-secret");
  });

  it("inserts NULL for oauthClientSecret when the user didn't supply one", async () => {
    await invoke("mcp:create-server", {
      name: "public-server",
      transport: "http",
      url: "https://example.com/mcp",
      oauthEnabled: true,
      oauthClientId: "id",
    });

    expect(lastInsertPayload).not.toBeNull();
    expect(lastInsertPayload!.oauthClientSecret).toBeNull();
  });
});

describe("mcp header/env encryption", () => {
  beforeEach(() => {
    dbStore.clear();
    lastInsertPayload = null;
    lastUpdatePayload = null;
    vi.clearAllMocks();
  });

  it("encrypts headers on create and leaves the plaintext column NULL", async () => {
    await invoke("mcp:create-server", {
      name: "http-server",
      transport: "http",
      url: "https://example.com/mcp",
      headersJson: { Authorization: "Bearer sk-secret" },
    });

    const stored = lastInsertPayload!.headersEncrypted as string;
    expect(Buffer.from(stored, "base64").toString("utf8")).toBe(
      `enc:{"Authorization":"Bearer sk-secret"}`,
    );
    expect(lastInsertPayload!.headersJson).toBeNull();
  });

  it("encrypts stdio env vars on create", async () => {
    await invoke("mcp:create-server", {
      name: "stdio-server",
      transport: "stdio",
      command: "npx",
      envJson: { API_KEY: "sk-secret" },
    });

    const stored = lastInsertPayload!.envEncrypted as string;
    expect(Buffer.from(stored, "base64").toString("utf8")).toBe(
      `enc:{"API_KEY":"sk-secret"}`,
    );
    expect(lastInsertPayload!.envJson).toBeNull();
  });

  it("stores NULL in the encrypted column when there are no headers", async () => {
    await invoke("mcp:create-server", {
      name: "bare-server",
      transport: "http",
      url: "https://example.com/mcp",
    });

    expect(lastInsertPayload!.headersEncrypted).toBeNull();
    expect(lastInsertPayload!.envEncrypted).toBeNull();
  });

  it("clears the plaintext column when headers change so no stale secret is left", async () => {
    seedRow({
      id: 3,
      transport: "http",
      headersJson: { "X-Api-Key": "leaked" },
    });
    await invoke("mcp:update-server", {
      id: 3,
      headersJson: { "X-Api-Key": "rotated" },
    });

    expect(lastUpdatePayload!.headersJson).toBeNull();
    const stored = lastUpdatePayload!.headersEncrypted as string;
    expect(Buffer.from(stored, "base64").toString("utf8")).toBe(
      `enc:{"X-Api-Key":"rotated"}`,
    );
  });

  it("reads headers back from the encrypted column", async () => {
    seedRow({
      id: 4,
      transport: "http",
      headersJson: { Authorization: "stale" },
      headersEncrypted: Buffer.from(
        `enc:{"Authorization":"current"}`,
        "utf8",
      ).toString("base64"),
    });

    const servers = await invoke<{ id: number; headersJson: unknown }[]>(
      "mcp:list-servers",
      undefined,
    );
    expect(servers.find((s) => s.id === 4)!.headersJson).toEqual({
      Authorization: "current",
    });
  });

  it("falls back to the plaintext column when the encrypted one is unreadable", async () => {
    seedRow({
      id: 5,
      transport: "http",
      headersJson: { Authorization: "fallback" },
      headersEncrypted: Buffer.from("undecryptable", "utf8").toString("base64"),
    });

    const servers = await invoke<{ id: number; headersJson: unknown }[]>(
      "mcp:list-servers",
      undefined,
    );
    expect(servers.find((s) => s.id === 5)!.headersJson).toEqual({
      Authorization: "fallback",
    });
  });
});

describe("mcp createServer (toMcpServer secret-redaction)", () => {
  beforeEach(() => {
    dbStore.clear();
    lastInsertPayload = null;
    vi.clearAllMocks();
  });

  it("does NOT include oauthClientSecret in the renderer-bound payload", async () => {
    // Security boundary: the stored (encrypted) secret must never
    // reach the renderer. toMcpServer returns only the fields the UI
    // needs and leaves the secret out entirely.
    const result = (await invoke("mcp:create-server", {
      name: "confidential-server",
      transport: "http",
      url: "https://example.com/mcp",
      oauthEnabled: true,
      oauthClientId: "id",
      oauthClientSecret: "secret-value",
    })) as Record<string, unknown>;

    expect("oauthClientSecret" in result).toBe(false);
  });
});

describe("mcp listTools handler", () => {
  beforeEach(() => {
    dbStore.clear();
    vi.clearAllMocks();
  });

  it("returns an empty list (not a crash) when getClient throws", async () => {
    // What the user hits while an OAuth server isn't connected:
    // `mcp_manager.getClient` throws because the provider won't open a
    // browser without an explicit Connect click. The handler must
    // catch the throw and return [] so the renderer shows "no tools"
    // instead of crashing.
    getClientMock.mockRejectedValueOnce(
      new Error(
        "OAuth not currently allowed (interactive consent required; click Connect on the server row).",
      ),
    );

    const result = await invoke("mcp:list-tools", 1);
    expect(result).toEqual({ tools: [], status: "error" });
  });

  it("returns an empty list when the underlying client.tools() throws", async () => {
    // Slightly different failure path -- getClient resolves but the
    // returned client's `tools()` blows up (e.g. transport 401 after
    // tokens expired AND refresh failed). Same UI contract: no
    // crash, empty list.
    const failingTools = vi
      .fn()
      .mockRejectedValueOnce(new Error("401 Unauthorized"));
    getClientMock.mockResolvedValueOnce({ tools: failingTools });

    const result = await invoke("mcp:list-tools", 2);
    expect(result).toEqual({ tools: [], status: "unauthorized" });
    expect(failingTools).toHaveBeenCalled();
  });
});

describe("mcp catalog handlers", () => {
  const FIGMA = {
    slug: "figma",
    name: "Figma",
    transport: "http",
    url: "https://mcp.figma.com/mcp",
    oauth: { required: true },
  };
  const CONTEXT7 = {
    slug: "context7",
    name: "Context7",
    transport: "http",
    url: "https://mcp.context7.com/mcp",
    headers: { "X-Test": "1" },
  };

  beforeEach(() => {
    dbStore.clear();
    lastInsertPayload = null;
    catalogEntries = [FIGMA, CONTEXT7];
    vi.clearAllMocks();
  });

  it("lists catalog entries with already-added slugs", async () => {
    seedRow({ id: 1, catalogSlug: "figma" });
    seedRow({ id: 2 }); // manual server, no slug
    const result = await invoke<{ entries: unknown[]; addedSlugs: string[] }>(
      "mcp:list-catalog",
      undefined,
    );
    expect(result.entries).toHaveLength(2);
    expect(result.addedSlugs).toEqual(["figma"]);
  });

  it("adds a catalog entry with oauth enabled and provenance slug", async () => {
    const created = await invoke<{ catalogSlug: string | null }>(
      "mcp:add-from-catalog",
      { slug: "figma" },
    );
    expect(created.catalogSlug).toBe("figma");
    expect(lastInsertPayload).toMatchObject({
      name: "Figma",
      transport: "http",
      url: "https://mcp.figma.com/mcp",
      enabled: true,
      oauthEnabled: true,
      catalogSlug: "figma",
    });
  });

  it("maps oauth: none entries to oauthEnabled: false and keeps headers", async () => {
    await invoke("mcp:add-from-catalog", { slug: "context7" });
    expect(lastInsertPayload).toMatchObject({
      oauthEnabled: false,
      headersJson: null,
    });
    const stored = lastInsertPayload!.headersEncrypted as string;
    expect(Buffer.from(stored, "base64").toString("utf8")).toBe(
      `enc:{"X-Test":"1"}`,
    );
  });

  it("returns the existing server when the slug was already added", async () => {
    seedRow({ id: 7, catalogSlug: "figma" });
    const result = await invoke<{ id: number }>("mcp:add-from-catalog", {
      slug: "figma",
    });
    expect(result.id).toBe(7);
    expect(lastInsertPayload).toBeNull();
  });

  it("rejects unknown slugs", async () => {
    await expect(
      invoke("mcp:add-from-catalog", { slug: "not-in-catalog" }),
    ).rejects.toThrow(/Unknown catalog entry/);
  });

  it("reports a connectivity error when the catalog is unreachable", async () => {
    // Transient failure after the user already saw a populated catalog:
    // the fetch now returns []. The add should read as a connectivity
    // problem, not an unknown slug.
    catalogEntries = [];
    await expect(
      invoke("mcp:add-from-catalog", { slug: "figma" }),
    ).rejects.toThrow(/Could not reach the plugin catalog/);
  });
});
