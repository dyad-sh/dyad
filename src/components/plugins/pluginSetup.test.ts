import { describe, expect, it } from "vitest";
import type { McpServer } from "@/ipc/types";
import type { CatalogInput } from "@/ipc/types/mcp_catalog";
import { serverNeedsSetup, unfilledOptionalInputs } from "./pluginSetup";

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 1,
    name: "Test Server",
    transport: "stdio",
    command: "npx",
    args: ["-y", "example@1.0.0"],
    envJson: null,
    headersJson: null,
    url: null,
    enabled: false,
    oauthEnabled: false,
    oauthConnected: false,
    oauthCallbackPort: null,
    oauthClientId: null,
    envUnreadable: false,
    headersUnreadable: false,
    catalogSlug: "test",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

const token: CatalogInput = { kind: "env", name: "API_TOKEN", label: "Token" };
const accountId: CatalogInput = {
  kind: "env",
  name: "ACCOUNT_ID",
  label: "Account ID",
  optional: true,
};
const vendoredClient: CatalogInput = {
  kind: "vendoredOAuthClient",
  clientId: "vendored-id",
};

describe("serverNeedsSetup", () => {
  it("needs setup while a required input is unfilled", () => {
    expect(serverNeedsSetup(makeServer(), [token, accountId])).toBe(true);
  });

  it("is satisfied once the required inputs are filled, optional ones aside", () => {
    const server = makeServer({ envJson: { API_TOKEN: "tok" } });
    expect(serverNeedsSetup(server, [token, accountId])).toBe(false);
  });

  it("never needs setup for a catalog-supplied oauth client", () => {
    const server = makeServer({ transport: "http", oauthEnabled: true });
    expect(serverNeedsSetup(server, [vendoredClient])).toBe(false);
  });

  it("never needs setup for optional-only inputs", () => {
    expect(serverNeedsSetup(makeServer(), [accountId])).toBe(false);
  });
});

describe("unfilledOptionalInputs", () => {
  it("returns only optional inputs that have no saved value", () => {
    const server = makeServer({ envJson: { API_TOKEN: "tok" } });
    expect(unfilledOptionalInputs(server, [token, accountId])).toEqual([
      accountId,
    ]);
  });

  it("drops an optional input once it has a value", () => {
    const server = makeServer({
      envJson: { API_TOKEN: "tok", ACCOUNT_ID: "123" },
    });
    expect(unfilledOptionalInputs(server, [token, accountId])).toEqual([]);
  });
});
