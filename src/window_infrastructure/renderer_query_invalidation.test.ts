import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import type { WindowSessionId } from "./types";
import { RendererQueryInvalidationConsumer } from "./renderer_query_invalidation";

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

  it("maps durable provider and MCP settlement scopes after reload recovery", () => {
    const invalidateQueries = vi.fn(() => Promise.resolve());
    const consumer = new RendererQueryInvalidationConsumer(
      { invalidateQueries },
      randomUUID() as WindowSessionId,
    );

    consumer.recover(
      9,
      [],
      [
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
