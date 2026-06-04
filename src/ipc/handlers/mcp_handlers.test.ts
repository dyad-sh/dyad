// @vitest-environment node
//
// Handler-level tests for the MCP IPC surface. The handlers register
// themselves via `ipcMain.handle(channel, fn)`. We mock electron so
// `ipcMain.handle` captures the (channel -> fn) pairs into a map; the
// tests then invoke captured handlers directly with a mock event +
// payload, exercising the real handler logic without an Electron
// process.

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  url: string | null;
  enabled: boolean;
  oauthEnabled: boolean;
  oauthState: string | null;
  createdAt: Date;
  updatedAt: Date;
};
const dbStore = new Map<number, Row>();
let lastUpdateTargetId = 0;
let lastInsertPayload: Record<string, unknown> | null = null;

vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      fn: (event: unknown, input: unknown) => unknown,
    ) => {
      handlers.set(channel, fn);
    },
  },
  // The createServer client-secret tests call `encryptToString` (in
  // mcp_oauth_provider), which needs safeStorage.
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`, "utf8")),
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
            const existing = dbStore.get(lastUpdateTargetId);
            const merged = { ...existing, ...values } as Row;
            if (existing) dbStore.set(existing.id, merged);
            return Promise.resolve(existing ? [merged] : []);
          },
        }),
      }),
    })),
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => ({
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
            url: (values.url as string | null) ?? null,
            enabled: Boolean(values.enabled),
            oauthEnabled: Boolean(values.oauthEnabled),
            oauthState: (values.oauthState as string | null) ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          return Promise.resolve([synthetic]);
        },
      }),
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
}));

const getClientMock = vi.fn();
const disposeMock = vi.fn();
vi.mock("@/ipc/utils/mcp_manager", () => ({
  mcpManager: {
    getClient: getClientMock,
    dispose: disposeMock,
  },
}));

// Import the module under test last -- the vi.mock factories close
// over file-scope variables (handlers, getClientMock, ...) that must
// exist first. A static import would load too early and crash them.
const handlersModule = await import("@/ipc/handlers/mcp_handlers");
handlersModule.registerMcpHandlers();

function invoke<T>(channel: string, input: unknown): Promise<T> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for channel ${channel}`);
  return Promise.resolve(fn({}, input)) as Promise<T>;
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
    url: row.url ?? "https://example.com/mcp",
    enabled: row.enabled ?? true,
    oauthEnabled: row.oauthEnabled ?? true,
    oauthState: row.oauthState ?? null,
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
