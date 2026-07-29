import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  ActorDisposalCause,
  ActorInstanceId,
  ActorRuntimeMetadata,
} from "./definition";
import type { RequestId } from "./request_identity";

export type OperationDisposalCause =
  | "actor"
  | "key"
  | "machine"
  | "host"
  | "window-session";

export interface OperationOwner {
  readonly hostId: string;
  readonly machineId: string;
  readonly keyId: string;
  readonly actorInstanceId: ActorInstanceId;
  readonly actorRevision: number;
  readonly windowSessionId: string;
}

export interface OperationAdmissionIdentity<InvocationRef> {
  readonly requestId: RequestId;
  readonly invocationRef: InvocationRef;
  /** Complete immutable identity/fingerprint for conflict detection. */
  readonly fingerprint: string;
  readonly owner: OperationOwner;
}

export interface OperationReceiptMetadata {
  readonly actor: ActorRuntimeMetadata;
  readonly acknowledgedAt: number;
}

export interface OperationSettlement<Outcome, InvocationRef> {
  readonly requestId: RequestId;
  readonly invocationRef: InvocationRef;
  readonly outcome: Outcome;
  readonly receipt: OperationReceiptMetadata;
}

/** Explicit post-commit data emitted by a pure transition. */
export interface CorrelatedOperationOutcome<Outcome, InvocationRef> {
  readonly requestId: RequestId;
  readonly invocationRef: InvocationRef;
  readonly outcome: Outcome;
}

export interface OperationTicket<Outcome, InvocationRef> {
  readonly requestId: RequestId;
  readonly invocationRef: InvocationRef;
  readonly settled: Promise<OperationSettlement<Outcome, InvocationRef>>;
  subscribe(
    listener: (settlement: OperationSettlement<Outcome, InvocationRef>) => void,
  ): () => void;
}

export type OperationAdmission<Outcome, InvocationRef> =
  | {
      readonly kind: "fresh";
      readonly ticket: OperationTicket<Outcome, InvocationRef>;
    }
  | {
      readonly kind: "coalesced" | "replayed";
      readonly ticket: OperationTicket<Outcome, InvocationRef>;
    };

export class OperationIdentityConflictError extends DyadError {
  constructor(readonly requestId: RequestId) {
    super(
      `RequestId ${requestId} was reused with conflicting identity`,
      DyadErrorKind.Conflict,
    );
    this.name = "OperationIdentityConflictError";
  }
}

export class OperationCapacityError extends DyadError {
  constructor() {
    super(
      "Authoritative operation capacity is exhausted",
      DyadErrorKind.RateLimited,
    );
    this.name = "OperationCapacityError";
  }
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface OperationEntry<Outcome, InvocationRef> {
  readonly identity: OperationAdmissionIdentity<InvocationRef>;
  readonly deferred: Deferred<OperationSettlement<Outcome, InvocationRef>>;
  readonly listeners: Set<
    (settlement: OperationSettlement<Outcome, InvocationRef>) => void
  >;
  ticket?: OperationTicket<Outcome, InvocationRef>;
  settlement?: OperationSettlement<Outcome, InvocationRef>;
}

function sameOwner(left: OperationOwner, right: OperationOwner): boolean {
  return (
    left.hostId === right.hostId &&
    left.machineId === right.machineId &&
    left.keyId === right.keyId &&
    left.actorInstanceId === right.actorInstanceId &&
    left.actorRevision === right.actorRevision &&
    left.windowSessionId === right.windowSessionId
  );
}

function sameLogicalOwner(
  left: OperationOwner,
  right: OperationOwner,
): boolean {
  return (
    left.hostId === right.hostId &&
    left.machineId === right.machineId &&
    left.keyId === right.keyId &&
    left.windowSessionId === right.windowSessionId
  );
}

export interface OperationRegistryOptions<Outcome, InvocationRef> {
  readonly maxUnresolved: number;
  readonly maxSettledReplay: number;
  readonly now: () => number;
  readonly disposalOutcome: (cause: OperationDisposalCause) => Outcome;
  readonly supersededOutcome: () => Outcome;
  readonly enqueueFailureOutcome: (error: unknown) => Outcome;
  readonly sameInvocationRef: (
    left: InvocationRef,
    right: InvocationRef,
  ) => boolean;
  readonly reportError?: (error: unknown) => void;
}

/**
 * In-process authoritative request settlement. Unresolved entries are pinned;
 * only independently bounded settled replay history is evicted.
 */
export class OperationRegistry<Outcome, InvocationRef> {
  private readonly entries = new Map<
    RequestId,
    OperationEntry<Outcome, InvocationRef>
  >();
  private unresolved = 0;
  private disposed = false;
  private readonly disposeListeners = new Set<() => void>();

  constructor(
    private readonly options: OperationRegistryOptions<Outcome, InvocationRef>,
  ) {
    if (
      !Number.isSafeInteger(options.maxUnresolved) ||
      options.maxUnresolved < 1 ||
      !Number.isSafeInteger(options.maxSettledReplay) ||
      options.maxSettledReplay < 0
    ) {
      throw new Error("Operation registry capacities must be bounded integers");
    }
  }

  admit(
    identity: OperationAdmissionIdentity<InvocationRef>,
    options: { readonly retry?: "new-invocation" } = {},
  ): OperationAdmission<Outcome, InvocationRef> {
    if (this.disposed) throw new Error("OperationRegistry is disposed");
    const existing = this.entries.get(identity.requestId);
    if (existing) {
      if (
        existing.identity.fingerprint !== identity.fingerprint ||
        !sameLogicalOwner(existing.identity.owner, identity.owner)
      ) {
        throw new OperationIdentityConflictError(identity.requestId);
      }
      if (options.retry !== "new-invocation") {
        if (
          !sameOwner(existing.identity.owner, identity.owner) ||
          !this.options.sameInvocationRef(
            existing.identity.invocationRef,
            identity.invocationRef,
          )
        ) {
          throw new OperationIdentityConflictError(identity.requestId);
        }
        return {
          kind: existing.settlement ? "replayed" : "coalesced",
          ticket: this.ticket(existing),
        };
      }
      if (
        this.options.sameInvocationRef(
          existing.identity.invocationRef,
          identity.invocationRef,
        )
      ) {
        throw new OperationIdentityConflictError(identity.requestId);
      }
      if (
        existing.settlement &&
        this.unresolved >= this.options.maxUnresolved
      ) {
        throw new OperationCapacityError();
      }
      if (!existing.settlement) {
        this.settle(
          existing.identity.requestId,
          existing.identity.invocationRef,
          this.options.supersededOutcome(),
          {
            actor: {
              actorInstanceId: existing.identity.owner.actorInstanceId,
              snapshotRevision: existing.identity.owner.actorRevision,
              transactionSequence: 0,
            },
            acknowledgedAt: this.options.now(),
          },
        );
      }
      if (this.entries.get(identity.requestId) !== existing) {
        return this.admit(identity);
      }
      if (this.unresolved >= this.options.maxUnresolved) {
        throw new OperationCapacityError();
      }
      this.entries.delete(identity.requestId);
    }
    if (this.unresolved >= this.options.maxUnresolved) {
      throw new OperationCapacityError();
    }
    const entry: OperationEntry<Outcome, InvocationRef> = {
      identity: Object.freeze({
        ...identity,
        owner: Object.freeze({ ...identity.owner }),
      }),
      deferred: deferred(),
      listeners: new Set(),
    };
    this.entries.set(identity.requestId, entry);
    this.unresolved += 1;
    return { kind: "fresh", ticket: this.ticket(entry) };
  }

  /**
   * Reattaches a matching retained operation before fresh actor admission.
   * This never creates authoritative state.
   */
  reattach(
    identity: OperationAdmissionIdentity<InvocationRef>,
  ):
    | Extract<
        OperationAdmission<Outcome, InvocationRef>,
        { readonly kind: "coalesced" | "replayed" }
      >
    | undefined {
    const existing = this.entries.get(identity.requestId);
    if (!existing) return undefined;
    if (
      existing.identity.fingerprint !== identity.fingerprint ||
      !sameLogicalOwner(existing.identity.owner, identity.owner)
    ) {
      throw new OperationIdentityConflictError(identity.requestId);
    }
    return {
      kind: existing.settlement ? "replayed" : "coalesced",
      ticket: this.ticket(existing),
    };
  }

  settle(
    requestId: RequestId,
    invocationRef: InvocationRef,
    outcome: Outcome,
    receipt: OperationReceiptMetadata,
  ): boolean {
    const entry = this.entries.get(requestId);
    if (
      !entry ||
      entry.settlement ||
      !this.options.sameInvocationRef(
        entry.identity.invocationRef,
        invocationRef,
      )
    ) {
      return false;
    }
    const settlement = Object.freeze({
      requestId,
      invocationRef,
      outcome,
      receipt: Object.freeze({
        actor: Object.freeze({ ...receipt.actor }),
        acknowledgedAt: receipt.acknowledgedAt,
      }),
    });
    entry.settlement = settlement;
    this.unresolved -= 1;
    entry.deferred.resolve(settlement);
    for (const listener of Array.from(entry.listeners)) {
      try {
        listener(settlement);
      } catch (error) {
        this.report(error);
      }
    }
    entry.listeners.clear();
    this.trimSettledReplay();
    return true;
  }

  settleDisposed(
    cause: OperationDisposalCause,
    matches: (owner: OperationOwner) => boolean = () => true,
  ): number {
    let settled = 0;
    for (const entry of Array.from(this.entries.values())) {
      if (entry.settlement || !matches(entry.identity.owner)) continue;
      if (
        this.settle(
          entry.identity.requestId,
          entry.identity.invocationRef,
          this.options.disposalOutcome(cause),
          {
            actor: {
              actorInstanceId: entry.identity.owner.actorInstanceId,
              snapshotRevision: entry.identity.owner.actorRevision,
              transactionSequence: 0,
            },
            acknowledgedAt: this.options.now(),
          },
        )
      ) {
        settled += 1;
      }
    }
    return settled;
  }

  settleActor(actorInstanceId: ActorInstanceId): number {
    return this.settleDisposed(
      "actor",
      (owner) => owner.actorInstanceId === actorInstanceId,
    );
  }

  settleKey(hostId: string, machineId: string, keyId: string): number {
    return this.settleDisposed(
      "key",
      (owner) =>
        owner.hostId === hostId &&
        owner.machineId === machineId &&
        owner.keyId === keyId,
    );
  }

  settleMachine(hostId: string, machineId: string): number {
    return this.settleDisposed(
      "machine",
      (owner) => owner.hostId === hostId && owner.machineId === machineId,
    );
  }

  settleHost(hostId: string): number {
    return this.settleDisposed("host", (owner) => owner.hostId === hostId);
  }

  settleWindowSession(windowSessionId: string): number {
    return this.settleDisposed(
      "window-session",
      (owner) => owner.windowSessionId === windowSessionId,
    );
  }

  has(requestId: RequestId): boolean {
    return this.entries.has(requestId);
  }

  inspect(): {
    readonly unresolved: number;
    readonly settled: number;
    readonly total: number;
  } {
    return {
      unresolved: this.unresolved,
      settled: this.entries.size - this.unresolved,
      total: this.entries.size,
    };
  }

  onDispose(listener: () => void): () => void {
    if (this.disposed) {
      listener();
      return () => undefined;
    }
    this.disposeListeners.add(listener);
    return () => this.disposeListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.settleDisposed("host");
    for (const entry of this.entries.values()) entry.listeners.clear();
    this.entries.clear();
    this.unresolved = 0;
    for (const listener of Array.from(this.disposeListeners)) {
      try {
        listener();
      } catch (error) {
        this.report(error);
      }
    }
    this.disposeListeners.clear();
  }

  enqueueFailureOutcome(error: unknown): Outcome {
    return this.options.enqueueFailureOutcome(error);
  }

  rollbackAdmission(
    requestId: RequestId,
    invocationRef: InvocationRef,
    error: unknown,
  ): boolean {
    const entry = this.entries.get(requestId);
    if (
      !entry ||
      entry.settlement ||
      !this.options.sameInvocationRef(
        entry.identity.invocationRef,
        invocationRef,
      )
    ) {
      return false;
    }
    this.entries.delete(requestId);
    this.unresolved -= 1;
    entry.listeners.clear();
    // The helper may fail before returning the fresh ticket. Mark the internal
    // promise handled while preserving rejection for any reentrant coalescer.
    void entry.deferred.promise.catch(() => undefined);
    entry.deferred.reject(error);
    return true;
  }

  reportFailure(error: unknown): void {
    this.report(error);
  }

  private ticket(
    entry: OperationEntry<Outcome, InvocationRef>,
  ): OperationTicket<Outcome, InvocationRef> {
    if (entry.ticket) return entry.ticket;
    entry.ticket = Object.freeze({
      requestId: entry.identity.requestId,
      invocationRef: entry.identity.invocationRef,
      settled: entry.deferred.promise,
      subscribe: (
        listener: (
          settlement: OperationSettlement<Outcome, InvocationRef>,
        ) => void,
      ) => {
        if (entry.settlement) {
          try {
            listener(entry.settlement);
          } catch (error) {
            this.report(error);
          }
          return () => undefined;
        }
        entry.listeners.add(listener);
        return () => entry.listeners.delete(listener);
      },
    });
    return entry.ticket;
  }

  private trimSettledReplay(): void {
    let settledCount = this.entries.size - this.unresolved;
    if (settledCount <= this.options.maxSettledReplay) return;
    for (const [requestId, entry] of this.entries) {
      if (!entry.settlement) continue;
      this.entries.delete(requestId);
      settledCount -= 1;
      if (settledCount <= this.options.maxSettledReplay) return;
    }
  }

  private report(error: unknown): void {
    try {
      this.options.reportError?.(error);
    } catch {
      // Error reporting cannot corrupt settlement.
    }
  }
}

export interface AdmitOperationAndEnqueueOptions<
  Outcome,
  InvocationRef,
  EnqueueResult,
> {
  readonly registry: OperationRegistry<Outcome, InvocationRef>;
  readonly identity: OperationAdmissionIdentity<InvocationRef>;
  readonly retry?: "new-invocation";
  readonly enqueue: () => EnqueueResult;
  readonly receiptOnEnqueueFailure: () => OperationReceiptMetadata;
}

export interface FinalizeOperationAdmissionOptions<
  Outcome,
  InvocationRef,
  EnqueueResult,
> extends AdmitOperationAndEnqueueOptions<
  Outcome,
  InvocationRef,
  EnqueueResult
> {
  /**
   * Synchronously rechecks authorization lifetime, actor instance/revision,
   * keyed gate, host, machine, key, and window session immediately before the
   * operation is registered.
   */
  readonly assertFinalAdmission: () => void;
}

/**
 * The final admission linearization point. There is deliberately no async
 * boundary between authoritative registration and trusted-event enqueue.
 */
export function admitOperationAndEnqueue<Outcome, InvocationRef, EnqueueResult>(
  options: AdmitOperationAndEnqueueOptions<
    Outcome,
    InvocationRef,
    EnqueueResult
  >,
):
  | {
      readonly kind: "enqueued";
      readonly operation: OperationTicket<Outcome, InvocationRef>;
      readonly enqueueResult: EnqueueResult;
    }
  | {
      readonly kind: "coalesced" | "replayed";
      readonly operation: OperationTicket<Outcome, InvocationRef>;
    } {
  const admission = options.registry.admit(
    options.identity,
    options.retry ? { retry: options.retry } : undefined,
  );
  if (admission.kind !== "fresh") {
    return { kind: admission.kind, operation: admission.ticket };
  }
  try {
    const enqueueResult = options.enqueue();
    if (
      ((typeof enqueueResult === "object" && enqueueResult !== null) ||
        typeof enqueueResult === "function") &&
      "then" in enqueueResult
    ) {
      throw new Error(
        "Authoritative operation enqueue must be synchronous and non-thenable",
      );
    }
    return {
      kind: "enqueued",
      operation: admission.ticket,
      enqueueResult,
    };
  } catch (error) {
    try {
      options.registry.settle(
        options.identity.requestId,
        options.identity.invocationRef,
        options.registry.enqueueFailureOutcome(error),
        options.receiptOnEnqueueFailure(),
      );
    } catch (settlementError) {
      options.registry.rollbackAdmission(
        options.identity.requestId,
        options.identity.invocationRef,
        settlementError,
      );
      options.registry.reportFailure(settlementError);
    }
    throw error;
  }
}

export function finalizeOperationAdmission<
  Outcome,
  InvocationRef,
  EnqueueResult,
>(
  options: FinalizeOperationAdmissionOptions<
    Outcome,
    InvocationRef,
    EnqueueResult
  >,
): ReturnType<
  typeof admitOperationAndEnqueue<Outcome, InvocationRef, EnqueueResult>
> {
  if (!options.retry) {
    const retained = options.registry.reattach(options.identity);
    if (retained) {
      return { kind: retained.kind, operation: retained.ticket };
    }
  }
  options.assertFinalAdmission();
  return admitOperationAndEnqueue(options);
}

export interface OperationActorDisposalSource {
  onActorDisposed(
    listener: (event: {
      readonly machineId: string;
      readonly key: unknown;
      readonly metadata: { readonly actorInstanceId: ActorInstanceId };
      readonly cause: ActorDisposalCause;
    }) => void,
  ): () => void;
}

export interface OperationWindowSessionDisposalSource {
  onWindowSessionDisposed(
    listener: (windowSessionId: string) => void,
  ): () => void;
}

/**
 * Narrow lifecycle composition for authoritative operation ownership. Actor
 * events cover key, machine, and host bulk disposal because those paths dispose
 * every owned actor; the window-session signal covers client-owner teardown.
 */
export function bindOperationRegistryLifetimes<
  Outcome,
  InvocationRef,
>(options: {
  readonly registry: OperationRegistry<Outcome, InvocationRef>;
  readonly actors: OperationActorDisposalSource;
  readonly windowSessions: OperationWindowSessionDisposalSource;
  readonly hostId: string;
  readonly keyToId: (machineId: string, key: unknown) => string;
}): () => void {
  let active = true;
  const removeActor = options.actors.onActorDisposed((event) => {
    switch (event.cause) {
      case "machine-disposal":
        options.registry.settleMachine(options.hostId, event.machineId);
        return;
      case "shutdown":
        options.registry.settleHost(options.hostId);
        return;
      case "explicit":
      case "entity-deletion":
        options.registry.settleKey(
          options.hostId,
          event.machineId,
          options.keyToId(event.machineId, event.key),
        );
        return;
      case "idle":
      case "terminal":
        options.registry.settleActor(event.metadata.actorInstanceId);
        return;
    }
  });
  const removeWindowSession = options.windowSessions.onWindowSessionDisposed(
    (windowSessionId) => {
      options.registry.settleWindowSession(windowSessionId);
    },
  );
  let removeRegistryDispose: () => void = () => undefined;
  const dispose = () => {
    if (!active) return;
    active = false;
    removeActor();
    removeWindowSession();
    removeRegistryDispose();
  };
  removeRegistryDispose = options.registry.onDispose(dispose);
  return dispose;
}

export function createOperationOutcomePublisher<Outcome, InvocationRef>(
  registry: OperationRegistry<Outcome, InvocationRef>,
  captureReceipt: (
    outcome: CorrelatedOperationOutcome<Outcome, InvocationRef>,
  ) => OperationReceiptMetadata,
): (outcome: CorrelatedOperationOutcome<Outcome, InvocationRef>) => void {
  return (outcome) => {
    // Capture mutable actor transaction metadata synchronously at the
    // post-commit publication point, before any settlement callback can reenter.
    const receipt = captureReceipt(outcome);
    registry.settle(
      outcome.requestId,
      outcome.invocationRef,
      outcome.outcome,
      receipt,
    );
  };
}
