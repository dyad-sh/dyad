import { describe, expect, it } from "vitest";
import type { McpServer } from "@/ipc/types";
import type { McpCatalogEntry } from "@/ipc/types/mcp_catalog";
import { catalogCardStatus } from "./catalogCardStatus";

function entryOf(overrides: Partial<McpCatalogEntry> = {}): McpCatalogEntry {
  return {
    slug: "example",
    name: "Example",
    transport: "http",
    url: "https://mcp.example.com/mcp",
    ...overrides,
  } as McpCatalogEntry;
}

function serverOf(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 1,
    name: "Example",
    transport: "http",
    command: null,
    args: null,
    envJson: null,
    headersJson: null,
    url: "https://mcp.example.com/mcp",
    enabled: true,
    oauthEnabled: false,
    oauthConnected: false,
    oauthCallbackPort: null,
    oauthClientId: null,
    envUnreadable: false,
    headersUnreadable: false,
    catalogSlug: "example",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function statusFor({
  entry = entryOf(),
  server,
  added = true,
  connectingServerId = null,
}: {
  entry?: McpCatalogEntry;
  server?: McpServer;
  added?: boolean;
  connectingServerId?: number | null;
} = {}) {
  return catalogCardStatus({
    entry,
    addedSlugs: new Set(added ? [entry.slug] : []),
    serverBySlug: new Map(server ? [[entry.slug, server]] : []),
    connectingServerId,
  });
}

describe("catalogCardStatus", () => {
  it("offers Add for an entry that isn't added", () => {
    expect(statusFor({ added: false })).toBe("not-added");
  });

  it("reports added while the server row hasn't arrived yet", () => {
    expect(statusFor({ server: undefined })).toBe("added");
  });

  it("reports a connect in flight", () => {
    expect(
      statusFor({
        entry: entryOf({ oauth: { required: true } }),
        server: serverOf({ oauthEnabled: true }),
        connectingServerId: 1,
      }),
    ).toBe("connecting");
  });

  it("reports a required-OAuth server that hasn't connected", () => {
    expect(
      statusFor({
        entry: entryOf({ oauth: { required: true } }),
        server: serverOf({ oauthEnabled: true, oauthConnected: false }),
      }),
    ).toBe("needs-connect");
  });

  it("reports a required-OAuth server that has connected", () => {
    expect(
      statusFor({
        entry: entryOf({ oauth: { required: true } }),
        server: serverOf({ oauthEnabled: true, oauthConnected: true }),
      }),
    ).toBe("added");
  });

  // Optional OAuth is enabled on the row but never auto-connected, so
  // it would otherwise look permanently broken despite working.
  it("does not flag optional OAuth as not connected", () => {
    expect(
      statusFor({
        entry: entryOf({ oauth: { required: false } }),
        server: serverOf({ oauthEnabled: true, oauthConnected: false }),
      }),
    ).toBe("added");
  });

  it("does not flag a plain http entry as not connected", () => {
    expect(statusFor({ server: serverOf() })).toBe("added");
  });

  it("does not flag an stdio entry as not connected", () => {
    expect(
      statusFor({
        entry: entryOf({
          transport: "stdio",
          command: "npx",
          args: ["-y", "pkg"],
        }),
        server: serverOf({ transport: "stdio", oauthEnabled: true }),
      }),
    ).toBe("added");
  });
});
