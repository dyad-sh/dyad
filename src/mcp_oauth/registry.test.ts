import { describe, expect, it, vi } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import type { IdSource } from "@/state_machines/clock";
import {
  createMcpOAuthRegistry,
  type McpOAuthListenerRequest,
} from "./registry";

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function createHarness(ids: IdSource = createSequentialIdSource()) {
  const clock = createFakeClock();
  const bindings: McpOAuthListenerRequest[] = [];
  const closed: string[] = [];
  const settled = vi.fn();
  const registry = createMcpOAuthRegistry({
    clock,
    ids,
    bindListener(request) {
      bindings.push(request);
      return {
        settled: Promise.resolve({
          boundHosts: ["127.0.0.1"],
          anyInUse: false,
        }),
        async close() {
          closed.push(request.invocationRef.operationId);
        },
      };
    },
    onSettled: settled,
    observer: undefined,
  });
  return { registry, clock, bindings, closed, settled };
}

function request(
  serverId: number,
  messageId = `message-${serverId}`,
  authorize: (code?: string) => Promise<"AUTHORIZED" | "REDIRECT"> = vi.fn(
    async () => "REDIRECT" as const,
  ),
  port = 53682,
) {
  return {
    port,
    serverId,
    rendererMessageId: messageId,
    expectedState: `state-${serverId}`,
    authorize,
    onAbort: vi.fn(),
  };
}

describe("MCP OAuth registry", () => {
  it("keeps the existing happy path with typed listener/callback correlation", async () => {
    const { registry, bindings, settled } = createHarness();
    const authorize = vi.fn(async (code?: string) =>
      code === undefined ? ("REDIRECT" as const) : ("AUTHORIZED" as const),
    );
    const connectRequest = request(7, "message-7", authorize);
    const result = registry.connect(connectRequest);
    await flush();
    expect(bindings).toHaveLength(1);

    const listener = bindings[0];
    expect(listener.invocationRef).toEqual({
      kind: "mcp-oauth",
      entityKey: 7,
      operationId: "mcp-oauth:1",
    });
    expect(
      listener.onCallback({
        invocationRef: listener.invocationRef,
        state: "state-7",
        code: "authorization-code",
      }),
    ).toMatchObject({ claimed: true });
    await flush();

    await expect(result).resolves.toEqual({ success: true, error: null });
    expect(connectRequest.authorize).toHaveBeenNthCalledWith(1);
    expect(connectRequest.authorize).toHaveBeenNthCalledWith(
      2,
      "authorization-code",
    );
    expect(settled).toHaveBeenCalledWith(7, listener.invocationRef, {
      success: true,
      error: null,
    });
  });

  it("deduplicates renderer retries by message ID without conflating the invocation ref", async () => {
    const { registry, bindings } = createHarness();
    const original = request(4, "stable-renderer-message");
    const retry = request(4, "stable-renderer-message");

    const first = registry.connect(original);
    const duplicate = registry.connect(retry);
    expect(duplicate).toBe(first);
    await flush();
    expect(bindings).toHaveLength(1);
    expect(retry.onAbort).not.toHaveBeenCalled();

    await registry.dispose();
    await expect(first).resolves.toMatchObject({ success: false });
  });

  it("never evicts unresolved renderer receipts", async () => {
    const { registry, bindings } = createHarness();
    const requests = Array.from({ length: 128 }, (_, index) =>
      request(index + 1, `pending-${index + 1}`, undefined, 40_000 + index),
    );
    const pending = requests.map((entry) => registry.connect(entry));
    await flush();
    expect(bindings).toHaveLength(128);

    const overflowRequest = request(999, "overflow", undefined, 50_000);
    await expect(registry.connect(overflowRequest)).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/too many/i),
    });
    expect(overflowRequest.onAbort).toHaveBeenCalledOnce();
    expect(registry.connect(requests[0])).toBe(pending[0]);
    expect(bindings).toHaveLength(128);

    await registry.dispose();
    await Promise.all(pending);
  });

  it("keys resources by the complete typed ref when operation IDs collide", async () => {
    const { registry, bindings } = createHarness({
      next: () => "collision",
    });
    const first = registry.connect(request(1, "first", undefined, 45_001));
    const second = registry.connect(request(2, "second", undefined, 45_002));
    await flush();

    expect(bindings).toHaveLength(2);
    expect(bindings.map((binding) => binding.invocationRef.entityKey)).toEqual([
      1, 2,
    ]);
    await registry.dispose();
    await expect(first).resolves.toMatchObject({ success: false });
    await expect(second).resolves.toMatchObject({ success: false });
  });

  it("preserves last-request-wins on a shared callback port", async () => {
    const { registry, bindings } = createHarness();
    const firstRequest = request(1, "first");
    const secondRequest = request(2, "second");
    const first = registry.connect(firstRequest);
    await flush();
    const second = registry.connect(secondRequest);
    await flush();

    await expect(first).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/superseded/i),
    });
    expect(firstRequest.onAbort).toHaveBeenCalledOnce();
    expect(bindings).toHaveLength(2);
    expect(bindings[1].invocationRef.entityKey).toBe(2);

    await registry.dispose();
    await expect(second).resolves.toMatchObject({ success: false });
  });

  it("cancels and settles a server while waiting for its callback", async () => {
    const { registry, closed } = createHarness();
    const connectRequest = request(11);
    const result = registry.connect(connectRequest);
    await flush();

    await registry.cancelServer(11, "server deleted");
    await expect(result).resolves.toEqual({
      success: false,
      error: "server deleted",
    });
    expect(connectRequest.onAbort).toHaveBeenCalledOnce();
    expect(closed).toEqual(["mcp-oauth:1"]);
  });

  it("keeps cancellation authoritative while token exchange is in flight", async () => {
    const { registry, bindings, settled } = createHarness();
    let finishExchange!: (value: "AUTHORIZED") => void;
    const exchange = new Promise<"AUTHORIZED">((resolve) => {
      finishExchange = resolve;
    });
    const authorize = vi.fn((code?: string) =>
      code === undefined ? Promise.resolve("REDIRECT" as const) : exchange,
    );
    const connectRequest = request(12, "exchange", authorize);
    const result = registry.connect(connectRequest);
    await flush();
    const listener = bindings[0];
    listener.onCallback({
      invocationRef: listener.invocationRef,
      state: "state-12",
      code: "code",
    });
    await flush();
    expect(registry.getState(53682).status).toBe("exchanging");

    await registry.cancelServer(12, "OAuth disabled");
    finishExchange("AUTHORIZED");
    await flush();
    await expect(result).resolves.toEqual({
      success: false,
      error: "OAuth disabled",
    });
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale typed callback without consuming the active flow", async () => {
    const { registry, bindings } = createHarness();
    const result = registry.connect(request(3));
    await flush();
    const active = bindings[0];
    const staleRef = { ...active.invocationRef, operationId: "stale" };

    expect(
      active.onCallback({
        invocationRef: staleRef,
        state: "state-3",
        code: "code",
      }),
    ).toEqual({ claimed: false, reason: "inactive" });
    expect(registry.getState(53682).status).toBe("awaitingCallback");

    await registry.dispose();
    await expect(result).resolves.toMatchObject({ success: false });
  });

  it("settles waiters and closes listeners during explicit disposal", async () => {
    const { registry, clock, closed } = createHarness();
    const result = registry.connect(request(9));
    await flush();
    expect(clock.pendingTimerCount()).toBe(1);

    await registry.dispose();
    expect(clock.pendingTimerCount()).toBe(0);
    expect(closed).toEqual(["mcp-oauth:1"]);
    await expect(result).resolves.toEqual({
      success: false,
      error: "OAuth flow registry disposed.",
    });
  });

  it("awaits an active authorization effect during explicit disposal", async () => {
    const { registry } = createHarness();
    let finishAuthorization!: (value: "REDIRECT") => void;
    const authorization = new Promise<"REDIRECT">((resolve) => {
      finishAuthorization = resolve;
    });
    const result = registry.connect(
      request(10, "deferred", () => authorization),
    );
    await flush();

    let disposed = false;
    const disposal = registry.dispose().then(() => {
      disposed = true;
    });
    await flush();
    expect(disposed).toBe(false);

    finishAuthorization("REDIRECT");
    await disposal;
    await expect(result).resolves.toMatchObject({ success: false });
  });
});
