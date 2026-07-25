import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import type { WindowSessionId } from "./types";
import { RendererQueryInvalidationConsumer } from "./renderer_query_invalidation";

describe("RendererQueryInvalidationConsumer", () => {
  it("dedupes epochs, skips the origin, and recovers conservatively on gaps", () => {
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
    expect(invalidateQueries).not.toHaveBeenCalled();

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
      queryKeys.chats.all,
      queryKeys.apps.all,
    ]);

    consumer.consume({
      invalidations: [{ epoch: 3, scopes: [{ family: "apps" }] }],
      recoveryScopes: [],
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
  });
});
