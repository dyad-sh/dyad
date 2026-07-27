import { describe, expect, it, vi } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { createConnectionFlowRegistry } from "./registry";

function setup() {
  const clock = createFakeClock();
  const onUnsolicitedReturn = vi.fn();
  const registry = createConnectionFlowRegistry({
    clock,
    ids: createSequentialIdSource(),
    onUnsolicitedReturn,
    observer: undefined,
  });
  return { registry, clock, onUnsolicitedReturn };
}

function admittedStart(
  registry: ReturnType<typeof createConnectionFlowRegistry>,
  provider: "github" | "neon" | "supabase",
  expectedRevision = registry.getState(provider).revision,
) {
  const result = registry.start(provider, expectedRevision);
  expect(result.admitted).toBe(true);
  if (!result.admitted) throw new Error("expected admitted start");
  return result;
}

describe("connection flow registry", () => {
  it("mints typed refs through IdSource and completes without a renderer barrier", () => {
    const { registry } = setup();
    const started = admittedStart(registry, "neon");
    expect(started.invocationRef).toEqual({
      kind: "connection-flow",
      entityKey: "neon",
      operationId: "connection-flow:1",
    });

    expect(registry.markPrepared("neon", started.invocationRef)).toBe(true);
    expect(registry.claimReturn("neon")).toEqual({
      claimed: true,
      invocationRef: started.invocationRef,
    });
    expect(registry.completeTokenExchange("neon", started.invocationRef)).toBe(
      true,
    );
    expect(registry.getState("neon")).toMatchObject({
      status: "connected",
      revision: 4,
      invocationRef: started.invocationRef,
    });
  });

  it("revision-checks starts from two windows", () => {
    const { registry } = setup();
    const windowARevision = registry.getState("github").revision;
    const windowBRevision = windowARevision;

    const first = registry.start("github", windowARevision);
    expect(first.admitted).toBe(true);
    const stale = registry.start("github", windowBRevision);
    expect(stale).toMatchObject({
      admitted: false,
      reason: "stale-revision",
      state: { status: "starting", revision: 1 },
    });
  });

  it("requires the exact typed ref for stale two-window cancellation", () => {
    const { registry } = setup();
    const first = admittedStart(registry, "github");
    registry.cancel("github", first.invocationRef);
    registry.acknowledge(
      "github",
      first.invocationRef,
      registry.getState("github").revision,
    );
    const second = admittedStart(registry, "github");

    expect(registry.cancel("github", first.invocationRef)).toBe(false);
    expect(registry.getState("github")).toMatchObject({
      status: "starting",
      invocationRef: second.invocationRef,
    });
  });

  it("revision-checks acknowledgement as well as matching its ref", () => {
    const { registry } = setup();
    const started = admittedStart(registry, "supabase");
    registry.markPrepared("supabase", started.invocationRef);
    const claimed = registry.claimReturn("supabase");
    expect(claimed.claimed).toBe(true);
    registry.completeTokenExchange("supabase", started.invocationRef);
    const terminalRevision = registry.getState("supabase").revision;

    expect(
      registry.acknowledge(
        "supabase",
        started.invocationRef,
        terminalRevision - 1,
      ),
    ).toMatchObject({ admitted: false, reason: "stale-revision" });
    expect(
      registry.acknowledge("supabase", started.invocationRef, terminalRevision),
    ).toMatchObject({
      admitted: true,
      applied: true,
      state: { status: "disconnected", revision: terminalRevision + 1 },
    });
  });

  it("rejects a stale echo-capable claim without advancing the active flow", () => {
    const { registry } = setup();
    const first = admittedStart(registry, "github");
    registry.cancel("github", first.invocationRef);
    registry.acknowledge(
      "github",
      first.invocationRef,
      registry.getState("github").revision,
    );
    const second = admittedStart(registry, "github");
    registry.markPrepared("github", second.invocationRef);

    expect(registry.claimReturn("github", first.invocationRef)).toEqual({
      claimed: false,
    });
    expect(registry.getState("github")).toMatchObject({
      status: "awaiting-return",
      invocationRef: second.invocationRef,
    });
  });

  it("structurally claims deep-link returns that cannot echo the ref", () => {
    const { registry } = setup();
    const started = admittedStart(registry, "supabase");
    registry.markPrepared("supabase", started.invocationRef);

    expect(registry.claimReturn("supabase")).toEqual({
      claimed: true,
      invocationRef: started.invocationRef,
    });
  });

  it("defuses watchdogs and rejects late provider work after disposal", () => {
    const { registry, clock } = setup();
    const started = admittedStart(registry, "neon");
    registry.markPrepared("neon", started.invocationRef);
    expect(clock.pendingTimerCount()).toBe(1);

    registry.dispose();
    expect(clock.pendingTimerCount()).toBe(0);
    expect(registry.markPrepared("neon", started.invocationRef)).toBe(false);
    expect(registry.start("neon", 0)).toMatchObject({
      admitted: false,
      reason: "disposed",
    });
  });
});
