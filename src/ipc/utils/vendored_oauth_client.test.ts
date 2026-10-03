// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  entries: [] as unknown[],
  update: vi.fn(),
  revoke: vi.fn(),
  applyClientChange: vi.fn(),
  storedClient: undefined as Record<string, unknown> | undefined,
  updatedRows: [{ id: 1 }] as { id: number }[],
  updateWhere: undefined as unknown,
}));

vi.mock("../../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [mocks.row] }) }),
    update: () => ({
      set: (values: unknown) => ({
        where: (condition: unknown) => ({
          returning: async () => {
            mocks.update(values);
            mocks.updateWhere = condition;
            return mocks.updatedRows;
          },
        }),
      }),
    }),
  },
}));

vi.mock("../../db/schema", () => ({
  mcpServers: {
    id: "id",
    transport: "transport",
    oauthEnabled: "oauth_enabled",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
  and: (...parts: unknown[]) => parts,
}));

vi.mock("@/ipc/shared/remote_mcp_catalog", () => ({
  getRemoteMcpCatalog: async () => mocks.entries,
  peekRemoteMcpCatalog: () => mocks.entries,
}));

vi.mock("./mcp_oauth_provider", () => ({
  revokeMcpOAuthWriteAuthority: mocks.revoke,
  readStoredOAuthClient: async () => mocks.storedClient,
  applyOAuthClientChange: mocks.applyClientChange,
}));

vi.mock("./secret_storage", () => ({
  encryptToString: (plaintext: string) => `enc:${plaintext}`,
  decryptFromString: (stored: string) => stored.replace(/^enc:/, ""),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

const { syncVendoredOAuthClient } = await import("./vendored_oauth_client");

const catalogEntry = (clientSecret: string | undefined = "secret-1") => ({
  slug: "github",
  name: "GitHub",
  transport: "http",
  url: "https://example.com/mcp",
  oauth: { required: true },
  inputs: [
    {
      kind: "vendoredOAuthClient",
      clientId: "client-1",
      ...(clientSecret ? { clientSecret } : {}),
    },
  ],
});

describe("syncVendoredOAuthClient", () => {
  beforeEach(() => {
    mocks.update.mockReset();
    mocks.revoke.mockReset();
    mocks.applyClientChange.mockReset();
    mocks.storedClient = undefined;
    mocks.updatedRows = [{ id: 1 }];
    mocks.updateWhere = undefined;
    mocks.entries = [catalogEntry()];
    mocks.row = {
      id: 1,
      catalogSlug: "github",
      transport: "http",
      oauthEnabled: true,
      oauthClientId: null,
      oauthClientSecret: null,
    };
  });

  it("writes the catalog's client when the row has none", async () => {
    expect(await syncVendoredOAuthClient(1)).toBe(true);
    expect(mocks.revoke).toHaveBeenCalledWith(1);
    expect(mocks.update).toHaveBeenCalledWith({
      oauthClientId: "client-1",
      oauthClientSecret: "enc:secret-1",
    });
  });

  it("leaves a row that already matches alone", async () => {
    mocks.row.oauthClientId = "client-1";
    mocks.row.oauthClientSecret = "enc:secret-1";
    expect(await syncVendoredOAuthClient(1)).toBe(false);
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rewrites a stored client that disagrees with the catalog", async () => {
    // The stored client is sent in place of the columns, so it is stale on
    // its own even once the columns are current.
    mocks.row.oauthClientId = "client-1";
    mocks.row.oauthClientSecret = "enc:secret-1";
    mocks.storedClient = {
      client_id: "client-1",
      client_secret: "stale-secret",
    };
    expect(await syncVendoredOAuthClient(1)).toBe(true);
    expect(mocks.revoke).toHaveBeenCalledWith(1);
    expect(mocks.applyClientChange).toHaveBeenCalledWith(1, {
      clientId: "client-1",
      clientSecret: "secret-1",
      clientIdChanged: false,
    });
  });

  it("reports a changed client id so the old client's tokens go", async () => {
    mocks.row.oauthClientId = "old-client";
    mocks.row.oauthClientSecret = "enc:secret-1";
    expect(await syncVendoredOAuthClient(1)).toBe(true);
    expect(mocks.applyClientChange).toHaveBeenCalledWith(1, {
      clientId: "client-1",
      clientSecret: "secret-1",
      clientIdChanged: true,
    });
  });

  it("reports the fence when the write fails after it was raised", async () => {
    mocks.applyClientChange.mockRejectedValue(new Error("state write failed"));
    // The cached client can no longer persist tokens, so the caller still
    // has to drop it.
    expect(await syncVendoredOAuthClient(1)).toBe(true);
    expect(mocks.revoke).toHaveBeenCalledWith(1);
  });

  it("reports no change when it fails before fencing", async () => {
    mocks.entries = [];
    mocks.row.oauthClientId = "client-1";
    mocks.row.oauthClientSecret = "enc:secret-1";
    expect(await syncVendoredOAuthClient(1)).toBe(false);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("writes only while the row is still an http server using oauth", async () => {
    // An edit landing between the read and the write must not leave a client
    // on a server that no longer uses one.
    expect(await syncVendoredOAuthClient(1)).toBe(true);
    expect(mocks.updateWhere).toEqual([
      { column: "id", value: 1 },
      { column: "transport", value: "http" },
      { column: "oauth_enabled", value: true },
    ]);
  });

  it("leaves the stored state alone when oauth was turned off mid-sync", async () => {
    // The conditional write matches no row once OAuth is off, so the client
    // must not be put back on a server that no longer uses one.
    mocks.updatedRows = [];
    expect(await syncVendoredOAuthClient(1)).toBe(true);
    expect(mocks.applyClientChange).not.toHaveBeenCalled();
  });

  it("only fills in a missing client on the cached path", async () => {
    mocks.row.oauthClientId = "client-1";
    mocks.row.oauthClientSecret = "enc:stale";
    // A rotation here would fence an in-flight connect, so it waits for
    // Connect or a re-add.
    expect(await syncVendoredOAuthClient(1, { cachedOnly: true })).toBe(false);
    expect(mocks.revoke).not.toHaveBeenCalled();

    mocks.row.oauthClientId = null;
    expect(await syncVendoredOAuthClient(1, { cachedOnly: true })).toBe(true);
  });

  it("skips a server with oauth turned off", async () => {
    mocks.row.oauthEnabled = false;
    expect(await syncVendoredOAuthClient(1)).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
