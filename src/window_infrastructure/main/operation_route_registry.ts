import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export type OperationRouteState = "unresolved" | "terminal";

export interface OperationRouteGeneration {
  readonly ordinal: number;
  readonly identity: object;
}

export interface OperationRouteOwner<Route> {
  /** Stable identity for the presentation owner within its machine. */
  readonly ownerId: string;
  readonly machineId: string;
  readonly windowSessionId?: string;
  /** Main-process-only, domain-defined presentation route. */
  readonly route: Route;
}

export interface OperationRouteClaim<Route> {
  /** Stable authoritative operation identity. */
  readonly operationId: string;
  readonly owner: OperationRouteOwner<Route>;
}

export interface OperationRouteSnapshot<Route> {
  readonly operationId: string;
  readonly owner: OperationRouteOwner<Route>;
  readonly state: OperationRouteState;
  readonly generation: OperationRouteGeneration;
}

export interface OperationRouteHandle {
  readonly operationId: string;
  readonly generation: OperationRouteGeneration;
}

export type OperationRouteAdmission<Route> = {
  readonly kind: "fresh" | "coalesced" | "replayed";
  readonly handle: OperationRouteHandle;
  readonly route: OperationRouteSnapshot<Route>;
};

export interface OperationRouteRegistryInspection<Route> {
  readonly unresolved: number;
  readonly terminal: number;
  readonly total: number;
  readonly routes: readonly OperationRouteSnapshot<Route>[];
}

export interface OperationRouteRegistryOptions<Route> {
  readonly maxUnresolved: number;
  /** Finite count of terminal routes retained for deterministic replay. */
  readonly maxTerminalRetained: number;
  /**
   * Takes an owned snapshot of an opaque route. It is used both when storing a
   * claim and when returning a route so external mutation cannot rewrite
   * first-writer ownership.
   */
  readonly snapshotRoute: (route: Route) => Route;
  /**
   * Defines identity for the opaque route value. Metadata on the owner is
   * always compared separately.
   */
  readonly sameRoute: (left: Route, right: Route) => boolean;
}

export class OperationRouteIdentityConflictError extends DyadError {
  constructor(readonly operationId: string) {
    super(
      `Operation ${operationId} was reused with a conflicting presentation owner`,
      DyadErrorKind.Conflict,
    );
    this.name = "OperationRouteIdentityConflictError";
  }
}

export class OperationRouteCapacityError extends DyadError {
  constructor() {
    super(
      "Authoritative operation route capacity is exhausted",
      DyadErrorKind.RateLimited,
    );
    this.name = "OperationRouteCapacityError";
  }
}

interface OperationRouteEntry<Route> {
  readonly snapshot: {
    readonly operationId: string;
    readonly owner: OperationRouteOwner<Route>;
    state: OperationRouteState;
    readonly generation: OperationRouteGeneration;
  };
  readonly handle: OperationRouteHandle;
}

/**
 * Main-process ownership for routing presentation from authoritative
 * operations. Unresolved routes are pinned. Only terminal replay history is
 * evicted, and cleanup is driven explicitly by authoritative settlement or
 * ownership disposal.
 */
export class OperationRouteRegistry<Route> {
  private readonly entries = new Map<string, OperationRouteEntry<Route>>();
  private unresolved = 0;
  private nextGeneration = 1;
  private disposed = false;
  private mutationVersion = 0;
  private invokingAdapter = false;
  private readonly maxUnresolved: number;
  private readonly maxTerminalRetained: number;
  private readonly snapshotRoute: (route: Route) => Route;
  private readonly sameRoute: (left: Route, right: Route) => boolean;

  constructor(options: OperationRouteRegistryOptions<Route>) {
    if (
      !Number.isSafeInteger(options.maxUnresolved) ||
      options.maxUnresolved < 1 ||
      !Number.isSafeInteger(options.maxTerminalRetained) ||
      options.maxTerminalRetained < 0
    ) {
      throw new Error(
        "Operation route capacities must be finite bounded integers",
      );
    }
    this.maxUnresolved = options.maxUnresolved;
    this.maxTerminalRetained = options.maxTerminalRetained;
    this.snapshotRoute = options.snapshotRoute;
    this.sameRoute = options.sameRoute;
  }

  admit(claim: OperationRouteClaim<Route>): OperationRouteAdmission<Route> {
    this.assertOpen();
    if (this.invokingAdapter) {
      throw new Error(
        "Operation route adapters cannot reenter registry admission",
      );
    }
    const existing = this.entries.get(claim.operationId);
    if (existing) {
      if (!this.sameOwner(existing.snapshot.owner, claim.owner)) {
        throw new OperationRouteIdentityConflictError(claim.operationId);
      }
      if (this.entries.get(claim.operationId) !== existing) {
        throw new Error(
          "Operation route ownership changed during identity comparison",
        );
      }
      return {
        kind: existing.snapshot.state === "terminal" ? "replayed" : "coalesced",
        handle: existing.handle,
        route: this.readSnapshot(existing),
      };
    }
    if (this.unresolved >= this.maxUnresolved) {
      throw new OperationRouteCapacityError();
    }

    const storedRoute = this.callAdapter(() =>
      this.snapshotRoute(claim.owner.route),
    );
    const generation = Object.freeze({
      ordinal: this.nextGeneration++,
      identity: Object.freeze({}),
    });
    const owner = Object.freeze({
      ...claim.owner,
      route: storedRoute,
    });
    const snapshot = {
      operationId: claim.operationId,
      owner,
      state: "unresolved" as const,
      generation,
    };
    const entry: OperationRouteEntry<Route> = {
      snapshot,
      handle: Object.freeze({
        operationId: claim.operationId,
        generation,
      }),
    };
    const route = this.readSnapshot(entry);
    if (this.unresolved >= this.maxUnresolved) {
      throw new OperationRouteCapacityError();
    }
    this.entries.set(claim.operationId, entry);
    this.unresolved += 1;
    this.mutationVersion += 1;
    return {
      kind: "fresh",
      handle: entry.handle,
      route,
    };
  }

  /**
   * Marks authoritative settlement and starts bounded terminal retention.
   * Re-insertion makes eviction deterministic by settlement order.
   */
  markTerminal(handle: OperationRouteHandle): boolean {
    this.assertMutationAllowed();
    const entry = this.currentEntry(handle);
    if (!entry || entry.snapshot.state === "terminal") return false;
    entry.snapshot.state = "terminal";
    this.unresolved -= 1;
    this.entries.delete(handle.operationId);
    this.entries.set(handle.operationId, entry);
    this.trimTerminal();
    this.mutationVersion += 1;
    return true;
  }

  /** Explicit authoritative release for one operation generation. */
  release(handle: OperationRouteHandle): boolean {
    this.assertMutationAllowed();
    const entry = this.currentEntry(handle);
    if (!entry) return false;
    this.entries.delete(handle.operationId);
    if (entry.snapshot.state === "unresolved") this.unresolved -= 1;
    this.mutationVersion += 1;
    return true;
  }

  releaseOwner(machineId: string, ownerId: string): number {
    this.assertMutationAllowed();
    return this.releaseMatching(
      (owner) => owner.machineId === machineId && owner.ownerId === ownerId,
    );
  }

  releaseWindow(windowSessionId: string): number {
    this.assertMutationAllowed();
    return this.releaseMatching(
      (owner) => owner.windowSessionId === windowSessionId,
    );
  }

  releaseMachine(machineId: string): number {
    this.assertMutationAllowed();
    return this.releaseMatching((owner) => owner.machineId === machineId);
  }

  /**
   * Read-only window-loss query. Composition code must explicitly choose drop,
   * entity-window fallback, or focused-window fallback before releasing or
   * replacing any unresolved route.
   */
  inspectWindowRoutes(
    windowSessionId: string,
  ): readonly OperationRouteSnapshot<Route>[] {
    return this.inspectMatching(
      (owner) => owner.windowSessionId === windowSessionId,
    );
  }

  inspect(): OperationRouteRegistryInspection<Route> {
    const routes = this.inspectMatching(() => true);
    return Object.freeze({
      unresolved: this.unresolved,
      terminal: routes.length - this.unresolved,
      total: routes.length,
      routes,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.assertMutationAllowed();
    this.disposed = true;
    this.entries.clear();
    this.unresolved = 0;
    this.mutationVersion += 1;
  }

  private currentEntry(
    handle: OperationRouteHandle,
  ): OperationRouteEntry<Route> | undefined {
    const entry = this.entries.get(handle.operationId);
    return entry?.handle === handle ? entry : undefined;
  }

  private releaseMatching(
    matches: (owner: OperationRouteOwner<Route>) => boolean,
  ): number {
    let released = 0;
    for (const [operationId, entry] of this.entries) {
      if (!matches(entry.snapshot.owner)) continue;
      this.entries.delete(operationId);
      if (entry.snapshot.state === "unresolved") this.unresolved -= 1;
      released += 1;
    }
    if (released > 0) this.mutationVersion += 1;
    return released;
  }

  private inspectMatching(
    matches: (owner: OperationRouteOwner<Route>) => boolean,
  ): readonly OperationRouteSnapshot<Route>[] {
    return Object.freeze(
      Array.from(this.entries.values(), (entry) =>
        this.readSnapshot(entry),
      ).filter((route) => matches(route.owner)),
    );
  }

  private readSnapshot(
    entry: OperationRouteEntry<Route>,
  ): OperationRouteSnapshot<Route> {
    return Object.freeze({
      operationId: entry.snapshot.operationId,
      owner: Object.freeze({
        ...entry.snapshot.owner,
        route: this.callAdapter(() =>
          this.snapshotRoute(entry.snapshot.owner.route),
        ),
      }),
      state: entry.snapshot.state,
      generation: entry.snapshot.generation,
    });
  }

  private trimTerminal(): void {
    let terminal = this.entries.size - this.unresolved;
    if (terminal <= this.maxTerminalRetained) return;
    for (const [operationId, entry] of this.entries) {
      if (entry.snapshot.state !== "terminal") continue;
      this.entries.delete(operationId);
      terminal -= 1;
      if (terminal <= this.maxTerminalRetained) return;
    }
  }

  private sameOwner(
    left: OperationRouteOwner<Route>,
    right: OperationRouteOwner<Route>,
  ): boolean {
    return (
      left.ownerId === right.ownerId &&
      left.machineId === right.machineId &&
      left.windowSessionId === right.windowSessionId &&
      this.callAdapter(() => this.sameRoute(left.route, right.route))
    );
  }

  private callAdapter<Value>(call: () => Value): Value {
    if (this.invokingAdapter) {
      throw new Error("Operation route adapters cannot reenter one another");
    }
    const version = this.mutationVersion;
    this.invokingAdapter = true;
    let value: Value;
    try {
      value = call();
    } finally {
      this.invokingAdapter = false;
    }
    this.assertOpen();
    if (this.mutationVersion !== version) {
      throw new Error("Operation route adapter mutated registry ownership");
    }
    return value;
  }

  private assertOpen(): void {
    if (!this.disposed) return;
    throw new DyadError(
      "Operation route registry is disposed",
      DyadErrorKind.Precondition,
    );
  }

  private assertMutationAllowed(): void {
    if (!this.invokingAdapter) return;
    throw new Error(
      "Operation route adapters cannot mutate registry ownership",
    );
  }
}
