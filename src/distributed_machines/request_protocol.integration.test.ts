import { describe, expect, it } from "vitest";
import { change } from "@/state_machines/types";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { ActorHost } from "./actor_host";
import type { DistributedMachineDefinition } from "./definition";
import {
  bindOperationRegistryLifetimes,
  finalizeOperationAdmission,
  OperationRegistry,
  type OperationAdmissionIdentity,
} from "./operation_registry";
import { PreparedRequestScope } from "./prepared_request";
import { createCompletionAwareActor } from "./request_actor";
import type {
  RequestId,
  RequestIdentity,
  RequestIdempotencyKey,
  RequestMessageId,
} from "./request_identity";

function controlled() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("completion-aware actor request bridge", () => {
  it("registers the client handle before IPC while main registers only at final admission", async () => {
    type Outcome =
      | { readonly kind: "succeeded" }
      | {
          readonly kind: "disposed";
          readonly cause: "key" | "window-session";
        };
    type Ref = { readonly id: string };
    const authorization = controlled();
    const events: string[] = [];
    type State = { readonly value: number };
    type Event = { readonly type: "INCREMENT" };
    const definition: DistributedMachineDefinition<
      "request-test",
      string,
      State,
      Event,
      never,
      never
    > = {
      id: "request-test",
      host: "main",
      initialState: () => ({ value: 0 }),
      transition: (state) => change({ value: state.value + 1 }),
      createScheduler: () => ({ schedule: () => undefined }),
      createCommandRunner: () => () => undefined,
      lifecycle: {
        subscriptionCreates: true,
        dispatchCreates: false,
        idleEviction: { kind: "retain" },
        terminalRetention: { kind: "retain" },
        entityDeletion: "dispose",
        rendererOwnership: "window",
        survivesRendererReload: false,
        restartPersistence: "ephemeral",
        flushOnShutdown: false,
      },
    };
    const host = new ActorHost({
      placement: "main",
      clock: createFakeClock(),
      ids: createSequentialIdSource(),
    });
    host.register(definition);
    const hostedActor = host.ensure(definition, "key");
    const admissionGeneration = host.captureAdmissionGeneration(
      definition.id,
      "key",
    );
    const admittedActor = hostedActor.getMetadata();
    const registry = new OperationRegistry<Outcome, Ref>({
      maxUnresolved: 4,
      maxSettledReplay: 4,
      now: () => 1,
      sameInvocationRef: (left, right) => left.id === right.id,
      disposalOutcome: (cause) => ({
        kind: "disposed",
        cause: cause === "window-session" ? "window-session" : "key",
      }),
      supersededOutcome: () => ({ kind: "succeeded" }),
      enqueueFailureOutcome: () => ({ kind: "succeeded" }),
    });
    let windowSessionDisposed: ((windowSessionId: string) => void) | undefined;
    const unbindLifetimes = bindOperationRegistryLifetimes({
      registry,
      hostId: "host",
      keyToId: (_machineId, key) => String(key),
      actors: host,
      windowSessions: {
        onWindowSessionDisposed(listener) {
          windowSessionDisposed = listener;
          return () => {
            windowSessionDisposed = undefined;
          };
        },
      },
    });
    const identity: RequestIdentity = {
      requestId: "request-one" as RequestId,
      messageId: "message-one" as RequestMessageId,
      idempotencyKey: "dedupe-one" as RequestIdempotencyKey,
      windowSessionId: "window-session",
    };
    const invocationRef = { id: "runtime-one" };
    const scope = new PreparedRequestScope("window-session");
    const register = scope.register.bind(scope);
    scope.register = (...args) => {
      events.push("client-registered");
      return register(...args);
    };
    const operationIdentity: OperationAdmissionIdentity<Ref> = {
      requestId: identity.requestId,
      invocationRef,
      fingerprint: "intent-fingerprint",
      owner: {
        hostId: "host",
        machineId: definition.id,
        keyId: "key",
        actorInstanceId: admittedActor.actorInstanceId,
        actorRevision: admittedActor.snapshotRevision,
        windowSessionId: identity.windowSessionId,
      },
    };
    const actor = createCompletionAwareActor({
      scope,
      prepareIdentity: () => identity,
      fingerprint: () => operationIdentity.fingerprint,
      retry: { kind: "none" },
      classifyFailure: () => ({ kind: "unexpected" }),
      enqueue: () => undefined,
      dispatchRequest: async () => {
        events.push("ipc-started");
        await authorization.promise;
        events.push("authorization-finished");
        const admitted = finalizeOperationAdmission({
          registry,
          identity: operationIdentity,
          assertFinalAdmission: () => {
            events.push("final-revalidation");
            expect(
              host.isAdmissionGenerationCurrent(
                definition.id,
                "key",
                admissionGeneration,
              ),
            ).toBe(true);
            expect(host.peek(definition.id, "key")?.getMetadata()).toEqual(
              admittedActor,
            );
          },
          enqueue: () => {
            expect(registry.has(identity.requestId)).toBe(true);
            events.push("trusted-event-enqueued");
            return host.dispatchCaptured(
              definition,
              "key",
              { type: "INCREMENT" } satisfies Event,
              admissionGeneration,
              admittedActor,
            );
          },
          receiptOnEnqueueFailure: () => ({
            actor: admittedActor,
            acknowledgedAt: 1,
          }),
        });
        if (admitted.kind !== "enqueued") {
          throw new Error("Expected fresh operation admission");
        }
        return {
          kind: "admitted",
          admission: { accepted: true as const },
          disposition: "fresh",
          settled: admitted.operation.settled.then(
            (settlement) => settlement.outcome,
          ),
        };
      },
    });

    const prepared = actor.request({ type: "START" });

    expect(events).toEqual(["client-registered"]);
    expect(registry.inspect().total).toBe(0);
    await Promise.resolve();
    expect(events).toEqual(["client-registered", "ipc-started"]);
    expect(registry.inspect().total).toBe(0);

    authorization.resolve();
    await expect(prepared.admission).resolves.toMatchObject({
      kind: "admitted",
    });
    expect(events).toEqual([
      "client-registered",
      "ipc-started",
      "authorization-finished",
      "final-revalidation",
      "trusted-event-enqueued",
    ]);
    expect(registry.inspect().unresolved).toBe(1);
    expect(hostedActor.getSnapshot()).toEqual({ value: 1 });

    registry.settle(
      identity.requestId,
      invocationRef,
      { kind: "succeeded" },
      {
        actor: hostedActor.getMetadata(),
        acknowledgedAt: 2,
      },
    );
    await expect(prepared.settled).resolves.toEqual({
      kind: "completed",
      outcome: { kind: "succeeded" },
    });

    const actorOwned = registry.admit({
      ...operationIdentity,
      requestId: "request-actor-disposal" as RequestId,
      invocationRef: { id: "runtime-actor-disposal" },
    });
    await host.disposeKey(definition.id, "key");
    await expect(actorOwned.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "disposed", cause: "key" },
    });

    const windowOwned = registry.admit({
      ...operationIdentity,
      requestId: "request-window-disposal" as RequestId,
      invocationRef: { id: "runtime-window-disposal" },
      owner: {
        ...operationIdentity.owner,
        actorInstanceId: "retained-actor",
      },
    });
    windowSessionDisposed?.(identity.windowSessionId);
    await expect(windowOwned.ticket.settled).resolves.toMatchObject({
      outcome: { kind: "disposed", cause: "window-session" },
    });
    unbindLifetimes();
    expect(windowSessionDisposed).toBeUndefined();
  });
});
