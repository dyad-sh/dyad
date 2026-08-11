import { renderHook, waitFor, act } from "@testing-library/react";
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
      saveToken: vi.fn(async () => undefined),
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

describe("discovery across a token change on one instance", () => {
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

  /** Each entry's token slot paired with the server list it is holding. */
  function discoveryContents(client: QueryClient): string[][] {
    return discoveryEntries(client).map((q) => [
      (q.queryKey as string[])[3],
      (q.state.data as { servers: Array<{ name: string }> }).servers[0].name,
    ]);
  }

  it("caches under a key that changes with the token", async () => {
    // Asserted on the key itself rather than on what the query returns: the
    // whole point is that a list from one token can never be found by another,
    // and that is a property of the key, not of what happens to be cached.
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

    // Same instance, a different team's token, through the real mutation so
    // whatever it does on success is what is under test.
    backend.token = "team-b-token";
    backend.servers = [{ uuid: "srv-b", name: "team-b-server" }];
    await act(async () => {
      await result.current.saveToken.mutateAsync({
        instanceUrl: "https://coolify.test",
        token: "team-b-token",
        acknowledgedInsecure: false,
      });
    });

    await waitFor(() =>
      expect(result.current.discovery?.servers[0]?.name).toBe("team-b-server"),
    );

    // One entry, for the token in use. The outgoing token keeps none: the key
    // is read from status, which lags the write, so an entry left behind gets
    // refilled with the incoming token's list and served to whoever switches
    // back.
    expect(discoveryContents(client)).toEqual([
      ["fp-team-b-token", "team-b-server"],
    ]);
    expect(discoveryKeys(client).map((k) => k[3])).not.toContain(
      "fp-team-a-token",
    );
  });
});
