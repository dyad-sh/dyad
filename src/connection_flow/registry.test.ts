import { describe, expect, it, vi } from "vitest";

import {
  createConnectionFlowRegistry,
  DEFAULT_FLOW_TIMEOUTS_MS,
  type ConnectionFlowRegistryOptions,
} from "./registry";
import type { ConnectionFlowProvider, ConnectionFlowState } from "./state";

/**
 * Manual timer scheduler so tests control exactly when a flow timeout fires
 * (including firing "stale" timers that a real clearTimeout would have
 * defused, to prove the machine ignores them anyway).
 */
function createFakeScheduler() {
  let nextHandle = 1;
  const pending = new Map<number, { callback: () => void; ms: number }>();
  return {
    scheduleTimeout: (callback: () => void, ms: number) => {
      const handle = nextHandle++;
      pending.set(handle, { callback, ms });
      return handle;
    },
    clearScheduledTimeout: (handle: unknown) => {
      pending.delete(handle as number);
    },
    /** Fire and remove all currently pending timers. */
    fireAll() {
      const entries = [...pending.entries()];
      pending.clear();
      for (const [, entry] of entries) {
        entry.callback();
      }
    },
    get pendingCount() {
      return pending.size;
    },
    get pendingMs() {
      return [...pending.values()].map((entry) => entry.ms);
    },
  };
}

function setup(options: ConnectionFlowRegistryOptions = {}) {
  const scheduler = createFakeScheduler();
  const stateChanges: Array<{
    provider: ConnectionFlowProvider;
    state: ConnectionFlowState;
  }> = [];
  const unsolicited: ConnectionFlowProvider[] = [];
  const registry = createConnectionFlowRegistry({
    scheduleTimeout: scheduler.scheduleTimeout,
    clearScheduledTimeout: scheduler.clearScheduledTimeout,
    onStateChange: (provider, state) => {
      stateChanges.push({ provider, state });
    },
    onUnsolicitedReturn: (provider) => {
      unsolicited.push(provider);
    },
    ...options,
  });
  return { registry, scheduler, stateChanges, unsolicited };
}

function statusesFor(
  stateChanges: Array<{
    provider: ConnectionFlowProvider;
    state: ConnectionFlowState;
  }>,
  provider: ConnectionFlowProvider,
): string[] {
  return stateChanges
    .filter((change) => change.provider === provider)
    .map((change) => change.state.status);
}

describe("flow start", () => {
  it("allocates a flowId and reaches awaiting-return with a scheduled timeout", () => {
    const { registry, scheduler } = setup();
    const { flowId, started } = registry.start("neon");
    expect(started).toBe(true);
    expect(registry.getState("neon").status).toBe("starting");

    registry.markPrepared("neon", flowId);
    expect(registry.getState("neon").status).toBe("awaiting-return");
    expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.pendingMs).toEqual([DEFAULT_FLOW_TIMEOUTS_MS.neon]);
  });

  it("double-start is a no-op that returns the active flow", () => {
    const { registry, stateChanges, scheduler } = setup();
    const first = registry.start("neon");
    registry.markPrepared("neon", first.flowId);
    const broadcastsBefore = stateChanges.length;

    const second = registry.start("neon");
    expect(second.started).toBe(false);
    expect(second.flowId).toBe(first.flowId);
    // No broadcast, no orphaned timer from the second click.
    expect(stateChanges.length).toBe(broadcastsBefore);
    expect(scheduler.pendingCount).toBe(1);
  });

  it("does not block flows for other providers (per-provider guard)", () => {
    const { registry } = setup();
    const github = registry.start("github");
    expect(github.started).toBe(true);

    const neon = registry.start("neon");
    expect(neon.started).toBe(true);
    const supabase = registry.start("supabase");
    expect(supabase.started).toBe(true);

    expect(registry.getState("github").status).toBe("starting");
    expect(registry.getState("neon").status).toBe("starting");
    expect(registry.getState("supabase").status).toBe("starting");
  });

  it("schedules no registry timeout for github (device flow has its own expiry)", () => {
    const { registry, scheduler } = setup();
    const { flowId } = registry.start("github");
    registry.markPrepared("github", flowId, { userCode: "ABCD-1234" });
    expect(registry.getState("github").status).toBe("awaiting-return");
    expect(scheduler.pendingCount).toBe(0);
  });
});

describe("timeout vs return race", () => {
  it("Neon contradiction: after a timeout, a late return never produces connected", () => {
    const { registry, scheduler, stateChanges, unsolicited } = setup();
    const { flowId } = registry.start("neon");
    registry.markPrepared("neon", flowId);

    // The user leaves the browser open too long: timeout wins.
    scheduler.fireAll();
    expect(registry.getState("neon")).toMatchObject({
      status: "failed",
      reason: "timeout",
    });

    // The OAuth return arrives afterwards. Tokens still get written by the
    // caller, but the flow must NOT advance — it is unsolicited.
    const claim = registry.claimReturn("neon");
    expect(claim.claimed).toBe(false);
    registry.notifyUnsolicitedReturn("neon");

    expect(unsolicited).toEqual(["neon"]);
    const statuses = statusesFor(stateChanges, "neon");
    expect(statuses).toEqual(["starting", "awaiting-return", "failed"]);
    expect(statuses).not.toContain("connected");
  });

  it("return first: a stale timeout firing later is ignored", () => {
    const { registry, scheduler } = setup();
    const { flowId } = registry.start("neon");
    registry.markPrepared("neon", flowId);

    const claim = registry.claimReturn("neon");
    expect(claim).toEqual({ claimed: true, flowId });
    expect(registry.getState("neon").status).toBe("exchanging-token");

    // The pending timer was cleared on transition, but even if it had fired
    // (raced), the machine ignores it: simulate by firing everything left.
    scheduler.fireAll();
    expect(registry.getState("neon").status).toBe("exchanging-token");

    registry.completeTokenExchange("neon", flowId);
    expect(registry.getState("neon").status).toBe("loading-resources");
    registry.completeResourceLoad("neon", flowId);
    expect(registry.getState("neon").status).toBe("connected");
  });

  it("Supabase now times out too (previously it hung forever)", () => {
    const { registry, scheduler } = setup();
    const { flowId } = registry.start("supabase");
    registry.markPrepared("supabase", flowId);
    expect(scheduler.pendingMs).toEqual([DEFAULT_FLOW_TIMEOUTS_MS.supabase]);

    scheduler.fireAll();
    expect(registry.getState("supabase")).toMatchObject({
      status: "failed",
      reason: "timeout",
    });
  });
});

describe("unsolicited returns", () => {
  it("a return with no flow at all is unsolicited and leaves state untouched", () => {
    const { registry, unsolicited, stateChanges } = setup();
    const claim = registry.claimReturn("supabase");
    expect(claim.claimed).toBe(false);
    registry.notifyUnsolicitedReturn("supabase");

    expect(unsolicited).toEqual(["supabase"]);
    expect(registry.getState("supabase").status).toBe("disconnected");
    expect(stateChanges).toEqual([]);
  });
});

describe("renderer detach (GitHub poll success after unmount)", () => {
  it("the flow keeps its state; a remounted renderer completes it", () => {
    const { registry, stateChanges } = setup();
    const { flowId } = registry.start("github");
    registry.markPrepared("github", flowId, {
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
    });

    // Poll succeeds while no renderer is mounted: the token is written and
    // the flow advances to loading-resources, where it waits.
    const claim = registry.claimReturn("github");
    expect(claim).toEqual({ claimed: true, flowId });
    registry.completeTokenExchange("github", flowId);
    expect(registry.getState("github").status).toBe("loading-resources");

    // A renderer mounting later projects loading-resources and finishes the
    // flow — the UI can never miss the success.
    registry.completeResourceLoad("github", flowId);
    expect(registry.getState("github").status).toBe("connected");
    expect(statusesFor(stateChanges, "github")).toEqual([
      "starting",
      "awaiting-return",
      "exchanging-token",
      "loading-resources",
      "connected",
    ]);
  });

  it("resources-loaded with a stale flowId never advances a newer flow", () => {
    const { registry } = setup();
    const first = registry.start("github");
    registry.markPrepared("github", first.flowId);
    registry.cancel("github", first.flowId);
    registry.acknowledge("github", first.flowId);

    const second = registry.start("github");
    registry.markPrepared("github", second.flowId);
    const claim = registry.claimReturn("github");
    expect(claim.claimed).toBe(true);
    registry.completeTokenExchange("github", second.flowId);

    // Stale event from the first flow.
    expect(registry.completeResourceLoad("github", first.flowId)).toBe(false);
    expect(registry.getState("github").status).toBe("loading-resources");
  });
});

describe("cancel", () => {
  it("cancels the active flow and defuses its timeout", () => {
    const { registry, scheduler } = setup();
    const { flowId } = registry.start("neon");
    registry.markPrepared("neon", flowId);
    expect(scheduler.pendingCount).toBe(1);

    expect(registry.cancel("neon")).toBe(true);
    expect(registry.getState("neon").status).toBe("cancelled");
    expect(scheduler.pendingCount).toBe(0);

    // Firing anything left over must not resurrect the flow.
    scheduler.fireAll();
    expect(registry.getState("neon").status).toBe("cancelled");
  });

  it("cancel with no flow is a safe no-op", () => {
    const { registry } = setup();
    expect(registry.cancel("neon")).toBe(false);
  });

  it("a cancelled flow lets the raced token write land as unsolicited", () => {
    const { registry, unsolicited } = setup();
    const { flowId } = registry.start("github");
    registry.markPrepared("github", flowId);
    registry.cancel("github", flowId);

    // Poll response with an access token arrives after the cancel: the
    // caller writes the token and reports it as unsolicited.
    const claim = registry.claimReturn("github");
    expect(claim.claimed).toBe(false);
    registry.notifyUnsolicitedReturn("github");
    expect(unsolicited).toEqual(["github"]);
    expect(registry.getState("github").status).toBe("cancelled");
  });
});

describe("controller integration with deferred commands", () => {
  it("a slow token exchange still wins over a timeout that fired in between", async () => {
    const { registry, scheduler } = setup();
    const { flowId } = registry.start("supabase");
    registry.markPrepared("supabase", flowId);

    // Return arrives: claim first (this is what runOAuthReturnExchange does),
    // then run the async token write.
    const claim = registry.claimReturn("supabase");
    expect(claim.claimed).toBe(true);

    let resolveExchange!: () => void;
    const exchange = new Promise<void>((resolve) => {
      resolveExchange = resolve;
    });
    const run = (async () => {
      await exchange;
      registry.completeTokenExchange("supabase", flowId);
    })();

    // While the (retry-laddered) org listing is still running, stale timers
    // fire — the machine must not regress to failed.
    scheduler.fireAll();
    expect(registry.getState("supabase").status).toBe("exchanging-token");

    resolveExchange();
    await run;
    expect(registry.getState("supabase").status).toBe("loading-resources");
  });

  it("a failed token exchange fails the flow with the given reason", () => {
    const { registry } = setup();
    const { flowId } = registry.start("neon");
    registry.markPrepared("neon", flowId);
    const claim = registry.claimReturn("neon");
    expect(claim.claimed).toBe(true);

    registry.fail("neon", flowId, "token_invalid", "could not save");
    expect(registry.getState("neon")).toMatchObject({
      status: "failed",
      reason: "token_invalid",
      message: "could not save",
    });
  });

  it("reports ignored events for observability", () => {
    const onIgnoredEvent = vi.fn();
    const { registry } = setup({ onIgnoredEvent });
    registry.completeResourceLoad("neon", "nonexistent-flow");
    expect(onIgnoredEvent).toHaveBeenCalledWith(
      "neon",
      expect.objectContaining({ type: "resources-loaded" }),
      "no-active-flow",
    );
  });

  it("acknowledge resets a terminal flow so a new one can start", () => {
    const { registry } = setup();
    const first = registry.start("neon");
    registry.markPrepared("neon", first.flowId);
    const claim = registry.claimReturn("neon");
    expect(claim.claimed).toBe(true);
    registry.completeTokenExchange("neon", first.flowId);
    registry.completeResourceLoad("neon", first.flowId);
    expect(registry.getState("neon").status).toBe("connected");

    expect(registry.acknowledge("neon", first.flowId)).toBe(true);
    expect(registry.getState("neon").status).toBe("disconnected");

    const second = registry.start("neon");
    expect(second.started).toBe(true);
    expect(second.flowId).not.toBe(first.flowId);
  });
});

describe("snapshot", () => {
  it("returns a state for every provider", () => {
    const { registry } = setup();
    registry.start("github");
    const snapshot = registry.getSnapshot();
    expect(Object.keys(snapshot).sort()).toEqual([
      "github",
      "neon",
      "supabase",
    ]);
    expect(snapshot.github.status).toBe("starting");
    expect(snapshot.neon.status).toBe("disconnected");
    expect(snapshot.supabase.status).toBe("disconnected");
  });
});
