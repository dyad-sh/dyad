import { describe, expect, it } from "vitest";
import type { RequestId } from "@/distributed_machines/request_identity";
import type {
  ImageGenerationInvocationRef,
  ImageGenerationOperationOutcome,
} from "@/image_generation/state";
import { createFakeClock } from "@/state_machines/testing";
import {
  IMAGE_GENERATION_MAX_RETAINED_OPERATIONS,
  ImageGenerationOperationService,
} from "./image_generation_operation_service";

function invocation(jobId: string, operationId = `runtime:${jobId}`) {
  return {
    kind: "image-generation" as const,
    entityKey: jobId,
    operationId,
  };
}

function identity(
  requestId: string,
  invocationRef: ImageGenerationInvocationRef,
  windowSessionId = "window:a",
  keyId = "jobs",
  actorRevision = 0,
) {
  return {
    requestId: requestId as RequestId,
    invocationRef,
    fingerprint: `fingerprint:${requestId}`,
    owner: {
      hostId: "main",
      machineId: "image_generation",
      keyId,
      actorInstanceId: "actor:1",
      actorRevision,
      windowSessionId,
    },
  };
}

function succeeded(jobId: string): ImageGenerationOperationOutcome {
  return {
    kind: "succeeded",
    jobId,
    result: {
      fileName: `${jobId}.png`,
      appId: 7,
      appName: "App",
    },
  };
}

const receipt = {
  actor: {
    actorInstanceId: "actor:1",
    snapshotRevision: 1,
    transactionSequence: 1,
  },
  acknowledgedAt: 1,
};

describe("ImageGenerationOperationService", () => {
  it("allows a shared window to await an operation without changing presentation ownership", async () => {
    const service = new ImageGenerationOperationService(createFakeClock());
    const ref = invocation("job:1");
    service.registry.admit(identity("request:1", ref));
    service.registry.settle(
      "request:1" as RequestId,
      ref,
      succeeded("job:1"),
      receipt,
    );

    await expect(service.waitFor("request:1")).resolves.toEqual(
      succeeded("job:1"),
    );
    await expect(service.waitFor("request:1")).resolves.toEqual(
      succeeded("job:1"),
    );
  });

  it("reattaches a stable retry after actor revision advances", () => {
    const service = new ImageGenerationOperationService(createFakeClock());
    const ref = invocation("job:retry");
    service.registry.admit(identity("request:retry", ref));

    expect(
      service.registry.reattach(
        identity("request:retry", ref, "window:a", "jobs", 5),
      )?.kind,
    ).toBe("coalesced");

    expect(() =>
      service.registry.reattach({
        ...identity("request:retry", ref, "window:a", "jobs", 5),
        owner: {
          ...identity("request:retry", ref).owner,
          actorInstanceId: "actor:replacement",
          actorRevision: 5,
        },
      }),
    ).toThrow("conflicting identity");
  });

  it("ignores stale and duplicate terminal output by runtime identity", async () => {
    const service = new ImageGenerationOperationService(createFakeClock());
    const current = invocation("job:replacement", "runtime:new");
    service.registry.admit(identity("request:replacement", current));

    expect(
      service.registry.settle(
        "request:replacement" as RequestId,
        invocation("job:replacement", "runtime:old"),
        succeeded("job:replacement"),
        receipt,
      ),
    ).toBe(false);
    expect(
      service.registry.settle(
        "request:replacement" as RequestId,
        current,
        succeeded("job:replacement"),
        receipt,
      ),
    ).toBe(true);
    expect(
      service.registry.settle(
        "request:replacement" as RequestId,
        current,
        {
          kind: "failed",
          jobId: "job:replacement",
          message: "duplicate must not overwrite",
          failureKind: "provider",
        },
        receipt,
      ),
    ).toBe(false);

    await expect(service.waitFor("request:replacement")).resolves.toEqual(
      succeeded("job:replacement"),
    );
  });

  it("bounds terminal retention independently without evicting pending work", () => {
    const service = new ImageGenerationOperationService(createFakeClock());
    const pendingRef = invocation("job:pending");
    service.registry.admit(identity("request:pending", pendingRef));

    for (
      let index = 0;
      index < IMAGE_GENERATION_MAX_RETAINED_OPERATIONS + 3;
      index += 1
    ) {
      const ref = invocation(`job:${index}`);
      const requestId = `request:${index}` as RequestId;
      service.registry.admit(identity(requestId, ref));
      service.registry.settle(
        requestId,
        ref,
        succeeded(`job:${index}`),
        receipt,
      );
    }

    expect(service.inspect()).toEqual({
      unresolved: 1,
      settled: IMAGE_GENERATION_MAX_RETAINED_OPERATIONS,
      total: IMAGE_GENERATION_MAX_RETAINED_OPERATIONS + 1,
    });
    expect(
      service.registry.ticketFor("request:pending" as RequestId, () => true),
    ).toBeDefined();
  });

  it("settles and releases every operation at an actor ownership boundary", async () => {
    const service = new ImageGenerationOperationService(createFakeClock());
    const ref = invocation("job:1");
    const ticket = service.registry.admit(identity("request:1", ref)).ticket;

    expect(service.releaseActor("actor:1")).toBe(1);
    await expect(ticket.settled).resolves.toMatchObject({
      outcome: { kind: "disposed", cause: "actor" },
    });
    expect(service.inspect()).toEqual({ unresolved: 0, settled: 0, total: 0 });
  });

  it("releases manager ownership without retaining terminal payloads", async () => {
    const service = new ImageGenerationOperationService(createFakeClock());
    const ref = invocation("job:manager");
    const ticket = service.registry.admit(
      identity("request:manager", ref, "window:b"),
    ).ticket;
    const contract = service.remoteContract();

    expect(contract.releaseManager?.()).toBe(1);
    await expect(ticket.settled).resolves.toMatchObject({
      outcome: { kind: "disposed", cause: "host" },
    });
    expect(service.inspect()).toEqual({ unresolved: 0, settled: 0, total: 0 });
  });

  it("removes retained payloads at the deleted app ownership boundary", () => {
    const service = new ImageGenerationOperationService(createFakeClock());
    const deletedRef = invocation("job:deleted");
    const retainedRef = invocation("job:retained");
    service.registry.admit(
      identity("request:deleted", deletedRef, "window:a", "app:7"),
    );
    service.registry.admit(
      identity("request:retained", retainedRef, "window:a", "app:8"),
    );
    service.registry.settle(
      "request:deleted" as RequestId,
      deletedRef,
      succeeded("job:deleted"),
      receipt,
    );
    service.registry.settle(
      "request:retained" as RequestId,
      retainedRef,
      succeeded("job:retained"),
      receipt,
    );

    expect(service.releaseApp(7)).toBe(0);
    expect(
      service.registry.ticketFor("request:deleted" as RequestId, () => true),
    ).toBeUndefined();
    expect(
      service.registry.ticketFor("request:retained" as RequestId, () => true),
    ).toBeDefined();
  });
});
