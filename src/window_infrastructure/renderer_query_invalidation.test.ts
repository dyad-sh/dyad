import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { coolifyContracts } from "@/ipc/types/coolify";
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

  it("publishes project creation so other windows see the new project", () => {
    const { publishes } = handled("createProject", { name: "x" });
    expect(publishes).toContain("coolify");
  });
});
