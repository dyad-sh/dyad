import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  sameInvocationRef,
  type InvocationRef,
} from "@/state_machines/invocation_ref";
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

export interface OperationLookupIdentity {
  readonly requestId: RequestId;
  /** Complete immutable identity/fingerprint for conflict detection. */
  readonly fingerprint: string;
  readonly owner: OperationOwner;
}

export interface OperationAdmissionIdentity<
  Ref extends InvocationRef,
> extends OperationLookupIdentity {
  readonly invocationRef: Ref;
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

interface OperationEntry<Outcome, Ref extends InvocationRef> {
  readonly identity: OperationAdmissionIdentity<Ref>;
  readonly deferred: Deferred<OperationSettlement<Outcome, Ref>>;
  readonly listeners: Set<
    (settlement: OperationSettlement<Outcome, Ref>) => void
  >;
  ticket?: OperationTicket<Outcome, Ref>;
  settlement?: OperationSettlement<Outcome, Ref>;
  rejected: boolean;
  rejection?: unknown;
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

export interface OperationRegistryOptions<Outcome> {
  readonly maxUnresolved: number;
  readonly maxSettledReplay: number;
  readonly now: () => number;
  readonly disposalOutcome: (cause: OperationDisposalCause) => Outcome;
  readonly supersededOutcome: () => Outcome;
  readonly enqueueFailureOutcome: (error: unknown) => Outcome;
  readonly reportError?: (error: unknown) => void;
}

/**
 * In-process authoritative request settlement. Unresolved entries are pinned;
 * only independently bounded settled replay history is evicted.
 */
export class OperationRegistry<Outcome, Ref extends InvocationRef> {
  private readonly entries = new Map<RequestId, OperationEntry<Outcome, Ref>>();
  private unresolved = 0;
  private disposed = false;
  private readonly disposeListeners = new Set<() => void>();

  constructor(private readonly options: OperationRegistryOptions<Outcome>) {
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
    identity: OperationAdmissionIdentity<Ref>,
    options: { readonly retry?: "new-invocation" } = {},
  ): OperationAdmission<Outcome, Ref> {
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
          !sameInvocationRef(
            existing.identity.invocationRef,
            identity.invocationRef,
          )
        ) {
          throw new OperationIdentityConflictError(identity.requestId);
        }
        return {
          kind: this.isTerminal(existing) ? "replayed" : "coalesced",
          ticket: this.ticket(existing),
        };
      }
      if (
        sameInvocationRef(
          existing.identity.invocationRef,
          identity.invocationRef,
        )
      ) {
        throw new OperationIdentityConflictError(identity.requestId);
      }
      if (
        this.isTerminal(existing) &&
        this.unresolved >= this.options.maxUnresolved
      ) {
        throw new OperationCapacityError();
      }
      if (!this.isTerminal(existing)) {
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
    const entry: OperationEntry<Outcome, Ref> = {
      identity: Object.freeze({
        ...identity,
        owner: Object.freeze({ ...identity.owner }),
      }),
      deferred: deferred(),
      listeners: new Set(),
      rejected: false,
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
    identity: OperationLookupIdentity,
  ):
    | Extract<
        OperationAdmission<Outcome, Ref>,
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
      kind: this.isTerminal(existing) ? "replayed" : "coalesced",
      ticket: this.ticket(existing),
    };
  }

  settle(
    requestId: RequestId,
    invocationRef: Ref,
    outcome: Outcome,
    receipt: OperationReceiptMetadata,
  ): boolean {
    const entry = this.entries.get(requestId);
    if (
      !entry ||
      this.isTerminal(entry) ||
      !sameInvocationRef(entry.identity.invocationRef, invocationRef)
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
      if (this.isTerminal(entry) || !matches(entry.identity.owner)) continue;
      try {
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
      } catch (error) {
        this.reject(
          entry.identity.requestId,
          entry.identity.invocationRef,
          error,
        );
        this.report(error);
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
    try {
      this.settleDisposed("host");
    } finally {
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
  }

  enqueueFailureOutcome(error: unknown): Outcome {
    return this.options.enqueueFailureOutcome(error);
  }

  rollbackAdmission(
    requestId: RequestId,
    invocationRef: Ref,
    error: unknown,
  ): boolean {
    const entry = this.entries.get(requestId);
    if (
      !entry ||
      this.isTerminal(entry) ||
      !sameInvocationRef(entry.identity.invocationRef, invocationRef)
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

  reject(requestId: RequestId, invocationRef: Ref, error: unknown): boolean {
    const entry = this.entries.get(requestId);
    if (
      !entry ||
      this.isTerminal(entry) ||
      !sameInvocationRef(entry.identity.invocationRef, invocationRef)
    ) {
      return false;
    }
    entry.rejected = true;
    entry.rejection = error;
    this.unresolved -= 1;
    entry.listeners.clear();
    entry.deferred.reject(error);
    this.trimSettledReplay();
    return true;
  }

  private ticket(
    entry: OperationEntry<Outcome, Ref>,
  ): OperationTicket<Outcome, Ref> {
    if (entry.ticket) return entry.ticket;
    entry.ticket = Object.freeze({
      requestId: entry.identity.requestId,
      invocationRef: entry.identity.invocationRef,
      settled: entry.deferred.promise,
      subscribe: (
        listener: (settlement: OperationSettlement<Outcome, Ref>) => void,
      ) => {
        if (entry.settlement) {
          try {
            listener(entry.settlement);
          } catch (error) {
            this.report(error);
          }
          return () => undefined;
        }
        if (entry.rejected) return () => undefined;
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
      if (!this.isTerminal(entry)) continue;
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

  private isTerminal(entry: OperationEntry<Outcome, Ref>): boolean {
    return entry.settlement !== undefined || entry.rejected;
  }
}

export interface AdmitOperationAndEnqueueOptions<
  Outcome,
  Ref extends InvocationRef,
  EnqueueResult,
> {
  readonly registry: OperationRegistry<Outcome, Ref>;
  readonly identity: OperationAdmissionIdentity<Ref>;
  readonly retry?: "new-invocation";
  readonly enqueue: () => EnqueueResult extends PromiseLike<unknown>
    ? never
    : EnqueueResult;
  readonly receiptOnEnqueueFailure: () => OperationReceiptMetadata;
  readonly assertAfterRegistration?: () => void;
}

export interface FinalizeOperationAdmissionOptions<
  Outcome,
  Ref extends InvocationRef,
  EnqueueResult,
> extends Omit<
  AdmitOperationAndEnqueueOptions<Outcome, Ref, EnqueueResult>,
  "identity"
> {
  readonly identity: OperationLookupIdentity;
  /** Minted only after the final authoritative admission check succeeds. */
  readonly createInvocationRef: () => Ref;
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
export function admitOperationAndEnqueue<
  Outcome,
  Ref extends InvocationRef,
  EnqueueResult,
>(
  options: AdmitOperationAndEnqueueOptions<Outcome, Ref, EnqueueResult>,
):
  | {
      readonly kind: "enqueued";
      readonly operation: OperationTicket<Outcome, Ref>;
      readonly enqueueResult: EnqueueResult;
    }
  | {
      readonly kind: "coalesced" | "replayed";
      readonly operation: OperationTicket<Outcome, Ref>;
    } {
  if (options.enqueue.constructor.name === "AsyncFunction") {
    throw new Error(
      "Authoritative operation enqueue must be synchronous and non-thenable",
    );
  }
  const admission = options.registry.admit(
    options.identity,
    options.retry ? { retry: options.retry } : undefined,
  );
  if (admission.kind !== "fresh") {
    return { kind: admission.kind, operation: admission.ticket };
  }
  try {
    options.assertAfterRegistration?.();
  } catch (error) {
    options.registry.rollbackAdmission(
      options.identity.requestId,
      options.identity.invocationRef,
      error,
    );
    throw error;
  }
  try {
    const enqueueResult = options.enqueue();
    if (
      ((typeof enqueueResult === "object" && enqueueResult !== null) ||
        typeof enqueueResult === "function") &&
      "then" in enqueueResult
    ) {
      const thenable = enqueueResult as PromiseLike<unknown>;
      void Promise.resolve(thenable).catch((error) =>
        options.registry.reportFailure(error),
      );
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
  Ref extends InvocationRef,
  EnqueueResult,
>(
  options: FinalizeOperationAdmissionOptions<Outcome, Ref, EnqueueResult>,
): ReturnType<typeof admitOperationAndEnqueue<Outcome, Ref, EnqueueResult>> {
  if (!options.retry) {
    const retained = options.registry.reattach(options.identity);
    if (retained) {
      return { kind: retained.kind, operation: retained.ticket };
    }
  }
  options.assertFinalAdmission();
  const identity: OperationAdmissionIdentity<Ref> = {
    ...options.identity,
    invocationRef: options.createInvocationRef(),
  };
  // IdSource/mint adapters are injected synchronous code and may reenter
  // disposal or replacement before returning the runtime identity.
  options.assertFinalAdmission();
  return admitOperationAndEnqueue({
    ...options,
    identity,
    assertAfterRegistration: options.retry
      ? options.assertFinalAdmission
      : undefined,
  });
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
  Ref extends InvocationRef,
>(options: {
  readonly registry: OperationRegistry<Outcome, Ref>;
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

export function createOperationOutcomePublisher<
  Outcome,
  Ref extends InvocationRef,
>(
  registry: OperationRegistry<Outcome, Ref>,
  captureReceipt: (
    outcome: CorrelatedOperationOutcome<Outcome, Ref>,
  ) => OperationReceiptMetadata,
): (outcome: CorrelatedOperationOutcome<Outcome, Ref>) => void {
  return (outcome) => {
    // Capture mutable actor transaction metadata synchronously at the
    // post-commit publication point, before any settlement callback can reenter.
    let receipt: OperationReceiptMetadata;
    try {
      receipt = captureReceipt(outcome);
    } catch (error) {
      registry.reject(outcome.requestId, outcome.invocationRef, error);
      throw error;
    }
    registry.settle(
      outcome.requestId,
      outcome.invocationRef,
      outcome.outcome,
      receipt,
    );
  };
}
