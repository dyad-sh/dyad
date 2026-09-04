import { describe, expect, it, vi } from "vitest";
import { createConnectionFlowRegistry } from "@/connection_flow/registry";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { runOAuthReturnExchange } from "./connection_flow_handlers";

vi.mock("electron", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  BrowserWindow: { getAllWindows: () => [] },
}));

function setupAwaitingFlow() {
  const registry = createConnectionFlowRegistry({
    clock: createFakeClock(),
    ids: createSequentialIdSource(),
    observer: undefined,
  });
  const started = registry.start("neon", 0);
  if (!started.admitted) throw new Error("expected admitted start");
  registry.markPrepared("neon", started.invocationRef);
  return { registry, invocationRef: started.invocationRef };
}

describe("OAuth return exchange", () => {
  it("does not write credentials for a mismatched callback", async () => {
    const { registry, invocationRef } = setupAwaitingFlow();
    const exchange = vi.fn();

    await expect(
      runOAuthReturnExchange(
        "neon",
        exchange,
        {
          expectedInvocationRef: {
            ...invocationRef,
            operationId: "connection-flow:stale",
          },
        },
        registry,
      ),
    ).resolves.toMatchObject({ ok: false, claimed: false });

    expect(exchange).not.toHaveBeenCalled();
    expect(registry.getState("neon")).toMatchObject({
      status: "awaiting-return",
      invocationRef,
    });
  });

  it("consumes a matching callback exactly once", async () => {
    const { registry, invocationRef } = setupAwaitingFlow();
    const exchange = vi.fn();

    await expect(
      runOAuthReturnExchange(
        "neon",
        exchange,
        { expectedInvocationRef: invocationRef },
        registry,
      ),
    ).resolves.toEqual({ ok: true, claimed: true });
    await expect(
      runOAuthReturnExchange(
        "neon",
        exchange,
        { expectedInvocationRef: invocationRef },
        registry,
      ),
    ).resolves.toMatchObject({ ok: false, claimed: false });

    expect(exchange).toHaveBeenCalledTimes(1);
  });
});
