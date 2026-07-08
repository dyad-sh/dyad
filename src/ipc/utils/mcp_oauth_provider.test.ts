import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory store of `oauth_state` rows keyed by serverId. The mocked
// db's `update().set().where()` chain writes here; the mocked
// `select()` chain reads from here. Lets us exercise the real
// provider against a real DB-like surface without touching SQLite.
const dbStore = new Map<number, string | null>();

vi.mock("electron", () => ({
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`, "utf8")),
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

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => {
          const id = currentTargetId;
          return Promise.resolve([{ oauthState: dbStore.get(id) ?? null }]);
        },
      }),
    })),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          const id = currentTargetId;
          // Only track `oauth_state` writes here; other column
          // updates (e.g. `oauth_callback_port`) are ignored so they
          // don't clobber the test's view of the state row.
          if ("oauthState" in values) {
            dbStore.set(id, (values.oauthState as string | null) ?? null);
          }
          return Promise.resolve([]);
        },
      }),
    })),
  },
}));

vi.mock("@/db/schema", () => ({
  mcpServers: {
    id: "id",
    oauthState: "oauth_state",
    oauthCallbackPort: "oauth_callback_port",
  },
}));

// `eq()` from drizzle-orm normally returns a SQL fragment. The mocked
// db ignores it entirely, but `select().from().where(...)` still
// needs a value. Capture the serverId via a module-level pointer
// updated before each operation -- the provider always passes the
// same serverId to every query in a call chain, so this is safe.
let currentTargetId = 0;

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: number) => {
    currentTargetId = value;
    return { _col, value };
  },
}));

// Resolve electron mock so the provider's shell + safeStorage refs
// work; resolve the provider module after mocks are in place.
const electronImport = await import("electron");
const providerImport = await import("@/ipc/utils/mcp_oauth_provider");
const { DyadOAuthClientProvider, oauthStateHasTokens } = providerImport;
const { shell, safeStorage } = electronImport;

describe("DyadOAuthClientProvider", () => {
  beforeEach(() => {
    dbStore.clear();
    vi.clearAllMocks();
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  });

  it("computes redirectUrl from the configured callback port", () => {
    const p = new DyadOAuthClientProvider({
      serverId: 1,
      callbackPort: 12345,
    });
    expect(p.redirectUrl).toBe("http://localhost:12345/callback");
  });

  it("round-trips tokens through encrypted storage", async () => {
    const p = new DyadOAuthClientProvider({ serverId: 7 });
    expect(await p.tokens()).toBeUndefined();
    await p.saveTokens({
      access_token: "tok",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "rt",
    });
    const round = await p.tokens();
    expect(round).toEqual({
      access_token: "tok",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "rt",
    });
    // Storage went through encryptString — never the plaintext JSON.
    expect(safeStorage.encryptString).toHaveBeenCalled();
    const stored = dbStore.get(7);
    expect(stored).toBeDefined();
    expect(stored).not.toContain("tok");
  });

  it("seeds clientInformation from preregisteredClientId on first read", async () => {
    const p = new DyadOAuthClientProvider({
      serverId: 9,
      preregisteredClientId: "client-xyz",
    });
    const first = await p.clientInformation();
    expect(first?.client_id).toBe("client-xyz");
    // Seeded value is persisted so subsequent reads come from storage,
    // not from re-seeding (which would mask a saveClientInformation
    // call later overwriting it).
    expect(dbStore.get(9)).toBeDefined();
  });

  it("seeds client_secret alongside client_id when both are pre-registered (confidential client)", async () => {
    // GitHub OAuth Apps / Spotify / Reddit etc. require BOTH a
    // client_id and client_secret on the token exchange. The seeded
    // clientInformation must carry both so addClientAuthentication
    // can post them when the SDK builds the request.
    const p = new DyadOAuthClientProvider({
      serverId: 91,
      preregisteredClientId: "confidential-id",
      preregisteredClientSecret: "confidential-secret",
    });
    const info = await p.clientInformation();
    expect(info?.client_id).toBe("confidential-id");
    expect(info?.client_secret).toBe("confidential-secret");
  });

  it("emits clientMetadata.token_endpoint_auth_method matching the auth method actually used", async () => {
    // Aligns with `addClientAuthentication` below: Basic for
    // confidential clients (RFC 6749 §2.3.1), `none` for public.
    const publicProvider = new DyadOAuthClientProvider({
      serverId: 92,
      preregisteredClientId: "id-only",
    });
    expect(publicProvider.clientMetadata.token_endpoint_auth_method).toBe(
      "none",
    );

    const confidentialProvider = new DyadOAuthClientProvider({
      serverId: 93,
      preregisteredClientId: "id",
      preregisteredClientSecret: "sec",
    });
    expect(confidentialProvider.clientMetadata.token_endpoint_auth_method).toBe(
      "client_secret_basic",
    );
  });

  it("persists saveClientInformation and skips reseeding from preregistered id", async () => {
    const p = new DyadOAuthClientProvider({
      serverId: 11,
      preregisteredClientId: "from-config",
      allowInteractive: true,
    });
    await p.saveClientInformation({
      client_id: "from-dcr",
      client_secret: "secret",
    });
    const got = await p.clientInformation();
    expect(got?.client_id).toBe("from-dcr");
    expect(got?.client_secret).toBe("secret");
  });

  it("holds the PKCE code verifier in memory only and never on disk", async () => {
    const p = new DyadOAuthClientProvider({
      serverId: 3,
      allowInteractive: true,
    });
    await p.saveCodeVerifier("the-verifier");
    expect(await p.codeVerifier()).toBe("the-verifier");
    // Storage row must not contain the verifier — that's the whole
    // point of keeping PKCE verifiers in-memory.
    expect(dbStore.get(3) ?? "").not.toContain("the-verifier");
  });

  it("throws when codeVerifier is requested without a prior save", async () => {
    const p = new DyadOAuthClientProvider({ serverId: 4 });
    await expect(p.codeVerifier()).rejects.toThrow(
      /No PKCE code verifier in memory/,
    );
  });

  it("opens the system browser when redirectToAuthorization is called in an interactive provider", async () => {
    const p = new DyadOAuthClientProvider({
      serverId: 1,
      allowInteractive: true,
    });
    await p.redirectToAuthorization(
      new URL("https://example.com/authorize?foo=bar"),
    );
    expect(shell.openExternal).toHaveBeenCalledWith(
      "https://example.com/authorize?foo=bar",
    );
  });

  it("refuses to open the browser when allowInteractive is not set", async () => {
    // Background providers (built by `mcp_manager`) must throw here
    // instead of opening a browser whose redirect has nowhere to
    // land. The error propagates out and the row shows "not connected".
    const p = new DyadOAuthClientProvider({ serverId: 1 });
    await expect(
      p.redirectToAuthorization(new URL("https://example.com/authorize")),
    ).rejects.toThrow(/click Connect/);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  describe("addClientAuthentication", () => {
    it("uses Basic auth when token_endpoint_auth_method is client_secret_basic", async () => {
      const p = new DyadOAuthClientProvider({ serverId: 20 });
      await p.saveClientInformation({
        client_id: "cid",
        client_secret: "sec",
        // OAuthClientInformation does not type this field explicitly;
        // the SDK example reads it via a cast. We mirror that here.
        ...({ token_endpoint_auth_method: "client_secret_basic" } as object),
      } as Parameters<typeof p.saveClientInformation>[0]);
      const headers = new Headers();
      const params = new URLSearchParams();
      await p.addClientAuthentication(headers, params);
      const expected = "Basic " + Buffer.from("cid:sec").toString("base64");
      expect(headers.get("Authorization")).toBe(expected);
      expect(params.get("client_id")).toBeNull();
    });

    it("posts client_id + client_secret as body params for client_secret_post", async () => {
      const p = new DyadOAuthClientProvider({ serverId: 21 });
      await p.saveClientInformation({
        client_id: "cid",
        client_secret: "sec",
        ...({ token_endpoint_auth_method: "client_secret_post" } as object),
      } as Parameters<typeof p.saveClientInformation>[0]);
      const headers = new Headers();
      const params = new URLSearchParams();
      await p.addClientAuthentication(headers, params);
      expect(headers.get("Authorization")).toBeNull();
      expect(params.get("client_id")).toBe("cid");
      expect(params.get("client_secret")).toBe("sec");
    });

    it("uses public PKCE (no secret) when the client has no secret", async () => {
      const p = new DyadOAuthClientProvider({ serverId: 22 });
      await p.saveClientInformation({ client_id: "cid" });
      const headers = new Headers();
      const params = new URLSearchParams();
      await p.addClientAuthentication(headers, params);
      expect(headers.get("Authorization")).toBeNull();
      expect(params.get("client_id")).toBe("cid");
      expect(params.get("client_secret")).toBeNull();
    });

    it("works when invoked as a bare function reference (no `this` binding)", async () => {
      // The SDK passes `provider.addClientAuthentication` around as a
      // bare function value (e.g. `addClientAuthentication:
      // provider.addClientAuthentication`) and calls it without going
      // through the provider receiver. A normal method definition
      // would lose its binding here and crash trying to read
      // `this.clientInformation`. Arrow-function field binding keeps
      // `this` lexical, so the call still works.
      const p = new DyadOAuthClientProvider({ serverId: 23 });
      await p.saveClientInformation({ client_id: "cid" });
      const unbound = p.addClientAuthentication;
      const headers = new Headers();
      const params = new URLSearchParams();
      unbound(headers, params);
      expect(params.get("client_id")).toBe("cid");
    });

    it("honors token_endpoint_auth_methods_supported from metadata (Post-only server)", async () => {
      // Pre-registered confidential client against a server whose
      // discovery metadata declares only `client_secret_post`. Our
      // hook must pick Post over our usual Basic default; otherwise
      // the server rejects token exchange / refresh with
      // invalid_client.
      const p = new DyadOAuthClientProvider({
        serverId: 25,
        preregisteredClientId: "cid",
        preregisteredClientSecret: "sec",
      });
      // Trigger the seed-on-first-read path so cachedClientInformation
      // is populated (no `token_endpoint_auth_method` on it).
      await p.clientInformation();
      const headers = new Headers();
      const params = new URLSearchParams();
      p.addClientAuthentication(headers, params, "https://example.com", {
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
      expect(headers.get("Authorization")).toBeNull();
      expect(params.get("client_id")).toBe("cid");
      expect(params.get("client_secret")).toBe("sec");
    });

    it("honors token_endpoint_auth_methods_supported from metadata (Basic-only server)", async () => {
      const p = new DyadOAuthClientProvider({
        serverId: 26,
        preregisteredClientId: "cid",
        preregisteredClientSecret: "sec",
      });
      await p.clientInformation();
      const headers = new Headers();
      const params = new URLSearchParams();
      p.addClientAuthentication(headers, params, "https://example.com", {
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
      });
      const expected = "Basic " + Buffer.from("cid:sec").toString("base64");
      expect(headers.get("Authorization")).toBe(expected);
      expect(params.get("client_id")).toBeNull();
    });

    it("falls back to Basic when metadata is empty and no DCR method stashed", async () => {
      // No discovery metadata + pre-registered confidential client:
      // Basic is the safer default per spec, and matches the
      // historical behavior pre-metadata-aware fix.
      const p = new DyadOAuthClientProvider({
        serverId: 27,
        preregisteredClientId: "cid",
        preregisteredClientSecret: "sec",
      });
      await p.clientInformation();
      const headers = new Headers();
      const params = new URLSearchParams();
      p.addClientAuthentication(headers, params);
      const expected = "Basic " + Buffer.from("cid:sec").toString("base64");
      expect(headers.get("Authorization")).toBe(expected);
    });

    it("sets client_id synchronously (the SDK does not await this method)", async () => {
      // The SDK's `exchangeAuthorization` invokes
      // `addClientAuthentication(headers, params, url, metadata)`
      // without awaiting its return value, then immediately fires
      // the token-endpoint POST with `params` as the body. If our
      // method yielded on a DB read, the POST would go out before
      // `params.set("client_id", ...)` ran and the upstream OAuth
      // server would reject with `invalid_client`. This test models
      // that pattern: invoke without awaiting, then assert params
      // are populated before any microtask boundary.
      const p = new DyadOAuthClientProvider({ serverId: 24 });
      await p.saveClientInformation({ client_id: "sync-cid" });
      const headers = new Headers();
      const params = new URLSearchParams();
      // Note: no `await` -- mirrors the SDK's call site.
      p.addClientAuthentication(headers, params);
      expect(params.get("client_id")).toBe("sync-cid");
    });
  });

  describe("invalidateCredentials", () => {
    async function seedFull(serverId: number) {
      const p = new DyadOAuthClientProvider({
        serverId,
        allowInteractive: true,
      });
      await p.saveTokens({ access_token: "t", token_type: "Bearer" });
      await p.saveClientInformation({ client_id: "c" });
      await p.saveCodeVerifier("v");
      return p;
    }

    it("clears only tokens for scope=tokens", async () => {
      const p = await seedFull(30);
      await p.invalidateCredentials("tokens");
      expect(await p.tokens()).toBeUndefined();
      expect((await p.clientInformation())?.client_id).toBe("c");
      expect(await p.codeVerifier()).toBe("v");
    });

    it("clears everything for scope=all", async () => {
      const p = await seedFull(33);
      await p.invalidateCredentials("all");
      expect(await p.tokens()).toBeUndefined();
      expect(await p.clientInformation()).toBeUndefined();
      await expect(p.codeVerifier()).rejects.toThrow();
    });

    it("clears tokens on non-interactive scope=tokens (background invalid_grant recovery)", async () => {
      // A cached listTools probe / background refresh hits the SDK
      // with `allowInteractive: false`. When the refresh returns
      // `invalid_grant`, the SDK calls `invalidateCredentials("tokens")`.
      // If we no-op here, the stale tokens stay in oauth_state, the UI
      // keeps showing Connected, and every later probe repeats the
      // same dead refresh.
      const seeded = await seedFull(35);
      // Re-open with allowInteractive: false to model the background
      // probe path against the same persisted row.
      void seeded;
      const bg = new DyadOAuthClientProvider({
        serverId: 35,
        allowInteractive: false,
      });
      await bg.invalidateCredentials("tokens");
      expect(await bg.tokens()).toBeUndefined();
      // Client info must survive so the next interactive flow can
      // refresh without re-running DCR.
      expect((await bg.clientInformation())?.client_id).toBe("c");
    });

    it("skips scope=all when non-interactive (background can't drop client info)", async () => {
      const seeded = await seedFull(36);
      void seeded;
      const bg = new DyadOAuthClientProvider({
        serverId: 36,
        allowInteractive: false,
      });
      await bg.invalidateCredentials("all");
      // Tokens still present -- the scope=all branch is gated off for
      // non-interactive so the background path can't drop DCR client
      // info on the floor.
      expect((await bg.tokens())?.access_token).toBe("t");
      expect((await bg.clientInformation())?.client_id).toBe("c");
    });

    it("writes NULL to oauth_state after scope=all so the UI sees disconnected", async () => {
      // Critical for the Disconnect button: the UI derives the
      // "connected" badge from `oauth_state IS NOT NULL`. If
      // invalidateCredentials("all") writes back an encrypted empty
      // object, the column stays non-null and the Disconnect button
      // never goes back to Connect.
      const p = await seedFull(34);
      await p.invalidateCredentials("all");
      expect(dbStore.get(34)).toBeNull();
    });
  });

  describe("oauthStateHasTokens", () => {
    // The "OAuth: connected" badge derives from this helper. A
    // non-empty `oauth_state` isn't proof of a connection -- it can
    // hold just a registered client ID with no tokens yet.
    function encryptedBlobFor(payload: object): string {
      return Buffer.from(`enc:${JSON.stringify(payload)}`, "utf8").toString(
        "base64",
      );
    }

    it("returns false for null input", () => {
      expect(oauthStateHasTokens(null)).toBe(false);
    });

    it("returns false when state has only clientInformation (the toggle-enabled bug)", () => {
      const stored = encryptedBlobFor({
        clientInformation: { client_id: "from-dcr" },
      });
      expect(oauthStateHasTokens(stored)).toBe(false);
    });

    it("returns true when state has tokens with an access_token", () => {
      const stored = encryptedBlobFor({
        tokens: { access_token: "t", token_type: "Bearer" },
        clientInformation: { client_id: "cid" },
      });
      expect(oauthStateHasTokens(stored)).toBe(true);
    });

    it("returns false when the encrypted payload is not valid JSON", () => {
      const stored = Buffer.from("enc:not-json", "utf8").toString("base64");
      expect(oauthStateHasTokens(stored)).toBe(false);
    });

    it("returns false when safeStorage decryption fails", () => {
      // Simulate a state blob from a different machine / wiped
      // keychain -- decryptString throws, the helper must treat as
      // disconnected rather than crashing the listServers handler.
      vi.mocked(safeStorage.decryptString).mockImplementationOnce(() => {
        throw new Error("decrypt failed");
      });
      const stored = encryptedBlobFor({
        tokens: { access_token: "t", token_type: "Bearer" },
      });
      expect(oauthStateHasTokens(stored)).toBe(false);
    });

    it("works with the safeStorage-unavailable fallback (base64-only)", () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
      const stored = Buffer.from(
        JSON.stringify({ tokens: { access_token: "tok" } }),
        "utf8",
      ).toString("base64");
      expect(oauthStateHasTokens(stored)).toBe(true);
    });

    it("reads legacy untagged plaintext without invoking safeStorage", () => {
      const stored = Buffer.from(
        JSON.stringify({ tokens: { access_token: "tok" } }),
        "utf8",
      ).toString("base64");
      expect(oauthStateHasTokens(stored)).toBe(true);
      expect(safeStorage.decryptString).not.toHaveBeenCalled();
    });
  });

  it("falls back to base64-only storage when safeStorage encryption is unavailable", async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    const p = new DyadOAuthClientProvider({ serverId: 99 });
    await p.saveTokens({ access_token: "fallback-tok", token_type: "Bearer" });
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    // Round-trip still works (decrypt path also falls back).
    const got = await p.tokens();
    expect(got?.access_token).toBe("fallback-tok");
  });
});
