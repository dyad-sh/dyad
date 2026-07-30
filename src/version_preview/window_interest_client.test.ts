import { describe, expect, it, vi } from "vitest";
import { PreparedRequestScope } from "@/distributed_machines/prepared_request";
import { RemoteMachineTransportError } from "@/distributed_machines/remote_client";
import type { VersionPreviewOperationOutcome } from "./operations";
import {
  VersionPreviewReleaseCancelledError,
  VersionPreviewWindowInterestClient,
} from "./window_interest_client";

function lease(ready: Promise<void> = Promise.resolve()) {
  return {
    ready,
    refresh: vi.fn(async () => undefined),
    release: vi.fn(),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function harness(
  receipts: (
    | { readonly kind: "applied"; readonly revision: number }
    | { readonly kind: "ignored"; readonly reason: string }
    | Error
  )[],
  leases: ReturnType<typeof lease>[],
  outcomes: VersionPreviewOperationOutcome[] = [],
) {
  const outcomeListeners = new Map<
    string,
    (outcome: unknown, metadata: unknown) => void
  >();
  const actor = {
    retain: vi.fn(() => {
      const next = leases.shift();
      if (!next) throw new Error("Unexpected lease acquisition");
      return next;
    }),
    getView: vi.fn(() => ({
      state: {
        appId: 7,
        revision: 1,
        state: { type: "closed" },
        activeInvocationRef: null,
        lastSettlement: null,
      },
      connection: "ready",
      snapshot: {
        kind: "available",
        observedRevision: {
          kind: "actor",
          actorInstanceId: "actor",
          revision: 1,
        },
      },
    })),
    subscribe: vi.fn(() => () => undefined),
    subscribeOperationOutcome: vi.fn((requestId, listener) => {
      outcomeListeners.set(requestId, listener);
      return () => outcomeListeners.delete(requestId);
    }),
    dispatch: vi.fn(async (_event, options) => {
      const next = receipts.shift();
      if (!next) throw new Error("Unexpected dispatch");
      if (next instanceof Error) throw next;
      if (options?.requestIdentity) {
        const outcome = outcomes.shift();
        if (outcome) {
          queueMicrotask(() => {
            const listener = outcomeListeners.get(
              options.requestIdentity.requestId,
            );
            listener?.(outcome, {
              actorInstanceId: "actor",
              snapshotRevision: 1,
              transactionSequence: 1,
            });
          });
        }
      }
      return {
        ...next,
        actorInstanceId: "actor",
        transactionSequence: 1,
        messageId: "message",
      };
    }),
  };
  const remote = { actor: vi.fn(() => actor) };
  return {
    actor,
    client: new VersionPreviewWindowInterestClient(
      remote as never,
      new PreparedRequestScope("window"),
    ),
  };
}

describe("VersionPreviewWindowInterestClient", () => {
  it("retains one generation-bearing lease across duplicate acquisition", async () => {
    const owned = lease();
    const transient = lease();
    const { actor, client } = harness(
      [{ kind: "applied", revision: 1 }],
      [owned, transient],
    );

    await expect(client.acquire(7)).resolves.toEqual({ acquired: true });
    await expect(client.acquire(7)).resolves.toEqual({ acquired: false });

    expect(actor.retain).toHaveBeenCalledTimes(2);
    expect(transient.release).toHaveBeenCalledOnce();
    expect(owned.release).not.toHaveBeenCalled();
    expect(owned.refresh).toHaveBeenCalledOnce();
    expect(client.inspectLeaseCount()).toBe(1);
  });

  it("releases the owned lease when bootstrap fails", async () => {
    const failure = new Error("bootstrap failed");
    const owned = lease(Promise.reject(failure));
    const { client } = harness([], [owned]);

    await expect(client.acquire(7)).rejects.toBe(failure);

    expect(owned.release).toHaveBeenCalledOnce();
    expect(client.inspectLeaseCount()).toBe(0);
  });

  it("relinquishes interest on disposal without closing the preview", async () => {
    const owned = lease();
    const acquireDispatchLease = lease();
    const releaseDispatchLease = lease();
    const { actor, client } = harness(
      [
        { kind: "applied", revision: 1 },
        { kind: "applied", revision: 2 },
      ],
      [owned, acquireDispatchLease, releaseDispatchLease],
    );

    await client.acquire(7);
    await client.dispose();

    expect(actor.dispatch.mock.calls.map(([event]) => event.type)).toEqual([
      "ACQUIRE_WINDOW_INTEREST",
      "RELEASE_WINDOW_INTEREST",
    ]);
    expect(owned.release).toHaveBeenCalledOnce();
    expect(client.inspectLeaseCount()).toBe(0);
  });

  it("releases an orphan-restore claim owned by another live window", async () => {
    const owned = lease();
    const transient = lease();
    const { client } = harness(
      [
        {
          kind: "ignored",
          reason: "interest-owned-by-another-window",
        },
      ],
      [owned, transient],
    );

    await expect(client.restoreIfOrphaned(7)).resolves.toEqual({
      acquired: false,
    });

    expect(transient.release).toHaveBeenCalledOnce();
    expect(owned.release).toHaveBeenCalledOnce();
    expect(client.inspectLeaseCount()).toBe(0);
  });

  it("does not admit interest after disposal wins during bootstrap", async () => {
    const bootstrap = deferred();
    const owned = lease(bootstrap.promise);
    const { actor, client } = harness([], [owned]);

    const acquisition = client.acquire(7);
    await vi.waitFor(() => expect(actor.retain).toHaveBeenCalledOnce());
    const disposal = client.dispose();
    bootstrap.resolve();

    await expect(acquisition).rejects.toThrow(
      "Window interest client is disposed",
    );
    await expect(disposal).resolves.toBeUndefined();
    expect(actor.dispatch).not.toHaveBeenCalled();
    expect(owned.release).toHaveBeenCalledOnce();
    expect(client.inspectLeaseCount()).toBe(0);
  });

  it("retries release delivery with one stable prepared request", async () => {
    const owned = lease();
    const acquireDispatchLease = lease();
    const firstReleaseDispatchLease = lease();
    const retryDispatchLease = lease();
    const { actor, client } = harness(
      [
        { kind: "applied", revision: 1 },
        new RemoteMachineTransportError("disconnected", "connection lost"),
        { kind: "applied", revision: 2 },
      ],
      [
        owned,
        acquireDispatchLease,
        firstReleaseDispatchLease,
        retryDispatchLease,
      ],
      [{ kind: "succeeded", operation: "close", cleanupStarted: true }],
    );

    await client.acquire(7);
    await expect(
      client.release(7, "release-operation", { type: "close" }),
    ).resolves.toEqual({ cleanupStarted: true });

    const releaseCalls = actor.dispatch.mock.calls.filter(
      ([event]) => event.type === "CLOSE",
    );
    expect(releaseCalls).toHaveLength(2);
    expect(releaseCalls[1]?.[1]?.requestIdentity).toEqual(
      releaseCalls[0]?.[1]?.requestIdentity,
    );
    expect(releaseCalls[1]?.[1]?.expected).toEqual(
      releaseCalls[0]?.[1]?.expected,
    );
    expect(owned.release).toHaveBeenCalledOnce();
    expect(client.inspectLeaseCount()).toBe(0);
  });

  it("surfaces authoritative cancellation as a typed release failure", async () => {
    const owned = lease();
    const acquireDispatchLease = lease();
    const releaseDispatchLease = lease();
    const { client } = harness(
      [
        { kind: "applied", revision: 1 },
        { kind: "applied", revision: 2 },
      ],
      [owned, acquireDispatchLease, releaseDispatchLease],
      [{ kind: "cancelled", reason: "window-disposed" }],
    );

    await client.acquire(7);
    const release = client.release(7, "release-operation", { type: "close" });

    await expect(release).rejects.toMatchObject({
      name: "VersionPreviewReleaseCancelledError",
      reason: "window-disposed",
    });
    await expect(release).rejects.toBeInstanceOf(
      VersionPreviewReleaseCancelledError,
    );
    expect(owned.release).toHaveBeenCalledOnce();
    expect(client.inspectLeaseCount()).toBe(0);
  });
});
