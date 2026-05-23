// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory replacement for the `mcp_servers` table. The mocked db
// reads/writes from here so we can exercise the flow without spinning
// up SQLite. Keyed by serverId; values are partial DB rows.
type Row = {
  id: number;
  name: string;
  transport: "stdio" | "http" | "sse";
  url: string | null;
  oauthEnabled: boolean;
  oauthClientId: string | null;
  oauthState: string | null;
};
const dbStore = new Map<number, Row>();

let currentTargetId = 0;

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    decryptString: vi.fn((buf: Buffer) => {
      const s = buf.toString("utf8");
      return s.startsWith("enc:") ? s.slice(4) : s;
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

vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => {
          const row = dbStore.get(currentTargetId);
          return Promise.resolve(row ? [row] : []);
        },
      }),
    })),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          const existing = dbStore.get(currentTargetId);
          if (existing) {
            dbStore.set(currentTargetId, { ...existing, ...values } as Row);
          }
          return Promise.resolve([]);
        },
      }),
    })),
  },
}));

vi.mock("../db/schema", () => ({
  mcpServers: { id: "id", oauthState: "oauth_state" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: number) => {
    currentTargetId = value;
    return { _col, value };
  },
}));

// `auth()` is not under test here — we want to verify our flow
// orchestration (validation, error surfacing, disconnect, listener
// CSRF check) without driving the SDK's PKCE state machine. Mock it
// out and assert call shape where relevant.
const authMock = vi.fn();
vi.mock("@ai-sdk/mcp", () => ({
  auth: authMock,
}));

// mcp_manager.dispose is called after a successful flow to force the
// cached client to rebuild. Mock it to a no-op so the test doesn't
// pull in the whole manager.
vi.mock("../ipc/utils/mcp_manager", () => ({
  mcpManager: { dispose: vi.fn() },
}));

const flowImport = await import("../ipc/utils/mcp_oauth_flow");
const { disconnectOAuth, runOAuthFlow } = flowImport;

function seedRow(row: Partial<Row> & { id: number }): void {
  dbStore.set(row.id, {
    id: row.id,
    name: row.name ?? `srv${row.id}`,
    transport: row.transport ?? "http",
    // Explicit `url: null` must be preserved (one of our tests seeds a
    // missing-URL row); only fall back to the default when the caller
    // omits the field entirely.
    url: "url" in row ? (row.url ?? null) : "https://example.com/mcp",
    oauthEnabled: row.oauthEnabled ?? true,
    oauthClientId: row.oauthClientId ?? null,
    oauthState: row.oauthState ?? null,
  });
}

describe("runOAuthFlow validation", () => {
  beforeEach(() => {
    dbStore.clear();
    authMock.mockReset();
  });

  it("returns an error result when the server id does not exist", async () => {
    const result = await runOAuthFlow({ serverId: 999 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("MCP server not found");
  });

  it("rejects stdio transport (OAuth only applies to http / sse)", async () => {
    // Stdio rows seeded here have a non-null URL so we exercise the
    // transport-rejection branch rather than the URL-missing one.
    seedRow({ id: 1, transport: "stdio", url: "ignored-for-stdio" });
    const result = await runOAuthFlow({ serverId: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("OAuth not supported");
  });

  it("rejects when URL is missing on an http server", async () => {
    seedRow({ id: 2, transport: "http", url: null });
    const result = await runOAuthFlow({ serverId: 2 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("OAuth requires HTTP or SSE");
  });
});

describe("runOAuthFlow happy path (auth resolves AUTHORIZED first call)", () => {
  beforeEach(() => {
    dbStore.clear();
    authMock.mockReset();
  });

  it("returns success without waiting for a redirect when auth() is AUTHORIZED", async () => {
    seedRow({ id: 3, transport: "http", url: "https://example.com/mcp" });
    // Pre-existing valid tokens: auth() refreshes silently and
    // returns 'AUTHORIZED' on the first call.
    authMock.mockResolvedValueOnce("AUTHORIZED");
    const result = await runOAuthFlow({
      serverId: 3,
      // Random high port to avoid colliding with the prod default
      // (53682) during parallel test runs.
      callbackPort: 53690,
    });
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(authMock).toHaveBeenCalledTimes(1);
  });
});

describe("disconnectOAuth", () => {
  beforeEach(() => {
    dbStore.clear();
  });

  it("clears the encrypted oauth_state row when disconnecting", async () => {
    seedRow({
      id: 5,
      transport: "http",
      url: "https://example.com/mcp",
      oauthState: 'enc:{"tokens":{"access_token":"t"}}',
    });
    const result = await disconnectOAuth(5);
    expect(result.success).toBe(true);
    const row = dbStore.get(5);
    expect(row).toBeDefined();
    // After disconnect the row's oauthState is cleared to NULL --
    // the column is the UI's source of truth for "connected".
    expect(row!.oauthState).toBeNull();
  });

  it("returns success=false for an unknown server id", async () => {
    const result = await disconnectOAuth(404);
    expect(result.success).toBe(false);
  });
});

describe("OAuth loopback listener (state CSRF check)", () => {
  beforeEach(() => {
    dbStore.clear();
    authMock.mockReset();
  });

  it("accepts the OAuth callback over the IPv6 loopback address (`[::1]`)", async () => {
    // Regression test for binding only IPv4. Modern OS resolvers often
    // return `::1` first for `localhost`, so a listener bound only to
    // `127.0.0.1` would refuse the browser's callback right after
    // consent. This test sends the callback to `[::1]` directly and
    // checks the listener receives it, proving IPv6 is bound.
    seedRow({ id: 10, transport: "http", url: "https://example.com/mcp" });
    authMock.mockResolvedValueOnce("REDIRECT");

    const callbackPort = 53693;
    const flowPromise = runOAuthFlow({ serverId: 10, callbackPort });

    // The flow's `state` is cryptographically random and flow-scoped,
    // so we can't forge a matching callback. Instead, probe `[::1]`
    // with a known-wrong state and assert HTTP 400 -- a 400 (not
    // ECONNREFUSED) proves the listener accepted the connection on the
    // IPv6 stack. CSRF correctness itself is covered by the
    // state-mismatch test below.
    await new Promise((r) => setTimeout(r, 50));
    const probe = await fetch(
      `http://[::1]:${callbackPort}/callback?code=x&state=wrong`,
    );
    expect(probe.status).toBe(400);

    // State mismatch closed the listener; the flow resolves with the
    // CSRF-mismatch error. The load-bearing check is the IPv6 probe
    // above getting a real HTTP response, not ECONNREFUSED.
    const result = await flowPromise;
    expect(result.success).toBe(false);
  });

  it("supersedes a stale flow when Connect is clicked again on the same port", async () => {
    // Two flows on the same callback port: the second must take over
    // (not fail with port-busy), and the first must surface a clean
    // `superseded` error.
    seedRow({ id: 11, transport: "http", url: "https://example.com/mcp" });
    seedRow({ id: 12, transport: "http", url: "https://example.com/mcp" });
    // First flow: stays in REDIRECT (listener bound, awaiting code).
    authMock.mockResolvedValueOnce("REDIRECT");
    // Second flow (after supersede): also REDIRECT so we can probe
    // the listener directly without driving a full code exchange.
    authMock.mockResolvedValueOnce("REDIRECT");

    const callbackPort = 53697;
    const firstPromise = runOAuthFlow({ serverId: 11, callbackPort });
    // Let the first flow's listener bind.
    await new Promise((r) => setTimeout(r, 50));

    // Second click on the same port: must not reject with port-busy.
    const secondPromise = runOAuthFlow({ serverId: 12, callbackPort });
    // Give supersede + bind a moment.
    await new Promise((r) => setTimeout(r, 200));

    // The new listener must be reachable -- probe via a malformed
    // state callback that the listener will 400 (proving the new
    // listener is bound), then the second flow rejects with CSRF.
    const probe = await fetch(
      `http://127.0.0.1:${callbackPort}/callback?code=x&state=wrong`,
    );
    expect(probe.status).toBe(400);

    // First flow must surface a clean error result (not a hang).
    const firstResult = await firstPromise;
    expect(firstResult.success).toBe(false);
    expect(firstResult.error ?? "").toMatch(/superseded/i);

    const secondResult = await secondPromise;
    expect(secondResult.success).toBe(false);
  });

  it("rejects callbacks whose `state` does not match the expected value", async () => {
    seedRow({ id: 7, transport: "http", url: "https://example.com/mcp" });
    // Make auth() request a redirect (so the listener stays open).
    authMock.mockResolvedValueOnce("REDIRECT");

    // Race the runOAuthFlow against a delayed wrong-state callback.
    const callbackPort = 53691;
    const flowPromise = runOAuthFlow({ serverId: 7, callbackPort });

    // Give the listener a moment to bind, then send a forged
    // callback with a `state` value that cannot possibly match (the
    // expected `state` is a 22-char base64url string we don't know).
    await new Promise((r) => setTimeout(r, 50));
    const callbackResponse = await fetch(
      `http://127.0.0.1:${callbackPort}/callback?code=fake-code&state=not-the-real-state`,
    );
    expect(callbackResponse.status).toBe(400);

    const result = await flowPromise;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/state.*did not match|CSRF/i);
  });
});
