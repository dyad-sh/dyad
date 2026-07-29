import { describe, expect, it, vi } from "vitest";
import { TransactionalDispatcher } from "@/state_machines/dispatcher";
import { change } from "@/state_machines/types";
import {
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

interface Ref {
  readonly id: string;
}

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
    sameInvocationRef: (left, right) => left.id === right.id,
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
    invocationRef: { id: invocation },
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
      invocationRef: { id: stable.invocationRef.id },
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
      sameInvocationRef: (left, right) => left.id === right.id,
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
        identity: stable,
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
      identity: stable,
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
      "enqueue",
    ]);
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
      identity: stable,
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
          identity: identity(),
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
        identity: stable,
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

  it("settles only correlated post-commit outcomes", async () => {
    const operations = registry();
    const admitted = operations.admit(identity());
    const publish = createOperationOutcomePublisher(operations, () =>
      receipt(),
    );
    publish({
      requestId: admitted.ticket.requestId,
      invocationRef: { id: "stale" },
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
