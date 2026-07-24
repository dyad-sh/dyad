import type { IdSource } from "./clock";

/**
 * Complete correlation identity for one operation.
 *
 * `operationId` is correlation identity: it distinguishes concurrent and
 * superseded executions, including executions from different controller
 * lifetimes. It is not automatically an idempotency key. A boundary that
 * deduplicates durable acceptance must name and document its idempotency
 * property separately, even when a protocol deliberately reuses this value.
 */
export interface InvocationRef<
  Kind extends string = string,
  EntityKey extends string | number = string | number,
> {
  kind: Kind;
  entityKey: EntityKey;
  operationId: string;
}

/** Mint a ref at the authoritative boundary that starts the operation. */
export function createInvocationRef<
  Kind extends string,
  EntityKey extends string | number,
>(
  kind: Kind,
  entityKey: EntityKey,
  ids: IdSource,
): InvocationRef<Kind, EntityKey> {
  const operationId = ids.next(kind);
  if (operationId.length === 0) {
    throw new Error("IdSource returned an empty operation identity");
  }
  return {
    kind,
    entityKey,
    operationId,
  };
}

export function sameInvocationRef(
  left: InvocationRef,
  right: InvocationRef,
): boolean {
  return (
    left.kind === right.kind &&
    left.entityKey === right.entityKey &&
    left.operationId === right.operationId
  );
}

export function isInvocationRef(value: unknown): value is InvocationRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<InvocationRef>;
  return (
    typeof candidate.kind === "string" &&
    (typeof candidate.entityKey === "string" ||
      typeof candidate.entityKey === "number") &&
    typeof candidate.operationId === "string" &&
    candidate.operationId.length > 0
  );
}

/**
 * Collision-free registry key. Length prefixes keep user-controlled string
 * entity keys from colliding with separators in kinds or operation IDs.
 */
export function invocationRegistryKey(ref: InvocationRef): string {
  const kind = ref.kind;
  const entityKey =
    typeof ref.entityKey === "number"
      ? `number:${ref.entityKey}`
      : `string:${ref.entityKey}`;
  const operationId = ref.operationId;
  return `${kind.length}:${kind}${entityKey.length}:${entityKey}${operationId.length}:${operationId}`;
}

function entityRegistryKey(kind: string, entityKey: string | number): string {
  const normalizedEntityKey =
    typeof entityKey === "number"
      ? `number:${entityKey}`
      : `string:${entityKey}`;
  return `${kind.length}:${kind}${normalizedEntityKey.length}:${normalizedEntityKey}`;
}

export type OperationMatch =
  | { kind: "matched" }
  | { kind: "stale"; expected: InvocationRef }
  | { kind: "unsolicited" };

/** Match a producer completion to the operation currently owning its entity. */
export function matchCompletionToActiveOperation(
  active: InvocationRef | undefined,
  completion: InvocationRef | undefined,
): OperationMatch {
  if (!active || !completion) {
    return { kind: "unsolicited" };
  }
  return sameInvocationRef(active, completion)
    ? { kind: "matched" }
    : { kind: "stale", expected: active };
}

export interface OperationWaiter<Result> {
  ref: InvocationRef;
  settle(result: Result): void;
}

/**
 * Settle a waiter displaced by a newer operation.
 *
 * This helper deliberately has no state-application callback: supersession
 * may release the old caller, but only a completion matching the active ref
 * may apply operation state.
 */
export function settleSupersededWaiter<Result>(
  waiter: OperationWaiter<Result> | undefined,
  activeRef: InvocationRef,
  result: Result,
): boolean {
  if (!waiter || sameInvocationRef(waiter.ref, activeRef)) {
    return false;
  }
  waiter.settle(result);
  return true;
}

class BoundedInvocationRefs {
  private readonly refs = new Map<string, InvocationRef>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Invocation ref capacity must be a positive integer");
    }
  }

  add(ref: InvocationRef): void {
    const key = invocationRegistryKey(ref);
    this.refs.delete(key);
    this.refs.set(key, ref);
    while (this.refs.size > this.capacity) {
      const oldest = this.refs.keys().next().value;
      if (oldest === undefined) break;
      this.refs.delete(oldest);
    }
  }

  has(ref: InvocationRef): boolean {
    return this.refs.has(invocationRegistryKey(ref));
  }

  delete(ref: InvocationRef): boolean {
    return this.refs.delete(invocationRegistryKey(ref));
  }

  get size(): number {
    return this.refs.size;
  }
}

/** Bounded history used to recognize late completions from replaced work. */
export class SupersededInvocationRefs extends BoundedInvocationRefs {}

/** Bounded main-owned cancellation history for cancel-before-registration. */
export class CancellationTombstones extends BoundedInvocationRefs {}

export interface StructuralSafetyNote {
  /**
   * Why only the active producer can reach this claim site even though its
   * InvocationRef physically cannot round-trip through the external source.
   */
  structuralSafety: string;
}

export type InvocationClaim<Value> =
  | { kind: "claimed"; ref: InvocationRef; value: Value }
  | { kind: "stale"; expected: InvocationRef }
  | { kind: "unsolicited" };

/**
 * Registry whose claim operation enforces correlation centrally.
 *
 * Callers cannot retrieve an active value by entity key and then forget the
 * operation check. Untagged sources must instead use `claimStructurally`,
 * which makes the structural-safety argument explicit at the claim site.
 */
export class InvocationRegistry<Value> {
  private readonly activeByEntity = new Map<
    string,
    { ref: InvocationRef; value: Value }
  >();

  register(ref: InvocationRef, value: Value): Value | undefined {
    const key = entityRegistryKey(ref.kind, ref.entityKey);
    const previous = this.activeByEntity.get(key);
    this.activeByEntity.set(key, { ref, value });
    return previous?.value;
  }

  claim(ref: InvocationRef): InvocationClaim<Value> {
    const active = this.activeByEntity.get(
      entityRegistryKey(ref.kind, ref.entityKey),
    );
    if (!active) return { kind: "unsolicited" };
    if (!sameInvocationRef(active.ref, ref)) {
      return { kind: "stale", expected: active.ref };
    }
    return { kind: "claimed", ref: active.ref, value: active.value };
  }

  claimStructurally(
    kind: string,
    entityKey: string | number,
    note: StructuralSafetyNote,
  ): InvocationClaim<Value> {
    if (note.structuralSafety.trim().length === 0) {
      throw new Error("A structural-safety explanation is required");
    }
    const active = this.activeByEntity.get(entityRegistryKey(kind, entityKey));
    return active
      ? { kind: "claimed", ref: active.ref, value: active.value }
      : { kind: "unsolicited" };
  }

  delete(ref: InvocationRef): boolean {
    const key = entityRegistryKey(ref.kind, ref.entityKey);
    const active = this.activeByEntity.get(key);
    if (!active || !sameInvocationRef(active.ref, ref)) return false;
    return this.activeByEntity.delete(key);
  }
}
