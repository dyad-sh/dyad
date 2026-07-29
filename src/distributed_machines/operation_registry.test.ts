import { describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { TransactionalDispatcher } from "@/state_machines/dispatcher";
import type { InvocationRef } from "@/state_machines/invocation_ref";
import { change } from "@/state_machines/types";
import {
  bindOperationRegistryLifetimes,
  createOperationOutcomePublisher,
  finalizeOperationAdmission,
  OperationCapacityError,
  OperationIdentityConflictError,
  OperationRegistry,
  type CorrelatedOperationOutcome,
  type OperationAdmissionIdentity,
  type OperationDisposalCause,
  type OperationReceiptMetadata,
} from "./operation_registry";
import type { RequestId } from "./request_identity";

type Ref = InvocationRef<"operation-test", string>;

type Outcome =
  | { readonly kind: "succeeded"; readonly value?: number }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "superseded" }
  | { readonly kind: "disposed"; readonly cause: OperationDisposalCause };

function registry(maxUnresolved = 8, maxSettledReplay = 4) {
  return new OperationRegistry<Outcome, Ref>({
    maxUnresolved,
    maxSettledReplay,
    now: () => 100,
    disposalOutcome: (cause) => ({ kind: "disposed", cause }),
    supersededOutcome: () => ({ kind: "superseded" }),
    enqueueFailureOutcome: (error) => ({
      kind: "failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  });
}

function identity(
  request = "request-one",
  invocation = "invocation-one",
  overrides: Partial<
    OperationAdmissionIdentity<Ref>["owner"] & { fingerprint: string }
  > = {},
): OperationAdmissionIdentity<Ref> {
  return {
    requestId: request as RequestId,
    invocationRef: {
      kind: "operation-test",
      entityKey: overrides.keyId ?? "key",
      operationId: invocation,
    },
    fingerprint: overrides.fingerprint ?? "fingerprint",
    owner: {
      hostId: overrides.hostId ?? "host",
      machineId: overrides.machineId ?? "machine",
      keyId: overrides.keyId ?? "key",
      actorInstanceId: overrides.actorInstanceId ?? "actor",
      actorRevision: overrides.actorRevision ?? 3,
      windowSessionId: overrides.windowSessionId ?? "window",
    },
  };
}

function finalAdmission(identity: OperationAdmissionIdentity<Ref>) {
  return {
    identity,
    createInvocationRef: () => identity.invocationRef,
  };
}

function receipt(revision = 4): OperationReceiptMetadata {
  return {
    actor: {
      actorInstanceId: "actor",
      snapshotRevision: revision,
      transactionSequence: 9,
    },
    acknowledgedAt: 100,
  };
}

describe("OperationRegistry", () => {
  it.each([
    { kind: "succeeded", value: 1 } satisfies Outcome,
    { kind: "failed", error: "expected" } satisfies Outcome,
    { kind: "cancelled" } satisfies Outcome,
    { kind: "superseded" } satisfies Outcome,
  ])("settles $kind exactly once", async (outcome) => {
    const operations = registry();
    const admitted = operations.admit(identity());

    expect(
      operations.settle(
        admitted.ticket.requestId,
        admitted.ticket.invocationRef,
        outcome,
        receipt(),
      ),
    ).toBe(true);
    expect(
      operations.settle(
        admitted.ticket.requestId,
        admitted.ticket.invocationRef,
        { kind: "cancelled" },
        receipt(99),
      ),
    ).toBe(false);
    await expect(admitted.ticket.settled).resolves.toMatchObject({ outcome });
  });

  it("coalesces pending duplicates, replays settled ones, and rejects conflicts", async () => {
    const operations = registry();
    const stable = identity();
    const fresh = operations.admit(stable);
    const duplicate = operations.admit({
      ...stable,
      invocationRef: { ...stable.invocationRef },
    });
    expect(duplicate.kind).toBe("coalesced");
    expect(duplicate.ticket).toBe(fresh.ticket);

    expect(() =>
      operations.admit(
        identity("request-one", "invocation-one", {
          fingerprint: "different",
        }),
      ),
    ).toThrow(OperationIdentityConflictError);
    operations.settle(
      stable.requestId,
      stable.invocationRef,
      { kind: "succeeded" },
      receipt(),
    );
    expect(operations.admit(stable).kind).toBe("replayed");
  });

  it("pins unresolved entries when settled replay reaches capacity", () => {
    const operations = registry(2, 1);
    operations.admit(identity("pending-one"));
    operations.admit(identity("pending-two", "invocation-two"));
    expect(() =>
      operations.admit(identity("pending-three", "invocation-three")),
    ).toThrow(OperationCapacityError);
    expect(operations.inspect()).toEqual({
      unresolved: 2,
      settled: 0,
      total: 2,
    });
  });

  it("classifies expected identity and capacity admission failures", () => {
    const operations = registry(1);
    operations.admit(identity());

    expect(
      (() => {
        try {
          operations.admit(
            identity("request-one", "invocation-one", {
              fingerprint: "conflict",
            }),
          );
        } catch (error) {
          return error;
        }
      })(),
    ).toMatchObject({ kind: DyadErrorKind.Conflict });
    expect(
      (() => {
        try {
          operations.admit(identity("request-two", "invocation-two"));
        } catch (error) {
          return error;
        }
      })(),
    ).toMatchObject({ kind: DyadErrorKind.RateLimited });
  });

  it("bounds settled replay independently without dropping pending work", () => {
    const operations = registry(2, 1);
    const first = identity("settled-one");
    operations.admit(first);
    operations.settle(
      first.requestId,
      first.invocationRef,
      { kind: "succeeded" },
      receipt(),
    );
    const pending = identity("pending", "pending-invocation");
    operations.admit(pending);
    const second = identity("settled-two", "settled-invocation-two");
    operations.admit(second);
    operations.settle(
      second.requestId,
      second.invocationRef,
      { kind: "succeeded" },
      receipt(),
    );

    expect(operations.has(first.requestId)).toBe(false);
    expect(operations.has(pending.requestId)).toBe(true);
    expect(operations.has(second.requestId)).toBe(true);
  });

  it("releases entries and listeners when replay retention is disabled", async () => {
    const operations = registry(2, 0);
    const admitted = operations.admit(identity());
    const listener = vi.fn();
    const release = admitted.ticket.subscribe(listener);
    release();
    operations.settle(
      admitted.ticket.requestId,
      admitted.ticket.invocationRef,
      { kind: "succeeded" },
      receipt(),
    );

    await admitted.ticket.settled;
    expect(listener).not.toHaveBeenCalled();
    expect(operations.inspect()).toEqual({
      unresolved: 0,
      settled: 0,
      total: 0,
    });
  });

  it("settles tickets but releases registry-owned entries on host disposal", async () => {
    const operations = registry();
    const admitted = operations.admit(identity());

    operations.dispose();

    await expect(admitted.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "disposed", cause: "host" },
    });
    expect(operations.inspect()).toEqual({
      unresolved: 0,
      settled: 0,
      total: 0,
    });
  });

  it.each([
    [
      "actor",
      (operations: ReturnType<typeof registry>) =>
        operations.settleActor("actor"),
    ],
    [
      "key",
      (operations: ReturnType<typeof registry>) =>
        operations.settleKey("host", "machine", "key"),
    ],
    [
      "machine",
      (operations: ReturnType<typeof registry>) =>
        operations.settleMachine("host", "machine"),
    ],
    [
      "host",
      (operations: ReturnType<typeof registry>) =>
        operations.settleHost("host"),
    ],
    [
      "window-session",
      (operations: ReturnType<typeof registry>) =>
        operations.settleWindowSession("window"),
    ],
  ] as const)(
    "settles every operation owned by %s disposal",
    async (cause, dispose) => {
      const operations = registry();
      const first = operations.admit(identity("one"));
      const second = operations.admit(identity("two", "two"));

      expect(dispose(operations)).toBe(2);
      await expect(first.ticket.settled).resolves.toMatchObject({
        outcome: { kind: "disposed", cause },
      });
      await expect(second.ticket.settled).resolves.toMatchObject({
        outcome: { kind: "disposed", cause },
      });
    },
  );

  it.each(["outcome", "clock"] as const)(
    "rejects every operation and completes cleanup when disposal %s throws",
    async (failureStage) => {
      const failure = new Error(`disposal ${failureStage} failed`);
      const reported: unknown[] = [];
      const operations = new OperationRegistry<Outcome, Ref>({
        maxUnresolved: 4,
        maxSettledReplay: 4,
        now:
          failureStage === "clock"
            ? () => {
                throw failure;
              }
            : () => 100,
        disposalOutcome:
          failureStage === "outcome"
            ? () => {
                throw failure;
              }
            : (cause) => ({ kind: "disposed", cause }),
        supersededOutcome: () => ({ kind: "superseded" }),
        enqueueFailureOutcome: () => ({
          kind: "failed",
          error: "enqueue",
        }),
        reportError: (error) => reported.push(error),
      });
      const first = operations.admit(identity("first"));
      const second = operations.admit(identity("second", "second-ref"));
      const firstRejected = expect(first.ticket.settled).rejects.toBe(failure);
      const secondRejected = expect(second.ticket.settled).rejects.toBe(
        failure,
      );
      const disposed = vi.fn();
      operations.onDispose(disposed);

      operations.dispose();

      await firstRejected;
      await secondRejected;
      expect(operations.inspect()).toEqual({
        unresolved: 0,
        settled: 0,
        total: 0,
      });
      expect(disposed).toHaveBeenCalledOnce();
      expect(reported).toEqual([failure, failure]);
      expect(() => operations.dispose()).not.toThrow();
    },
  );

  it("rejects stale invocation settlement after an explicit retry", async () => {
    const operations = registry();
    const stable = identity();
    const old = operations.admit(stable);
    const replacementIdentity = identity("request-one", "invocation-two");
    const replacement = operations.admit(replacementIdentity, {
      retry: "new-invocation",
    });

    await expect(old.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "superseded" },
    });
    expect(
      operations.settle(
        stable.requestId,
        stable.invocationRef,
        { kind: "succeeded" },
        receipt(),
      ),
    ).toBe(false);
    expect(
      operations.settle(
        replacementIdentity.requestId,
        replacementIdentity.invocationRef,
        { kind: "succeeded" },
        receipt(),
      ),
    ).toBe(true);
    await expect(replacement.ticket.settled).resolves.toMatchObject({
      invocationRef: replacementIdentity.invocationRef,
    });
  });

  it("compares the complete shared invocation identity", () => {
    const operations = registry();
    const stable = identity();
    operations.admit(stable);

    expect(() =>
      operations.admit({
        ...stable,
        invocationRef: {
          ...stable.invocationRef,
          entityKey: "other-key",
        },
      }),
    ).toThrow(OperationIdentityConflictError);
  });

  it("rejects an explicit retry that reuses the runtime InvocationRef", () => {
    const operations = registry();
    const stable = identity();
    operations.admit(stable);

    expect(() =>
      operations.admit({ ...stable }, { retry: "new-invocation" }),
    ).toThrow(OperationIdentityConflictError);
    expect(operations.inspect()).toEqual({
      unresolved: 1,
      settled: 0,
      total: 1,
    });
  });

  it.each(["outcome", "clock"] as const)(
    "rejects the old invocation when supersession %s mapping throws",
    async (failureStage) => {
      const failure = new Error(`supersession ${failureStage} failed`);
      const reported: unknown[] = [];
      const operations = new OperationRegistry<Outcome, Ref>({
        maxUnresolved: 2,
        maxSettledReplay: 2,
        now:
          failureStage === "clock"
            ? () => {
                throw failure;
              }
            : () => 100,
        disposalOutcome: (cause) => ({ kind: "disposed", cause }),
        supersededOutcome:
          failureStage === "outcome"
            ? () => {
                throw failure;
              }
            : () => ({ kind: "superseded" }),
        enqueueFailureOutcome: () => ({
          kind: "failed",
          error: "enqueue",
        }),
        reportError: (error) => reported.push(error),
      });
      const old = operations.admit(identity());
      const rejected = expect(old.ticket.settled).rejects.toBe(failure);

      expect(() =>
        operations.admit(identity("request-one", "invocation-two"), {
          retry: "new-invocation",
        }),
      ).toThrow(failure);
      await rejected;
      expect(operations.inspect()).toEqual({
        unresolved: 0,
        settled: 1,
        total: 1,
      });
      expect(reported).toEqual([failure]);
    },
  );

  it("preserves settled replay when retry capacity is exhausted", () => {
    const operations = registry(1);
    const retained = identity();
    operations.admit(retained);
    operations.settle(
      retained.requestId,
      retained.invocationRef,
      { kind: "succeeded" },
      receipt(),
    );
    operations.admit(identity("other", "other-invocation"));

    expect(() =>
      operations.admit(identity("request-one", "invocation-two"), {
        retry: "new-invocation",
      }),
    ).toThrow(OperationCapacityError);
    expect(operations.admit(retained).kind).toBe("replayed");
  });

  it("reattaches by logical identity without reproducing runtime identity", async () => {
    const operations = registry();
    const stable = identity();
    const original = operations.admit(stable);
    operations.settle(
      stable.requestId,
      stable.invocationRef,
      { kind: "succeeded" },
      receipt(),
    );
    const assertFinalAdmission = vi.fn();
    const enqueue = vi.fn();

    const retained = finalizeOperationAdmission({
      registry: operations,
      ...finalAdmission(
        identity("request-one", "unknown-retry-invocation", {
          actorInstanceId: "replacement-actor",
          actorRevision: 99,
        }),
      ),
      assertFinalAdmission,
      enqueue,
      receiptOnEnqueueFailure: receipt,
    });

    expect(retained.kind).toBe("replayed");
    expect(retained.operation).toBe(original.ticket);
    expect(assertFinalAdmission).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    await expect(retained.operation.settled).resolves.toMatchObject({
      invocationRef: stable.invocationRef,
    });
  });

  it("coalesces a retry admitted by hostile settlement reentry", () => {
    const operations = registry();
    const firstIdentity = identity();
    const replacementIdentity = identity("request-one", "invocation-two");
    const first = operations.admit(firstIdentity);
    let reentrant: ReturnType<typeof operations.admit> | undefined;
    first.ticket.subscribe(() => {
      reentrant = operations.admit(replacementIdentity, {
        retry: "new-invocation",
      });
    });

    const outer = operations.admit(replacementIdentity, {
      retry: "new-invocation",
    });

    expect(reentrant?.kind).toBe("fresh");
    expect(outer.kind).toBe("coalesced");
    expect(outer.ticket).toBe(reentrant?.ticket);
    expect(operations.inspect().unresolved).toBe(1);
  });

  it("captures immutable receipt metadata before hostile subscriber reentry", async () => {
    const operations = registry();
    const admitted = operations.admit(identity());
    const mutable = receipt();
    const observer = vi.fn(() => {
      (
        mutable.actor as {
          snapshotRevision: number;
        }
      ).snapshotRevision = 99;
    });
    admitted.ticket.subscribe(observer);

    operations.settle(
      admitted.ticket.requestId,
      admitted.ticket.invocationRef,
      { kind: "succeeded" },
      mutable,
    );

    const settlement = await admitted.ticket.settled;
    expect(observer).toHaveBeenCalledOnce();
    expect(settlement.receipt.actor.snapshotRevision).toBe(4);
  });

  it("replays settlement after subscription release and isolates listener failures", async () => {
    const reported: unknown[] = [];
    const operations = new OperationRegistry<Outcome, Ref>({
      maxUnresolved: 2,
      maxSettledReplay: 2,
      now: () => 100,
      disposalOutcome: (cause) => ({ kind: "disposed", cause }),
      supersededOutcome: () => ({ kind: "superseded" }),
      enqueueFailureOutcome: () => ({ kind: "failed", error: "enqueue" }),
      reportError: (error) => reported.push(error),
    });
    const admitted = operations.admit(identity());
    admitted.ticket.subscribe(() => {
      throw new Error("presentation failed");
    });
    const releasedObserver = vi.fn();
    admitted.ticket.subscribe(releasedObserver)();
    operations.settle(
      admitted.ticket.requestId,
      admitted.ticket.invocationRef,
      { kind: "succeeded" },
      receipt(),
    );
    const replay = operations.admit(identity());
    const replayObserver = vi.fn();
    replay.ticket.subscribe(replayObserver);

    expect(replay.kind).toBe("replayed");
    expect(replayObserver).toHaveBeenCalledOnce();
    expect(releasedObserver).not.toHaveBeenCalled();
    expect(reported).toHaveLength(1);
  });

  it("creates no operation until final revalidation and atomically enqueues", () => {
    const operations = registry();
    const order: string[] = [];
    const stable = identity();

    expect(() =>
      finalizeOperationAdmission({
        registry: operations,
        ...finalAdmission(stable),
        assertFinalAdmission: () => {
          order.push("revalidate");
          throw new Error("fenced");
        },
        enqueue: () => order.push("enqueue"),
        receiptOnEnqueueFailure: receipt,
      }),
    ).toThrow("fenced");
    expect(operations.inspect().total).toBe(0);

    finalizeOperationAdmission({
      registry: operations,
      ...finalAdmission(stable),
      assertFinalAdmission: () => order.push("revalidate-current-actor"),
      enqueue: () => {
        expect(operations.has(stable.requestId)).toBe(true);
        order.push("enqueue");
      },
      receiptOnEnqueueFailure: receipt,
    });
    expect(order).toEqual([
      "revalidate",
      "revalidate-current-actor",
      "revalidate-current-actor",
      "enqueue",
    ]);
  });

  it("revalidates after runtime invocation minting reentry", () => {
    const operations = registry();
    const stable = identity();
    let current = true;
    const enqueue = vi.fn();

    expect(() =>
      finalizeOperationAdmission({
        registry: operations,
        identity: stable,
        createInvocationRef: () => {
          current = false;
          return stable.invocationRef;
        },
        assertFinalAdmission: () => {
          if (!current) throw new Error("actor replaced during mint");
        },
        enqueue,
        receiptOnEnqueueFailure: receipt,
      }),
    ).toThrow("actor replaced during mint");
    expect(enqueue).not.toHaveBeenCalled();
    expect(operations.inspect().total).toBe(0);
  });

  it("replays a retained match without requiring fresh actor admission", () => {
    const operations = registry();
    const stable = identity();
    operations.admit(stable);
    operations.settle(
      stable.requestId,
      stable.invocationRef,
      { kind: "succeeded" },
      receipt(),
    );
    const assertFinalAdmission = vi.fn(() => {
      throw new Error("released subscription has no current actor");
    });

    const replay = finalizeOperationAdmission({
      registry: operations,
      ...finalAdmission(stable),
      assertFinalAdmission,
      enqueue: () => {
        throw new Error("must not enqueue replay");
      },
      receiptOnEnqueueFailure: receipt,
    });

    expect(replay.kind).toBe("replayed");
    expect(assertFinalAdmission).not.toHaveBeenCalled();
  });

  it.each(["key fenced", "actor replaced"])(
    "creates no operation when final admission detects %s",
    (failure) => {
      const operations = registry();
      expect(() =>
        finalizeOperationAdmission({
          registry: operations,
          ...finalAdmission(identity()),
          assertFinalAdmission: () => {
            throw new Error(failure);
          },
          enqueue: () => {
            throw new Error("must not enqueue");
          },
          receiptOnEnqueueFailure: receipt,
        }),
      ).toThrow(failure);
      expect(operations.inspect()).toEqual({
        unresolved: 0,
        settled: 0,
        total: 0,
      });
    },
  );

  it("settles a just-created operation when synchronous enqueue fails", async () => {
    const operations = registry();
    const stable = identity();
    expect(() =>
      finalizeOperationAdmission({
        registry: operations,
        ...finalAdmission(stable),
        assertFinalAdmission: () => undefined,
        enqueue: () => {
          throw new Error("enqueue failed");
        },
        receiptOnEnqueueFailure: receipt,
      }),
    ).toThrow("enqueue failed");

    const replay = operations.admit(stable);
    await expect(replay.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "failed", error: "enqueue failed" },
    });
  });

  it("rejects callable thenables as asynchronous enqueue results", () => {
    const operations = registry();
    const callableThenable = () => undefined;
    const thenProperty = String.fromCodePoint(116, 104, 101, 110);
    Object.defineProperty(callableThenable, thenProperty, {
      value: () => undefined,
    });

    expect(() =>
      finalizeOperationAdmission({
        registry: operations,
        ...finalAdmission(identity()),
        assertFinalAdmission: () => undefined,
        enqueue: () => callableThenable,
        receiptOnEnqueueFailure: receipt,
      }),
    ).toThrow("synchronous and non-thenable");
    expect(operations.inspect()).toEqual({
      unresolved: 0,
      settled: 1,
      total: 1,
    });
  });

  it("rejects an async enqueue before it can schedule delayed work", () => {
    const operations = registry();
    const invoked = vi.fn();
    const asyncEnqueue = (async () => {
      invoked();
    }) as unknown as () => void;

    expect(() =>
      finalizeOperationAdmission({
        registry: operations,
        ...finalAdmission(identity()),
        assertFinalAdmission: () => undefined,
        enqueue: asyncEnqueue,
        receiptOnEnqueueFailure: receipt,
      }),
    ).toThrow("synchronous and non-thenable");
    expect(invoked).not.toHaveBeenCalled();
    expect(operations.inspect().total).toBe(0);
  });

  it("atomically admits and enqueues an explicit replacement invocation", async () => {
    const operations = registry();
    const oldIdentity = identity();
    const old = operations.admit(oldIdentity);
    const replacementIdentity = identity("request-one", "invocation-two");
    const order: string[] = [];

    const replacement = finalizeOperationAdmission({
      registry: operations,
      ...finalAdmission(replacementIdentity),
      retry: "new-invocation",
      assertFinalAdmission: () => order.push("revalidated"),
      enqueue: () => {
        expect(operations.has(replacementIdentity.requestId)).toBe(true);
        order.push("enqueued");
      },
      receiptOnEnqueueFailure: receipt,
    });

    expect(replacement.kind).toBe("enqueued");
    expect(order).toEqual([
      "revalidated",
      "revalidated",
      "revalidated",
      "enqueued",
    ]);
    await expect(old.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "superseded" },
    });
    expect(
      operations.settle(
        oldIdentity.requestId,
        oldIdentity.invocationRef,
        { kind: "succeeded" },
        receipt(),
      ),
    ).toBe(false);
  });

  it("rolls back a replacement fenced by supersession reentry", () => {
    const operations = registry();
    const old = operations.admit(identity());
    let current = true;
    old.ticket.subscribe(() => {
      current = false;
    });
    const enqueue = vi.fn();

    expect(() =>
      finalizeOperationAdmission({
        registry: operations,
        ...finalAdmission(identity("request-one", "invocation-two")),
        retry: "new-invocation",
        assertFinalAdmission: () => {
          if (!current) throw new Error("fenced during supersession");
        },
        enqueue,
        receiptOnEnqueueFailure: receipt,
      }),
    ).toThrow("fenced during supersession");
    expect(enqueue).not.toHaveBeenCalled();
    expect(operations.inspect()).toEqual({
      unresolved: 0,
      settled: 0,
      total: 0,
    });
  });

  it.each(["outcome", "receipt"] as const)(
    "rolls back fresh admission when enqueue failure %s mapping throws",
    (failureStage) => {
      const reported: unknown[] = [];
      const mappingFailure = new Error(`${failureStage} mapping failed`);
      const operations = new OperationRegistry<Outcome, Ref>({
        maxUnresolved: 1,
        maxSettledReplay: 1,
        now: () => 100,
        disposalOutcome: (cause) => ({ kind: "disposed", cause }),
        supersededOutcome: () => ({ kind: "superseded" }),
        enqueueFailureOutcome:
          failureStage === "outcome"
            ? () => {
                throw mappingFailure;
              }
            : () => ({ kind: "failed", error: "enqueue" }),
        reportError: (error) => reported.push(error),
      });

      expect(() =>
        finalizeOperationAdmission({
          registry: operations,
          ...finalAdmission(identity()),
          assertFinalAdmission: () => undefined,
          enqueue: () => {
            throw new Error("enqueue failed");
          },
          receiptOnEnqueueFailure:
            failureStage === "receipt"
              ? () => {
                  throw mappingFailure;
                }
              : receipt,
        }),
      ).toThrow("enqueue failed");
      expect(operations.inspect()).toEqual({
        unresolved: 0,
        settled: 0,
        total: 0,
      });
      expect(reported).toContain(mappingFailure);
    },
  );

  it("binds actor and window-session disposal and unregisters bindings", async () => {
    const operations = registry();
    let actorListener:
      | ((event: {
          readonly machineId: string;
          readonly key: unknown;
          readonly metadata: { readonly actorInstanceId: string };
          readonly cause: "explicit";
        }) => void)
      | undefined;
    let windowListener: ((windowSessionId: string) => void) | undefined;
    const removeActor = vi.fn();
    const removeWindow = vi.fn();
    const unbind = bindOperationRegistryLifetimes({
      registry: operations,
      hostId: "host",
      keyToId: (_machineId, key) => String(key),
      actors: {
        onActorDisposed(listener) {
          actorListener = listener;
          return removeActor;
        },
      },
      windowSessions: {
        onWindowSessionDisposed(listener) {
          windowListener = listener;
          return removeWindow;
        },
      },
    });
    const actorOwned = operations.admit(identity("actor-owned"));
    actorListener?.({
      machineId: "machine",
      key: "key",
      metadata: { actorInstanceId: "actor" },
      cause: "explicit",
    });
    await expect(actorOwned.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "disposed", cause: "key" },
    });
    const windowOwned = operations.admit(
      identity("window-owned", "window-invocation", {
        actorInstanceId: "other-actor",
      }),
    );
    windowListener?.("window");
    await expect(windowOwned.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "disposed", cause: "window-session" },
    });

    operations.dispose();
    expect(removeActor).toHaveBeenCalledOnce();
    expect(removeWindow).toHaveBeenCalledOnce();
    unbind();
    expect(removeActor).toHaveBeenCalledOnce();
  });

  it("settles only correlated post-commit outcomes", async () => {
    const operations = registry();
    const admitted = operations.admit(identity());
    const publish = createOperationOutcomePublisher(operations, () =>
      receipt(),
    );
    publish({
      requestId: admitted.ticket.requestId,
      invocationRef: {
        kind: "operation-test",
        entityKey: "key",
        operationId: "stale",
      },
      outcome: { kind: "succeeded" },
    });
    expect(operations.inspect().unresolved).toBe(1);
    publish({
      requestId: admitted.ticket.requestId,
      invocationRef: admitted.ticket.invocationRef,
      outcome: { kind: "succeeded" },
    });
    await expect(admitted.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "succeeded" },
    });
  });

  it("settles the committed outcome before subscriber disposal reentry", async () => {
    const operations = registry();
    const stable = identity();
    const admitted = operations.admit(stable);
    const dispatcher = new TransactionalDispatcher<
      number,
      "TERMINAL",
      never,
      never,
      CorrelatedOperationOutcome<Outcome, Ref>
    >({
      initialState: 0,
      transition: (state) =>
        change(
          state + 1,
          [],
          [
            {
              requestId: stable.requestId,
              invocationRef: stable.invocationRef,
              outcome: { kind: "succeeded" },
            },
          ],
        ),
      runCommand: () => undefined,
      scheduler: { schedule: () => undefined },
      publishOutcome: createOperationOutcomePublisher(operations, () =>
        receipt(),
      ),
    });
    dispatcher.subscribe(() => {
      operations.settleWindowSession(stable.owner.windowSessionId);
    });

    dispatcher.send("TERMINAL");

    await expect(admitted.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "succeeded" },
    });
  });

  it("marks an entire committed outcome batch before settlement listener reentry", async () => {
    const operations = registry();
    const firstIdentity = identity("batch-first", "batch-first-ref");
    const secondIdentity = identity("batch-second", "batch-second-ref");
    const first = operations.admit(firstIdentity);
    const second = operations.admit(secondIdentity);
    first.ticket.subscribe(() => {
      operations.settleWindowSession(firstIdentity.owner.windowSessionId);
    });
    const dispatcher = new TransactionalDispatcher<
      number,
      "TERMINAL",
      never,
      never,
      CorrelatedOperationOutcome<Outcome, Ref>
    >({
      initialState: 0,
      transition: (state) =>
        change(
          state + 1,
          [],
          [
            {
              requestId: firstIdentity.requestId,
              invocationRef: firstIdentity.invocationRef,
              outcome: { kind: "succeeded" },
            },
            {
              requestId: secondIdentity.requestId,
              invocationRef: secondIdentity.invocationRef,
              outcome: { kind: "succeeded" },
            },
          ],
        ),
      runCommand: () => undefined,
      scheduler: { schedule: () => undefined },
      publishOutcome: createOperationOutcomePublisher(operations, () =>
        receipt(),
      ),
    });

    dispatcher.send("TERMINAL");

    await expect(first.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "succeeded" },
    });
    await expect(second.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "succeeded" },
    });
  });

  it("rejects and replays a terminal receipt-capture failure", async () => {
    const operations = registry();
    const stable = identity();
    const admitted = operations.admit(stable);
    const captureFailure = new Error("receipt capture failed");
    const publish = createOperationOutcomePublisher(operations, () => {
      throw captureFailure;
    });

    expect(() =>
      publish({
        requestId: stable.requestId,
        invocationRef: stable.invocationRef,
        outcome: { kind: "succeeded" },
      }),
    ).toThrow(captureFailure);
    await expect(admitted.ticket.settled).rejects.toBe(captureFailure);
    expect(operations.inspect()).toEqual({
      unresolved: 0,
      settled: 1,
      total: 1,
    });
    const replay = operations.admit(stable);
    expect(replay.kind).toBe("replayed");
    await expect(replay.ticket.settled).rejects.toBe(captureFailure);
  });

  it("does not confuse observer or scheduler handoff with completion", async () => {
    const operations = registry();
    const stable = identity();
    const admitted = operations.admit(stable);
    const observer = vi.fn();
    const scheduler = vi.fn();
    const dispatcher = new TransactionalDispatcher<
      number,
      "START" | "TERMINAL",
      never,
      never,
      CorrelatedOperationOutcome<Outcome, Ref>
    >({
      initialState: 0,
      transition: (state, event) =>
        event === "START"
          ? change(state + 1)
          : change(
              state + 1,
              [],
              [
                {
                  requestId: stable.requestId,
                  invocationRef: stable.invocationRef,
                  outcome: { kind: "succeeded" },
                },
              ],
            ),
      runCommand: () => undefined,
      scheduler: { schedule: scheduler },
      observer: { onTransitionApplied: observer },
      publishOutcome: createOperationOutcomePublisher(operations, () =>
        receipt(2),
      ),
    });

    dispatcher.send("START");
    expect(observer).toHaveBeenCalledOnce();
    expect(scheduler).toHaveBeenCalledOnce();
    expect(operations.inspect().unresolved).toBe(1);

    dispatcher.send("TERMINAL");
    await expect(admitted.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "succeeded" },
    });
  });
});
