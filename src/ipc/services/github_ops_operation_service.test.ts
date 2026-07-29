import { describe, expect, it } from "vitest";
import { OperationIdentityConflictError } from "@/distributed_machines/operation_registry";
import type {
  RequestId,
  RequestIdempotencyKey,
  RequestMessageId,
} from "@/distributed_machines/request_identity";
import { createFakeClock } from "@/state_machines/testing";
import type { WindowSessionId } from "@/window_infrastructure/types";
import { GithubOpsOperationService } from "./github_ops_operation_service";

const actor = {
  actorInstanceId: "github-actor",
  snapshotRevision: 3,
  transactionSequence: 4,
};
const requestIdentity = {
  requestId: "request-1" as RequestId,
  messageId: "message-1" as RequestMessageId,
  idempotencyKey: "idempotency-1" as RequestIdempotencyKey,
  windowSessionId: "window-1",
};
const event = {
  type: "OP_REQUESTED" as const,
  operationId: "operation-1",
  op: { type: "push" as const, mode: "normal" as const },
  requestId: requestIdentity.requestId,
  initiatorWindowSessionId: "window-1",
};

function prepare(service: GithubOpsOperationService, fingerprint: string) {
  return service.remoteContract().prepare({
    key: { appId: 7 },
    intent: event,
    event,
    sender: {
      windowSessionId: "window-1" as WindowSessionId,
    },
    actor,
    hostId: "main-remote-machine-host",
    fingerprint,
    requestIdentity,
  })!;
}

describe("GithubOpsOperationService", () => {
  it("coalesces live duplicates, replays terminal outcomes, and rejects identity reuse", async () => {
    const service = new GithubOpsOperationService(createFakeClock());
    const first = prepare(service, "fingerprint");
    const invocationRef = first.createInvocationRef();
    const admitted = first.registry.admit({
      ...first.identity,
      invocationRef,
    });
    const duplicate = prepare(service, "fingerprint");
    const coalesced = duplicate.registry.admit({
      ...duplicate.identity,
      invocationRef: duplicate.createInvocationRef(),
    });
    expect(coalesced.kind).toBe("coalesced");
    expect(service.inspect()).toEqual({
      unresolved: 1,
      settled: 0,
      total: 1,
    });

    first.registry.settle(
      requestIdentity.requestId,
      invocationRef,
      { kind: "succeeded", operation: "push" },
      { actor, acknowledgedAt: 1 },
    );
    await expect(admitted.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "succeeded" },
    });
    const replayed = duplicate.registry.admit({
      ...duplicate.identity,
      invocationRef: duplicate.createInvocationRef(),
    });
    expect(replayed.kind).toBe("replayed");

    const conflicting = prepare(service, "different-fingerprint");
    expect(() =>
      conflicting.registry.admit({
        ...conflicting.identity,
        invocationRef: conflicting.createInvocationRef(),
      }),
    ).toThrow(OperationIdentityConflictError);
  });

  it("settles disposal exactly once and releases terminal payloads by owner", async () => {
    const service = new GithubOpsOperationService(createFakeClock());
    const prepared = prepare(service, "fingerprint");
    const invocationRef = prepared.createInvocationRef();
    const admission = prepared.registry.admit({
      ...prepared.identity,
      invocationRef,
    });

    expect(service.settleActor(actor.actorInstanceId)).toBe(1);
    expect(service.settleActor(actor.actorInstanceId)).toBe(0);
    await expect(admission.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "cancelled", reason: "actor-disposed" },
    });
    expect(service.inspect()).toEqual({
      unresolved: 0,
      settled: 1,
      total: 1,
    });
    expect(service.releaseActor(actor.actorInstanceId)).toBe(0);
    expect(service.inspect()).toEqual({
      unresolved: 0,
      settled: 0,
      total: 0,
    });
  });
});
