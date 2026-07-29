import { describe, expect, it } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  OperationRouteCapacityError,
  OperationRouteIdentityConflictError,
  OperationRouteRegistry,
  type OperationRouteClaim,
} from "./operation_route_registry";

type Route = { readonly channel: string };

function createRegistry(
  options: { maxUnresolved?: number; maxTerminalRetained?: number } = {},
) {
  return new OperationRouteRegistry<Route>({
    maxUnresolved: options.maxUnresolved ?? 2,
    maxTerminalRetained: options.maxTerminalRetained ?? 2,
    sameRoute: (left, right) => left.channel === right.channel,
  });
}

function claim(
  operationId: string,
  options: {
    ownerId?: string;
    machineId?: string;
    windowSessionId?: string;
    channel?: string;
  } = {},
): OperationRouteClaim<Route> {
  return {
    operationId,
    owner: {
      ownerId: options.ownerId ?? "owner-1",
      machineId: options.machineId ?? "machine-1",
      windowSessionId: options.windowSessionId ?? "window-1",
      route: { channel: options.channel ?? "toast:error" },
    },
  };
}

describe("OperationRouteRegistry", () => {
  it("gives the first writer ownership and coalesces an identical duplicate", () => {
    const registry = createRegistry();
    const first = registry.admit(claim("operation-1"));
    const duplicate = registry.admit(claim("operation-1"));

    expect(first.kind).toBe("fresh");
    expect(duplicate.kind).toBe("coalesced");
    expect(duplicate.handle).toBe(first.handle);
    expect(duplicate.route).toMatchObject({
      operationId: "operation-1",
      owner: {
        ownerId: "owner-1",
        machineId: "machine-1",
        windowSessionId: "window-1",
        route: { channel: "toast:error" },
      },
      state: "unresolved",
      generation: { ordinal: 1 },
    });
  });

  it.each([
    { ownerId: "owner-2" },
    { machineId: "machine-2" },
    { windowSessionId: "window-2" },
    { channel: "version-preview:result" },
  ])("rejects conflicting operation identity reuse: %o", (conflict) => {
    const registry = createRegistry();
    const first = registry.admit(claim("operation-1"));

    expect(() => registry.admit(claim("operation-1", conflict))).toThrow(
      OperationRouteIdentityConflictError,
    );
    expect(registry.inspect().routes[0].generation).toBe(
      first.handle.generation,
    );
  });

  it("refuses unresolved admission at capacity without evicting pinned routes", () => {
    const registry = createRegistry({
      maxUnresolved: 1,
      maxTerminalRetained: 0,
    });
    const pinned = registry.admit(claim("pinned"));

    expect(() => registry.admit(claim("refused"))).toThrow(
      OperationRouteCapacityError,
    );
    expect(registry.inspect()).toMatchObject({
      unresolved: 1,
      terminal: 0,
      total: 1,
    });
    expect(registry.inspect().routes[0].operationId).toBe("pinned");
    expect(registry.inspect().routes[0].generation).toBe(
      pinned.handle.generation,
    );
  });

  it("classifies identity conflicts and capacity refusal as expected errors", () => {
    const registry = createRegistry({ maxUnresolved: 1 });
    registry.admit(claim("operation-1"));

    expect(
      (() => {
        try {
          registry.admit(claim("operation-1", { ownerId: "conflict" }));
        } catch (error) {
          return error;
        }
      })(),
    ).toMatchObject({ kind: DyadErrorKind.Conflict });
    expect(
      (() => {
        try {
          registry.admit(claim("operation-2"));
        } catch (error) {
          return error;
        }
      })(),
    ).toMatchObject({ kind: DyadErrorKind.RateLimited });
  });

  it("retains terminal replay within a finite bound and evicts by settlement order", () => {
    const registry = createRegistry({
      maxUnresolved: 4,
      maxTerminalRetained: 2,
    });
    const first = registry.admit(claim("first"));
    const second = registry.admit(claim("second"));
    const pending = registry.admit(claim("pending"));
    const third = registry.admit(claim("third"));

    expect(registry.markTerminal(second.handle)).toBe(true);
    expect(registry.markTerminal(first.handle)).toBe(true);
    expect(registry.admit(claim("first")).kind).toBe("replayed");
    expect(registry.markTerminal(third.handle)).toBe(true);

    expect(registry.inspect().routes.map((route) => route.operationId)).toEqual(
      ["pending", "first", "third"],
    );
    expect(registry.inspect()).toMatchObject({
      unresolved: 1,
      terminal: 2,
      total: 3,
    });
    expect(registry.inspect().routes[0].generation).toBe(
      pending.handle.generation,
    );
    expect(registry.admit(claim("second")).kind).toBe("fresh");
  });

  it("keeps duplicate terminal outcomes safe and deterministic", () => {
    const registry = createRegistry();
    const admission = registry.admit(claim("operation-1"));

    expect(registry.markTerminal(admission.handle)).toBe(true);
    expect(registry.markTerminal(admission.handle)).toBe(false);
    expect(registry.inspect()).toMatchObject({
      unresolved: 0,
      terminal: 1,
      total: 1,
    });
  });

  it("makes release idempotent and rejects a stale release after replacement", () => {
    const registry = createRegistry();
    const original = registry.admit(claim("operation-1"));

    expect(
      registry.release({
        operationId: original.handle.operationId,
        generation: original.handle.generation,
      }),
    ).toBe(false);
    expect(registry.release(original.handle)).toBe(true);
    expect(registry.release(original.handle)).toBe(false);
    const replacement = registry.admit(claim("operation-1"));
    expect(replacement.handle.generation.ordinal).toBeGreaterThan(
      original.handle.generation.ordinal,
    );
    expect(registry.release(original.handle)).toBe(false);
    expect(registry.inspect().routes[0].generation).toBe(
      replacement.handle.generation,
    );
  });

  it("supports explicit owner and window cleanup", () => {
    const registry = createRegistry({ maxUnresolved: 4 });
    registry.admit(claim("owner-a-1", { ownerId: "owner-a" }));
    registry.admit(claim("owner-a-2", { ownerId: "owner-a" }));
    registry.admit(
      claim("owner-b", {
        ownerId: "owner-b",
        windowSessionId: "window-b",
      }),
    );

    expect(registry.releaseOwner("owner-a")).toBe(2);
    expect(registry.releaseOwner("owner-a")).toBe(0);
    expect(registry.releaseWindow("window-b")).toBe(1);
    expect(registry.inspect()).toMatchObject({
      unresolved: 0,
      terminal: 0,
      total: 0,
    });
  });

  it("supports machine-wide and registry-wide disposal", () => {
    const registry = createRegistry({ maxUnresolved: 4 });
    registry.admit(claim("machine-a", { machineId: "machine-a" }));
    registry.admit(claim("machine-b", { machineId: "machine-b" }));

    expect(registry.releaseMachine("machine-a")).toBe(1);
    expect(registry.inspect().routes.map((route) => route.operationId)).toEqual(
      ["machine-b"],
    );
    registry.dispose();
    registry.dispose();
    expect(registry.inspect()).toEqual({
      unresolved: 0,
      terminal: 0,
      total: 0,
      routes: [],
    });
    expect(() => registry.admit(claim("after-disposal"))).toThrow(
      "Operation route registry is disposed",
    );
  });

  it("reports window loss without releasing unresolved ownership", () => {
    const registry = createRegistry();
    const admission = registry.admit(claim("operation-1"));

    expect(registry.inspectWindowRoutes("window-1")).toEqual([
      expect.objectContaining({
        operationId: "operation-1",
        state: "unresolved",
      }),
    ]);
    expect(registry.inspect()).toMatchObject({
      unresolved: 1,
      total: 1,
    });
    expect(registry.release(admission.handle)).toBe(true);
  });

  it("has zero remaining routes after terminal release and disposal", () => {
    const registry = createRegistry();
    const terminal = registry.admit(claim("terminal"));
    registry.markTerminal(terminal.handle);
    registry.release(terminal.handle);
    registry.admit(claim("unresolved"));
    registry.dispose();

    expect(registry.inspect()).toEqual({
      unresolved: 0,
      terminal: 0,
      total: 0,
      routes: [],
    });
  });

  it("provides useful leak diagnostics for resource accounting", () => {
    const registry = createRegistry();
    registry.admit(
      claim("leaked-operation", {
        ownerId: "presentation-owner",
        machineId: "github-ops",
        windowSessionId: "window-7",
      }),
    );

    const inspection = registry.inspect();
    const diagnostics = inspection.routes
      .map(
        (route) =>
          `operation=${route.operationId} owner=${route.owner.ownerId} machine=${route.owner.machineId} window=${route.owner.windowSessionId ?? "-"} state=${route.state} generation=${route.generation.ordinal}`,
      )
      .join("\n");

    expect({ routes: inspection.total }).toEqual({ routes: 1 });
    expect(diagnostics).toBe(
      "operation=leaked-operation owner=presentation-owner machine=github-ops window=window-7 state=unresolved generation=1",
    );
  });

  it("rejects unbounded or invalid retention policies", () => {
    for (const options of [
      { maxUnresolved: 0, maxTerminalRetained: 1 },
      { maxUnresolved: 1, maxTerminalRetained: -1 },
      { maxUnresolved: 1, maxTerminalRetained: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => new OperationRouteRegistry<Route>(options)).toThrow(
        "finite bounded integers",
      );
    }
  });
});
