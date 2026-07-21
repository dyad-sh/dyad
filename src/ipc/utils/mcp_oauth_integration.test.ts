// @vitest-environment node
//
// End-to-end OAuth flow integration test against the fake OAuth MCP
// server (`testing/fake-oauth-mcp-server.mjs`). Unlike the unit tests
// in mcp_oauth_flow.test.ts, this file does not mock @ai-sdk/mcp's
// `auth()` -- it lets the real SDK drive discovery, DCR (or static
// client lookup), PKCE, the authorize redirect, and the token
// exchange. The only fakery is on the Electron surface (safeStorage,
// shell.openExternal) and the DB (in-memory map).
//
// Two modes are exercised against the same fake server binary:
//   1. DCR mode -- the SDK hits /register, mints a client_id, then
//      completes the flow. Mirrors Linear / Atlassian / Notion.
//   2. Static client_id mode -- DCR is disabled on the server and
//      the user pre-registers a client_id via the UI. Mirrors the
//      non-DCR case real public MCP services generally don't expose.

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// --- DB mock identical in shape to the other oauth tests ----------------
type Row = {
  id: number;
  name: string;
  transport: "stdio" | "http";
  url: string | null;
  oauthEnabled: boolean;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
  oauthScope: string | null;
  oauthState: string | null;
};
const dbStore = new Map<number, Row>();
let currentTargetId = 0;

vi.mock("electron", () => {
  // shell.openExternal is overridden per test (the integration must
  // drive the authorize URL itself rather than opening a real
  // browser). safeStorage uses the same enc:/dec: scheme as the unit
  // tests so the on-disk byte shape doesn't surprise us if we ever
  // inspect it.
  return {
    shell: {
      openExternal: vi.fn(),
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`, "utf8")),
      decryptString: vi.fn((buf: Buffer) => {
        const s = buf.toString("utf8");
        return s.startsWith("enc:") ? s.slice(4) : s;
      }),
    },
  };
});

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
    select: vi.fn(() => ({
      from: () => ({
        where: () =>
          Promise.resolve(
            dbStore.has(currentTargetId) ? [dbStore.get(currentTargetId)!] : [],
          ),
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

vi.mock("@/db/schema", () => ({
  mcpServers: { id: "id", oauthState: "oauth_state" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: number) => {
    currentTargetId = value;
    return { _col, value };
  },
}));

vi.mock("@/ipc/utils/mcp_manager", () => ({
  mcpManager: { dispose: vi.fn(async () => {}) },
}));

// Resolve mocks before importing modules under test.
const electronImport = await import("electron");
const flowImport = await import("@/ipc/utils/mcp_oauth_flow");
const providerImport = await import("@/ipc/utils/mcp_oauth_provider");
const { runOAuthFlow } = flowImport;
const { oauthStateHasTokens, DyadOAuthClientProvider, encryptToString } =
  providerImport;
const { shell } = electronImport;

// --- Fake-server lifecycle ----------------------------------------------
//
// One child process per `describe` block (DCR mode + static mode use
// different env). The fake servers use fixed ports, while callback listeners
// use ports selected by the OS to avoid collisions with Windows' dynamic port
// range and other processes on the runner.

const DCR_SERVER_PORT = 47002;
const STATIC_SERVER_PORT = 47003;
const REFRESH_SERVER_PORT = 47004;
const CONFIDENTIAL_SERVER_PORT = 47005;
const SCOPE_SERVER_PORT = 47006;

async function getAvailableCallbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "localhost", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to select an OAuth callback port"));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

async function waitForReady(baseUrl: string, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(
        `${baseUrl}/.well-known/oauth-authorization-server`,
      );
      if (r.ok) return;
    } catch {
      // ECONNREFUSED until the listener binds.
    }
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`fake-oauth-mcp-server at ${baseUrl} never came up`);
}

function spawnFakeServer(env: Record<string, string>): ChildProcess {
  const child = spawn("node", ["testing/fake-oauth-mcp-server.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  // Surface fatal startup errors but keep normal log lines quiet so
  // vitest output isn't polluted.
  child.stderr?.on("data", (b: Buffer) => {
    const s = b.toString();
    if (s.toLowerCase().includes("error")) process.stderr.write(`[fake] ${s}`);
  });
  return child;
}

// Install a shell.openExternal stub that drives the authorize URL via
// fetch (follows the 302 into our loopback listener) so the SDK's
// flow completes without a real browser.
function stubOpenExternalToAutoComplete(): void {
  vi.mocked(shell.openExternal).mockImplementation(async (urlStr: string) => {
    // Follow redirects so the fake's `/authorize` 302 lands at the
    // Dyad loopback callback listener on localhost:port/callback,
    // which resolves the pending flow with the code. The fetch's
    // response body (success HTML) is irrelevant.
    await fetch(urlStr, { redirect: "follow" });
  });
}

function seedRow(row: Partial<Row> & { id: number; url: string }): void {
  dbStore.set(row.id, {
    id: row.id,
    name: row.name ?? `srv${row.id}`,
    transport: row.transport ?? "http",
    url: row.url,
    oauthEnabled: row.oauthEnabled ?? true,
    oauthClientId: row.oauthClientId ?? null,
    oauthClientSecret: row.oauthClientSecret ?? null,
    oauthScope: row.oauthScope ?? null,
    oauthState: row.oauthState ?? null,
  });
}

// Pull the stored row's tokens out via the helper so tests aren't
// tied to the internal encryption scheme.
function rowIsConnected(id: number): boolean {
  return oauthStateHasTokens(dbStore.get(id)?.oauthState ?? null);
}

// Each describe block spawns a differently-configured fake server.
// `env` is the per-block config (FAKE_DCR / FAKE_CLIENT_ID / etc.);
// `port` is the SERVER_PORT constant for that block. Registers the
// standard beforeAll/afterAll/beforeEach hooks for the surrounding
// describe and returns the base URL.
function setupFakeServer(
  env: Record<string, string>,
  port: number,
): { base: string } {
  let child: ChildProcess;
  const base = `http://localhost:${port}`;
  beforeAll(async () => {
    child = spawnFakeServer({ PORT: String(port), ...env });
    await waitForReady(base);
  }, 15000);
  afterAll(async () => {
    child?.kill();
    await new Promise((r) => setTimeout(r, 100));
  });
  beforeEach(() => {
    dbStore.clear();
    vi.clearAllMocks();
    stubOpenExternalToAutoComplete();
  });
  return { base };
}

describe("OAuth integration: DCR mode against fake server", () => {
  const { base } = setupFakeServer({ FAKE_DCR: "1" }, DCR_SERVER_PORT);

  it("runs the full DCR flow and lands access + refresh tokens in encrypted state", async () => {
    const serverId = 1;
    const callbackPort = await getAvailableCallbackPort();
    seedRow({ id: serverId, url: `${base}/mcp` });

    const result = await runOAuthFlow({ serverId, callbackPort });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    // oauthStateHasTokens flipping to true is what drives the
    // "OAuth: connected" UI badge -- the bug we fixed earlier.
    expect(rowIsConnected(serverId)).toBe(true);
    // Browser was "opened" exactly once (our stub) and the
    // authorize URL targeted the fake's authorize endpoint.
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
    const authorizeCall = vi.mocked(shell.openExternal).mock.calls[0]?.[0];
    expect(authorizeCall).toContain(`${base}/authorize`);
    expect(authorizeCall).toContain("code_challenge=");
    expect(authorizeCall).toContain("code_challenge_method=S256");
  });

  it("reuses persisted clientInformation on a second flow (skips a second /register)", async () => {
    // First flow registers a client via DCR; second flow against the
    // same row should not register again because clientInformation is
    // already persisted. We tee /register hits via a fetch wrapper.
    const serverId = 2;
    seedRow({ id: serverId, url: `${base}/mcp` });

    let registerHits = 0;
    const originalFetch = globalThis.fetch;
    const teeFetch: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/register")) registerHits += 1;
      return originalFetch(input, init);
    };
    globalThis.fetch = teeFetch;
    try {
      const first = await runOAuthFlow({
        serverId,
        callbackPort: await getAvailableCallbackPort(),
      });
      expect(first.success).toBe(true);
      expect(registerHits).toBe(1);

      // Invalidate tokens but keep clientInformation, then re-run.
      // (Mirrors the real-world "token expired, force a fresh flow"
      // path -- the SDK should reuse the persisted client_id.) Use
      // the provider's own invalidateCredentials path rather than
      // hand-parsing the encrypted blob -- keeps the test honest
      // about the storage format.
      const provider = new DyadOAuthClientProvider({ serverId });
      await provider.invalidateCredentials("tokens");

      const second = await runOAuthFlow({
        serverId,
        callbackPort: await getAvailableCallbackPort(),
      });
      expect(second.success).toBe(true);
      // Critical: the second flow must not have hit /register again
      // because clientInformation was already persisted from flow #1.
      expect(registerHits).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("OAuth integration: static client_id mode against fake server", () => {
  const STATIC_ID = "test-static-app-001";
  const { base } = setupFakeServer(
    { FAKE_DCR: "0", FAKE_CLIENT_ID: STATIC_ID },
    STATIC_SERVER_PORT,
  );

  it("uses the pre-registered client_id (no /register hit) when DCR is disabled", async () => {
    const serverId = 1;
    seedRow({
      id: serverId,
      url: `${base}/mcp`,
      oauthClientId: STATIC_ID,
    });

    let registerHits = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/register")) registerHits += 1;
      return originalFetch(input, init);
    };
    try {
      const result = await runOAuthFlow({
        serverId,
        callbackPort: await getAvailableCallbackPort(),
      });
      expect(result.success).toBe(true);
      expect(rowIsConnected(serverId)).toBe(true);
      // Pre-registered path must skip DCR entirely. If the SDK
      // attempted /register against the fake's DCR-disabled server,
      // it would 404 and the flow would fail -- so this check is
      // double-strength.
      expect(registerHits).toBe(0);
      // Verify the authorize URL actually carried our static id.
      const authorizeCall = vi.mocked(shell.openExternal).mock.calls[0]?.[0];
      expect(authorizeCall).toContain(`client_id=${STATIC_ID}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("OAuth integration: refresh-token rotation against fake server", () => {
  // Short TTL forces the SDK's silent-refresh path on the second
  // `auth()` call. Refresh rotation (old refresh_token dies, new one
  // is issued) is verified by checking the stored token blob between
  // the two flows.
  const { base } = setupFakeServer(
    { FAKE_DCR: "1", FAKE_TOKEN_TTL_SEC: "1" },
    REFRESH_SERVER_PORT,
  );

  it("silently refreshes when tokens have expired (no second browser open)", async () => {
    const serverId = 1;
    seedRow({ id: serverId, url: `${base}/mcp` });

    // First flow: real PKCE redirect path, tokens land.
    const first = await runOAuthFlow({
      serverId,
      callbackPort: await getAvailableCallbackPort(),
    });
    expect(first.success).toBe(true);
    const initialState = dbStore.get(serverId)!.oauthState;
    expect(initialState).toBeTruthy();
    // One browser-open call for the initial flow.
    expect(shell.openExternal).toHaveBeenCalledTimes(1);

    // Wait past TTL so the access token is genuinely expired.
    await new Promise((r) => setTimeout(r, 1500));

    // Second flow: SDK detects expired access_token, hits /token
    // with grant_type=refresh_token, rotates tokens, returns
    // 'AUTHORIZED' without ever calling redirectToAuthorization.
    const second = await runOAuthFlow({
      serverId,
      callbackPort: await getAvailableCallbackPort(),
    });
    expect(second.success).toBe(true);
    // Critical: refresh must not have opened a second browser. If
    // this assertion ever fails, the SDK is no longer driving the
    // refresh grant and the user would see a surprise consent
    // prompt every time their token expired.
    expect(shell.openExternal).toHaveBeenCalledTimes(1);

    // Stored token blob must have changed -- if refresh rotation
    // worked, both access_token and refresh_token are new values.
    const refreshedState = dbStore.get(serverId)!.oauthState;
    expect(refreshedState).not.toBe(initialState);
    expect(rowIsConnected(serverId)).toBe(true);
  });
});

describe("OAuth integration: confidential client (client_secret) against fake server", () => {
  // Mirrors the real-world GitHub OAuth App / Spotify / Reddit case:
  // a pre-registered client_id PLUS a pre-registered client_secret
  // are required at the token exchange. The fake server is launched
  // with both FAKE_CLIENT_ID and FAKE_CLIENT_SECRET; the row seeds
  // the encrypted secret in the DB; Dyad decrypts it just-in-time
  // and the SDK posts both id + secret to /token via the
  // `client_secret_post` auth method.
  const STATIC_ID = "confidential-app-001";
  const STATIC_SECRET = "supersecret-007";
  const { base } = setupFakeServer(
    {
      FAKE_DCR: "0",
      FAKE_CLIENT_ID: STATIC_ID,
      FAKE_CLIENT_SECRET: STATIC_SECRET,
    },
    CONFIDENTIAL_SERVER_PORT,
  );

  it("sends client_id + client_secret on token exchange and lands tokens (confidential client path)", async () => {
    const serverId = 1;
    seedRow({
      id: serverId,
      url: `${base}/mcp`,
      oauthClientId: STATIC_ID,
      // Mirror the real persistence path: the column stores the
      // ENCRYPTED blob (not plaintext). The flow decrypts it before
      // handing to the provider, just like a row written through the
      // real handler.
      oauthClientSecret: encryptToString(STATIC_SECRET),
    });

    const result = await runOAuthFlow({
      serverId,
      callbackPort: await getAvailableCallbackPort(),
    });
    // Success here is the load-bearing assertion: the fake /token
    // rejects with `invalid_client` unless client_secret matches
    // exactly, so tokens landing means our wiring passed the secret
    // through correctly end-to-end.
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(rowIsConnected(serverId)).toBe(true);
  });

  it("fails (invalid_client) when the stored secret doesn't match what the server expects", async () => {
    const serverId = 2;
    seedRow({
      id: serverId,
      url: `${base}/mcp`,
      oauthClientId: STATIC_ID,
      oauthClientSecret: encryptToString("wrong-secret"),
    });

    const result = await runOAuthFlow({
      serverId,
      callbackPort: await getAvailableCallbackPort(),
    });
    expect(result.success).toBe(false);
    // No tokens persisted on a failed exchange.
    expect(rowIsConnected(serverId)).toBe(false);
  });
});

describe("OAuth integration: scope passthrough against fake server", () => {
  // Fake server is configured with FAKE_REQUIRED_SCOPE; its /authorize
  // returns 400 unless the client requests that scope. So a successful
  // flow here proves the row's `oauthScope` flows through to the
  // authorize URL the SDK builds.
  const REQUIRED_SCOPE = "read";
  const { base } = setupFakeServer(
    { FAKE_DCR: "1", FAKE_REQUIRED_SCOPE: REQUIRED_SCOPE },
    SCOPE_SERVER_PORT,
  );

  it("threads the row's oauthScope through to the authorize URL", async () => {
    const serverId = 1;
    seedRow({
      id: serverId,
      url: `${base}/mcp`,
      oauthScope: REQUIRED_SCOPE,
    });

    const result = await runOAuthFlow({
      serverId,
      callbackPort: await getAvailableCallbackPort(),
    });

    // Success here is load-bearing: the fake's /authorize 400s when
    // the required scope is missing, so reaching tokens means we
    // actually sent `scope=read` in the URL.
    expect(result.success).toBe(true);
    expect(rowIsConnected(serverId)).toBe(true);
    const authorizeCall = vi.mocked(shell.openExternal).mock.calls[0]?.[0];
    expect(authorizeCall).toContain(`scope=${REQUIRED_SCOPE}`);
  });
});
