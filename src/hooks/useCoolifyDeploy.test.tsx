import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/**
 * Which instance's — and which token's — servers and projects get shown.
 *
 * Discovery is cached, and the cache key is what decides whether a list from
 * one token can be handed to another. Invalidating after a token change does
 * not cover it: invalidation is not removal, so react-query serves the old
 * list for the whole refetch and keeps it for good if that refetch fails. Two
 * tokens on one Coolify can see entirely different teams, so a list carried
 * across lets the connection form pin an app to a server the new token cannot
 * even see.
 */

const backend = vi.hoisted(() => ({
  token: "team-a-token",
  servers: [{ uuid: "srv-a", name: "team-a-server" }],
  discoverFails: false,
  discoverCalls: 0,
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    coolify: {
      getStatus: vi.fn(async () => ({
        hasToken: true,
        // The fingerprint the handler derives; here it just tracks the token.
        tokenId: `fp-${backend.token}`,
        instanceUrl: "https://coolify.test",
        connection: null,
        appUrl: null,
        lastDeployedAt: null,
      })),
      getDeploySnapshot: vi.fn(async () => ({ type: "idle" })),
      discover: vi.fn(async () => {
        backend.discoverCalls++;
        if (backend.discoverFails) throw new Error("401 from the new token");
        return { servers: backend.servers, projects: [] };
      }),
    },
    events: { coolify: { onDeployStatus: () => () => {} } },
  },
}));

const { useCoolifyDeploy } = await import("./useCoolifyDeploy");

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("discovery is keyed by instance and token", () => {
  /**
   * The discovery keys that actually hold a list.
   *
   * The query is disabled until status says there is a token, and react-query
   * registers an entry for a disabled key too — so the cache also carries a
   * dataless "none" placeholder from the first render, which says nothing
   * about where lists get stored.
   */
  function discoveryEntries(client: QueryClient) {
    return client
      .getQueryCache()
      .findAll({ queryKey: ["coolify", "discovery"] })
      .filter((q) => q.state.data !== undefined);
  }

  function discoveryKeys(client: QueryClient): string[][] {
    return discoveryEntries(client).map((q) => q.queryKey as string[]);
  }

  it("keys a cached list by the token as well as the instance", async () => {
    // Asserted on the key rather than on what the query returns: one token's
    // list being unfindable by another is a property of the key, not of what
    // happens to be cached under it.
    backend.token = "team-a-token";
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useCoolifyDeploy(1), {
      wrapper: wrapper(client),
    });
    await waitFor(() =>
      expect(result.current.discovery?.servers[0]?.name).toBe("team-a-server"),
    );
    expect(discoveryKeys(client)).toEqual([
      ["coolify", "discovery", "https://coolify.test", "fp-team-a-token"],
    ]);
  });
});
