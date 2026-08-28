import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { coolifyContracts } from "@/ipc/types/coolify";
import { supabaseContracts } from "@/ipc/types/supabase";
import { coolifySetupContracts } from "@/ipc/types/coolify_setup";
import { queryInvalidationScopeKey, type WindowSessionId } from "./types";
import { RendererQueryInvalidationConsumer } from "./renderer_query_invalidation";

describe("queryInvalidationScopeKey", () => {
  it("tells two apps' coolify scopes apart", () => {
    // The key is what dedupes scopes and matches them against the ones the
    // origin window already handled. Keyed on the family alone, one app's
    // deploy finishing would swallow another's invalidation.
    expect(queryInvalidationScopeKey({ family: "coolify", appId: 1 })).not.toBe(
      queryInvalidationScopeKey({ family: "coolify", appId: 2 }),
    );
    expect(queryInvalidationScopeKey({ family: "coolify" })).toBe("coolify:*");
  });
});

describe("RendererQueryInvalidationConsumer", () => {
  it("dedupes epochs, defaults origin handling to empty, and recovers on gaps", () => {
    const invalidateQueries = vi.fn(() => Promise.resolve());
    const ownSession = randomUUID() as WindowSessionId;
    const consumer = new RendererQueryInvalidationConsumer(
      { invalidateQueries },
      ownSession,
    );

    consumer.consume({
      invalidations: [
        {
          epoch: 1,
          scopes: [{ family: "apps" }],
          originWindowSessionId: ownSession,
        },
      ],
      recoveryScopes: [{ family: "apps" }, { family: "chats" }],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.apps.all,
    });

    consumer.consume({
      invalidations: [{ epoch: 3, scopes: [{ family: "apps" }] }],
      recoveryScopes: [{ family: "apps" }, { family: "chats" }],
    });
    const invalidatedKeys = (
      invalidateQueries.mock.calls as unknown as Array<
        [{ queryKey: readonly unknown[] }]
      >
    ).map(([filter]) => filter.queryKey);
    expect(invalidatedKeys).toEqual([
      queryKeys.apps.all,
      queryKeys.apps.all,
      queryKeys.chats.all,
      queryKeys.apps.all,
    ]);

    consumer.consume({
      invalidations: [{ epoch: 3, scopes: [{ family: "apps" }] }],
      recoveryScopes: [],
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(4);
  });

  it("invalidates only scopes that the origin did not handle locally", () => {
    const invalidateQueries = vi.fn(() => Promise.resolve());
    const ownSession = randomUUID() as WindowSessionId;
    const consumer = new RendererQueryInvalidationConsumer(
      { invalidateQueries },
      ownSession,
    );

    consumer.consume({
      invalidations: [
        {
          epoch: 1,
          scopes: [{ family: "apps" }, { family: "app", appId: 7 }],
          originWindowSessionId: ownSession,
          originHandledScopes: [{ family: "apps" }],
        },
      ],
      recoveryScopes: [],
    });

    expect(invalidateQueries).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.apps.detail({ appId: 7 }),
    });
  });

  it("maps durable completion, provider, and MCP scopes after reload recovery", () => {
    const invalidateQueries = vi.fn(() => Promise.resolve());
    const consumer = new RendererQueryInvalidationConsumer(
      { invalidateQueries },
      randomUUID() as WindowSessionId,
    );

    consumer.recover(
      9,
      [],
      [
        { family: "token-count" },
        { family: "user-budget" },
        { family: "free-agent-quota" },
        { family: "free-model-quota" },
        { family: "provider-status", provider: "neon" },
        { family: "mcp-servers" },
        { family: "mcp-catalog" },
        { family: "mcp-tools" },
      ],
    );

    const invalidatedKeys = (
      invalidateQueries.mock.calls as unknown as Array<
        [{ queryKey: readonly unknown[] }]
      >
    ).map(([filter]) => filter.queryKey);
    expect(invalidatedKeys).toEqual([
      queryKeys.tokenCount.all,
      queryKeys.userBudget.info,
      queryKeys.freeAgentQuota.status,
      queryKeys.freeModelQuota.status,
      queryKeys.settings.all,
      queryKeys.neon.all,
      queryKeys.mcp.servers,
      queryKeys.mcp.catalog,
      queryKeys.mcp.toolsByServer.all,
    ]);
  });

  it("maps app-scoped uncommitted-file invalidations", () => {
    const invalidateQueries = vi.fn(() => Promise.resolve());
    const consumer = new RendererQueryInvalidationConsumer(
      { invalidateQueries },
      randomUUID() as WindowSessionId,
    );

    consumer.consume({
      invalidations: [
        {
          epoch: 1,
          scopes: [{ family: "uncommitted-files", appId: 7 }],
        },
      ],
      recoveryScopes: [],
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.uncommittedFiles.byApp({ appId: 7 }),
    });
  });
});

/**
 * What the Coolify contracts claim to have handled locally.
 *
 * The hook invalidates the coolify scope in each mutation's onSuccess, so
 * without a claim the acting window does it twice — and invalidateQueries
 * cancels the in-flight refetch, so the duplicate is a second round trip to
 * the user's own server. Claiming too much is the opposite failure: `apps` is
 * not repeated locally, so suppressing it would leave that window stale.
 */
describe("Coolify contracts and the window that acted", () => {
  const handled = (channel: keyof typeof coolifyContracts, input: unknown) => {
    const contract = coolifyContracts[channel] as {
      originHandles?: (input: unknown) => Array<{ family: string }>;
      invalidates?: (input: unknown) => Array<{ family: string }>;
    };
    return {
      claims: (contract.originHandles?.(input) ?? []).map((s) => s.family),
      publishes: (contract.invalidates?.(input) ?? []).map((s) => s.family),
    };
  };

  it("claims the coolify scope it refreshes itself", () => {
    for (const [channel, input] of [
      ["saveToken", undefined],
      ["clearToken", undefined],
      ["saveConnection", { appId: 1 }],
      ["disconnect", { appId: 1 }],
      ["createProject", { name: "x" }],
    ] as const) {
      const { claims } = handled(channel, input);
      expect(claims, `${channel} should claim coolify`).toContain("coolify");
    }
  });

  it("never claims a scope it does not refresh itself", () => {
    // The hook only ever invalidates coolify keys, so `apps` and `app` must
    // still reach the acting window through the published invalidation.
    for (const [channel, input] of [
      ["saveToken", undefined],
      ["clearToken", undefined],
      ["saveConnection", { appId: 1 }],
      ["disconnect", { appId: 1 }],
    ] as const) {
      const { claims } = handled(channel, input);
      expect(claims, `${channel} must not claim apps`).not.toContain("apps");
      expect(claims, `${channel} must not claim app`).not.toContain("app");
    }
  });

  it("lets the installer decide when its own window refreshes", () => {
    // coolify-setup:run stores a token, which makes every app read as
    // connected — so the panel that ran the install would be unmounted by its
    // own invalidation, taking with it the screen that says the server ended
    // up unencrypted. The panel refreshes coolify itself, when it is ready.
    const contract = coolifySetupContracts.run as {
      originHandles?: (input: unknown) => Array<{ family: string }>;
      invalidates?: (input: unknown) => Array<{ family: string }>;
    };
    const claims = (contract.originHandles?.({}) ?? []).map((s) => s.family);
    const publishes = (contract.invalidates?.({}) ?? []).map((s) => s.family);

    expect(claims).toContain("coolify");
    // Not apps: nothing repeats that locally, so it must still arrive.
    expect(claims).not.toContain("apps");
    expect(publishes).toContain("apps");
    expect(publishes).toContain("coolify");

    // There is no second publisher to worry about any more: a window that
    // wants to see a run in progress asks for the snapshot rather than
    // pressing Install again, so every run is published by the one window
    // that started it.
  });

  it("tells other windows when an unencrypted token is kept", () => {
    // The same write saveToken makes: it is what turns every app connected.
    // Without it a second window that watched the install finish goes on
    // offering to set a server up, and pressing Install there is refused for
    // holding an account it does not know about.
    const contract = coolifySetupContracts.acceptInsecureToken as {
      originHandles?: (input: unknown) => Array<{ family: string }>;
      invalidates?: (input: unknown) => Array<{ family: string }>;
    };
    const claims = (contract.originHandles?.(undefined) ?? []).map(
      (s) => s.family,
    );
    const publishes = (contract.invalidates?.(undefined) ?? []).map(
      (s) => s.family,
    );

    expect(publishes).toContain("apps");
    expect(publishes).toContain("coolify");
    // As with run: the finished screen refreshes coolify on its own way out,
    // in the order it needs, so it is not handed back mid-write.
    expect(claims).toContain("coolify");
    expect(claims).not.toContain("apps");
  });

  it("publishes project creation so other windows see the new project", () => {
    const { publishes } = handled("createProject", { name: "x" });
    expect(publishes).toContain("coolify");
  });
});

/**
 * What the Supabase create contract publishes and claims.
 *
 * Creating a project adds an entry to the project list, which peer windows
 * render in their selector, so the provider scope has to be published. The
 * acting window refreshes the same keys in the mutation's own onSuccess, so it
 * claims them back — otherwise it refetches the list a second time and cancels
 * the one already in flight.
 */
describe("Supabase create-project invalidation", () => {
  const scopes = (
    pick: (contract: {
      originHandles?: (input: unknown) => Array<{ family: string }>;
      invalidates?: (input: unknown) => Array<{ family: string }>;
    }) => Array<{ family: string }> | undefined,
  ) =>
    (
      pick(supabaseContracts.createProject as Parameters<typeof pick>[0]) ?? []
    ).map((scope) => scope.family);

  it("publishes the provider scope so peers see the new project", () => {
    expect(scopes((c) => c.invalidates?.({ appId: 7 }))).toContain(
      "provider-status",
    );
  });

  it("claims back what the mutation already refreshes locally", () => {
    expect(scopes((c) => c.originHandles?.({ appId: 7 }))).toContain(
      "provider-status",
    );
  });

  // Repointing an app changes that app, so peer windows have to hear about it —
  // but not the project list, which is unchanged. Asserting the absence alone
  // would pass just as well if the declaration were deleted outright.
  it("publishes the app scopes, and only those, when the link changes", () => {
    for (const [channel, input] of [
      ["setAppProject", { appId: 7 }],
      ["unsetAppProject", { app: 7 }],
    ] as const) {
      const contract = supabaseContracts[channel] as {
        invalidates?: (input: unknown) => Array<{
          family: string;
          appId?: number;
        }>;
      };
      const scopes = contract.invalidates?.(input) ?? [];

      // Counted as well as matched: "only those" has to mean it, or a scope
      // added by accident — the project list among them — would pass unnoticed.
      // Not an ordered comparison, because order carries nothing downstream.
      expect(scopes, `${channel}`).toHaveLength(2);
      expect(scopes, `${channel}`).toEqual(
        expect.arrayContaining([
          { family: "apps" },
          { family: "app", appId: 7 },
        ]),
      );
    }
  });
});
