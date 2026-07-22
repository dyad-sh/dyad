import { describe, expect, it, vi } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import {
  createMcpOAuthRegistry,
  type McpOAuthListenerRequest,
} from "./registry";

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function createHarness() {
  const clock = createFakeClock();
  const bindings: McpOAuthListenerRequest[] = [];
  const closed: string[] = [];
  const registry = createMcpOAuthRegistry({
    clock,
    ids: createSequentialIdSource(),
    bindListener(request) {
      bindings.push(request);
      return {
        settled: Promise.resolve({
          boundHosts: ["127.0.0.1", "::1"],
          anyInUse: false,
        }),
        async close() {
          closed.push(request.flowId);
        },
      };
    },
    observer: undefined,
  });
  return { registry, clock, bindings, closed };
}

function connectRequest(
  serverId: number,
  authorize = vi.fn(async () => "REDIRECT" as const),
) {
  return {
    port: 53682,
    serverId,
    expectedState: `state-${serverId}`,
    authorize,
    onAbort: vi.fn(),
  };
}

describe("MCP OAuth registry", () => {
  it("keeps exactly the third flow after three rapid Connect attempts", async () => {
    let releaseClose!: () => void;
    const closeBarrier = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const bindings: McpOAuthListenerRequest[] = [];
    const registry = createMcpOAuthRegistry({
      clock: createFakeClock(),
      ids: createSequentialIdSource(),
      bindListener(request) {
        bindings.push(request);
        return {
          settled: Promise.resolve({
            boundHosts: ["127.0.0.1"],
            anyInUse: false,
          }),
          close: () =>
            request.flowId === "mcp-oauth:1" ? closeBarrier : Promise.resolve(),
        };
      },
      observer: undefined,
    });
    const firstRequest = connectRequest(1);
    const secondRequest = connectRequest(2);
    const thirdRequest = connectRequest(3);

    const first = registry.connect(firstRequest);
    await flush();
    expect(registry.getState(53682).status).toBe("awaitingCallback");

    const second = registry.connect(secondRequest);
    const third = registry.connect(thirdRequest);
    await flush();

    await expect(first).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/superseded/i),
    });
    await expect(second).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/superseded/i),
    });
    expect(firstRequest.onAbort).toHaveBeenCalledOnce();
    expect(secondRequest.onAbort).toHaveBeenCalledOnce();
    expect(thirdRequest.onAbort).not.toHaveBeenCalled();
    expect(bindings).toHaveLength(1);
    expect(registry.getState(53682).status).toBe("superseding");

    releaseClose();
    await flush();
    expect(bindings).toHaveLength(2);
    expect(bindings[1].flowId).toBe("mcp-oauth:3");
    expect(registry.getState(53682)).toMatchObject({
      status: "awaitingCallback",
      flowId: "mcp-oauth:3",
    });

    registry.dispose();
    await expect(third).resolves.toMatchObject({ success: false });
  });

  it("makes timeout win over a later callback", async () => {
    const { registry, clock, bindings } = createHarness();
    const request = connectRequest(1);
    const result = registry.connect(request);
    await flush();

    clock.advanceBy(5 * 60_000);
    await expect(result).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/timed out/i),
    });
    expect(request.onAbort).toHaveBeenCalledOnce();
    expect(
      bindings[0].onCallback({ state: "state-1", code: "late-code" }),
    ).toEqual({ claimed: false, reason: "inactive" });
  });

  it("makes a claimed callback cancel the timeout and complete once", async () => {
    const { registry, clock, bindings } = createHarness();
    const authorize = vi
      .fn<(code?: string) => Promise<"AUTHORIZED" | "REDIRECT">>()
      .mockResolvedValueOnce("REDIRECT")
      .mockResolvedValueOnce("AUTHORIZED");
    const request = connectRequest(1, authorize);
    const result = registry.connect(request);
    await flush();

    expect(
      bindings[0].onCallback({ state: "state-1", code: "oauth-code" }),
    ).toEqual({ claimed: true });
    await flush();
    await expect(result).resolves.toEqual({ success: true, error: null });
    expect(authorize).toHaveBeenNthCalledWith(2, "oauth-code");
    expect(clock.pendingTimerCount()).toBe(0);

    clock.advanceBy(5 * 60_000);
    expect(request.onAbort).not.toHaveBeenCalled();
  });
});
