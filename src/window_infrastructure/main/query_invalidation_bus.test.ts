import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { QueryInvalidationBatch, WindowSessionId } from "../types";
import { QueryInvalidationBus } from "./query_invalidation_bus";
import { WindowRegistry, type WindowEndpoint } from "./window_registry";

function endpoint(id: number): WindowEndpoint {
  return {
    id,
    isDestroyed: () => false,
    send: vi.fn(),
  };
}

describe("QueryInvalidationBus", () => {
  it("uses one global epoch, batches delivery, and returns missed events", () => {
    const registry = new WindowRegistry();
    const renderer = endpoint(1);
    const sessionId = randomUUID() as WindowSessionId;
    registry.register(renderer, sessionId);
    const bus = new QueryInvalidationBus(registry, 1_000, 2);

    expect(bus.publish([{ family: "apps" }], { originWebContentsId: 1 })).toBe(
      1,
    );
    expect(bus.publish([{ family: "chats" }, { family: "chats" }])).toBe(2);
    bus.flush();

    const batch = vi.mocked(renderer.send).mock
      .calls[0][1] as QueryInvalidationBatch;
    expect(batch.invalidations).toEqual([
      {
        epoch: 1,
        scopes: [{ family: "apps" }],
        originWindowSessionId: sessionId,
        originHandledScopes: [],
      },
      {
        epoch: 2,
        scopes: [{ family: "chats" }],
        originWindowSessionId: undefined,
        originHandledScopes: undefined,
      },
    ]);
    expect(bus.synchronize(1).invalidations).toEqual([
      { epoch: 2, scopes: [{ family: "chats" }] },
    ]);

    bus.publish([{ family: "app-collections" }]);
    expect(bus.synchronize(0)).toMatchObject({
      currentEpoch: 3,
      invalidations: [],
      recoveryScopes: [
        { family: "apps" },
        { family: "chats" },
        { family: "app-collections" },
      ],
    });
  });

  it("keeps gap-recovery history bounded by compacting entity scopes", () => {
    const registry = new WindowRegistry();
    const bus = new QueryInvalidationBus(registry, 1_000, 1);

    bus.publish([{ family: "app", appId: 1 }]);
    bus.publish([{ family: "app", appId: 2 }]);
    bus.publish([{ family: "chat", chatId: 1 }]);
    bus.publish([{ family: "versions", appId: 1 }]);
    bus.publish([{ family: "versions", appId: 2 }]);
    bus.publish([{ family: "branches", appId: 1 }]);
    bus.publish([{ family: "problems", appId: 1 }]);
    bus.publish([{ family: "uncommitted-files", appId: 1 }]);

    expect(bus.synchronize(0).recoveryScopes).toEqual([
      { family: "apps" },
      { family: "chats" },
      { family: "versions" },
      { family: "branches" },
      { family: "problems" },
      { family: "uncommitted-files" },
    ]);
  });
});
