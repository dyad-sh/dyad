// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  entries: [] as unknown[],
  update: vi.fn(),
  revoke: vi.fn(),
  applyClientChange: vi.fn(),
  storedClient: undefined as Record<string, unknown> | undefined,
}));

vi.mock("../../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [mocks.row] }) }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => mocks.update(values),
      }),
    }),
  },
}));

vi.mock("../../db/schema", () => ({ mcpServers: { id: "id" } }));

vi.mock("drizzle-orm", () => ({ eq: (_c: unknown, v: number) => v }));

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

  it("skips a server with oauth turned off", async () => {
    mocks.row.oauthEnabled = false;
    expect(await syncVendoredOAuthClient(1)).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
