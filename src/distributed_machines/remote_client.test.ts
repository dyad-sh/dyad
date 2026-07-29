import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { TwoWindowHarness } from "@/testing/two_window_harness";
import { ActorHost, type ActorHostError } from "./actor_host";
import {
  observeDomainRevision,
  RemoteMachineClient,
  RemoteMachineTransportError,
} from "./remote_client";
import { createRemoteMachineManifest } from "./remote_manifest";
import { RemoteMachineTransport } from "./remote_transport";
import { createRemoteTestMachine, FakeDuplexRemoteTransport } from "./testing";

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await flush();
  }
  throw new Error("Timed out waiting for remote client state");
}

function createHarness(machine = createRemoteTestMachine()) {
  const clock = createFakeClock();
  const errors: ActorHostError[] = [];
  const host = new ActorHost({
    placement: "main",
    clock,
    ids: createSequentialIdSource(),
    reportError: (error) => errors.push(error),
  });
  const manifest = createRemoteMachineManifest([machine]);
  const windows = new TwoWindowHarness();
  const transport = new RemoteMachineTransport({
    host,
    manifest,
    windows: windows.registry,
    clock,
  });
  const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
  return { duplex, errors, host, machine, transport };
}

describe("RemoteMachineClient", () => {
  it("validates correlated invocation and outcome payloads before delivery", async () => {
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        operationOutcome: {
          maxEnvelopeBytes: 256,
          invocationRefCodec: z.object({ operationId: z.string() }),
          outcomeCodec: z.object({
            kind: z.literal("succeeded"),
          }),
        },
      },
    } as ReturnType<typeof createRemoteTestMachine>;
    const { duplex } = createHarness(machine);
    const renderer = duplex.connect();
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    const lease = actor.retain();
    await lease.ready;
    const listener = vi.fn();
    actor.subscribeOperationOutcome("request-1", listener);
    const address = {
      protocolVersion: machine.remote.protocolVersion,
      machineId: machine.id,
      encodedKey: machine.remote.encodeKey("actor"),
      requestId: "request-1",
    };

    renderer.emitOperationOutcomeForTesting({
      ...address,
      invocationRef: { operationId: 42 },
      outcome: { kind: "succeeded" },
    });
    renderer.emitOperationOutcomeForTesting({
      ...address,
      invocationRef: { operationId: "invocation-1" },
      outcome: { kind: "not-a-real-outcome" },
    });
    renderer.emitOperationOutcomeForTesting({
      ...address,
      invocationRef: { operationId: "invocation-1" },
      outcome: {
        kind: "succeeded",
        padding: "x".repeat(1_024),
      },
    });
    expect(listener).not.toHaveBeenCalled();

    renderer.emitOperationOutcomeForTesting({
      ...address,
      invocationRef: { operationId: "invocation-1" },
      outcome: { kind: "succeeded" },
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ kind: "succeeded" });
    lease.release();
  });

  it("reference-counts one bootstrap per key and blocks dispatch before bootstrap", async () => {
    const { duplex, machine, transport } = createHarness();
    const renderer = duplex.connect();
    renderer.holdBootstrapResponses();
    const subscribe = vi.spyOn(transport, "subscribe");
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    const first = actor.subscribe(() => undefined);
    const second = actor.subscribe(() => undefined);
    await waitFor(
      () =>
        subscribe.mock.calls.length === 1 &&
        transport.inspectSubscriptions().length === 1,
    );

    await expect(actor.dispatch({ type: "INCREMENT" })).rejects.toThrow(
      "requires a completed subscription bootstrap",
    );
    renderer.releaseBootstrapResponses();
    await waitFor(() => actor.getStatus() === "ready");
    await actor.dispatch({ type: "INCREMENT" });

    expect(actor.getSnapshot()).toEqual({ value: 1 });
    expect(subscribe).toHaveBeenCalledTimes(1);
    first();
    expect(transport.inspectSubscriptions()).toHaveLength(1);
    second();
    await waitFor(() => transport.inspectSubscriptions().length === 0);
  });

  it("rolls back a bootstrap that settles after the final listener leaves", async () => {
    const { duplex, machine, transport } = createHarness();
    const renderer = duplex.connect();
    renderer.holdBootstrapResponses();
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    const release = actor.subscribe(() => undefined);
    await waitFor(() => transport.inspectSubscriptions().length === 1);

    release();
    renderer.releaseBootstrapResponses();
    await waitFor(() => transport.inspectSubscriptions().length === 0);
    expect(actor.getStatus()).not.toBe("ready");
  });

  it("preserves idempotent ownership across overlapping bootstrap requests", async () => {
    const { duplex, machine, transport } = createHarness();
    const renderer = duplex.connect();
    renderer.holdBootstrapResponses();
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    actor.subscribe(() => undefined);
    await waitFor(() => transport.inspectSubscriptions().length === 1);

    client.stop();
    client.start();
    renderer.releaseBootstrapResponses();
    await waitFor(() => actor.getStatus() === "ready");

    expect(transport.inspectSubscriptions()).toHaveLength(1);
    await actor.dispatch({ type: "INCREMENT" });
    expect(actor.getSnapshot()).toEqual({ value: 1 });
  });

  it("retries a failed bootstrap through the same subscription lease", async () => {
    const { duplex, machine, transport } = createHarness();
    const renderer = duplex.connect();
    vi.spyOn(renderer, "subscribe").mockRejectedValueOnce(
      new Error("synthetic bootstrap failure"),
    );
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    const lease = actor.retain();

    await expect(lease.ready).rejects.toThrow("synthetic bootstrap failure");
    await expect(lease.refresh()).resolves.toBeUndefined();
    expect(actor.getStatus()).toBe("ready");
    expect(transport.inspectSubscriptions()).toHaveLength(1);

    lease.release();
    await flush();
    expect(transport.inspectSubscriptions()).toHaveLength(0);
  });

  it("sends an explicitly observed domain revision without substituting the actor revision", async () => {
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        intents: {
          ...base.remoteIntent.intents,
          INCREMENT: {
            ...base.remoteIntent.intents.INCREMENT,
            observedRevision: {
              kind: "domain",
              name: "counter-value",
              required: true,
            },
          },
        },
        resolveDomainRevision({
          currentState,
        }: {
          currentState: { value: number };
        }) {
          return currentState.value;
        },
      },
    } as ReturnType<typeof createRemoteTestMachine>;
    const { duplex } = createHarness(machine);
    const client = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    actor.subscribe(() => undefined);
    await waitFor(() => actor.getStatus() === "ready");

    await expect(
      actor.dispatch(
        { type: "INCREMENT" },
        { expected: observeDomainRevision("counter-value", 0) },
      ),
    ).resolves.toMatchObject({ kind: "applied", revision: 1 });
    await expect(
      actor.dispatch(
        { type: "INCREMENT" },
        { expected: observeDomainRevision("other-counter", 1) },
      ),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });
  });

  it("routes native snapshots with the native key identity contract", async () => {
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remote: {
        ...base.remote,
        keyCodec: z.string().transform((key) => `legacy:${key}`),
      },
    };
    const { duplex } = createHarness(machine);
    const client = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    actor.subscribe(() => undefined);
    await waitFor(() => actor.getStatus() === "ready");

    await actor.dispatch({ type: "INCREMENT" });
    await waitFor(() => actor.getSnapshot().value === 1);
  });

  it("refreshes without changing ownership and ignores a stale release", async () => {
    const { duplex, machine, transport } = createHarness();
    const renderer = duplex.connect();
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    const first = actor.retain();
    await first.ready;
    await first.refresh();
    expect(transport.inspectSubscriptions()[0]?.totalReferences).toBe(1);

    first.release();
    const replacement = actor.retain();
    await replacement.ready;
    await flush();
    expect(transport.inspectSubscriptions()[0]?.totalReferences).toBe(1);

    replacement.release();
    replacement.release();
    await flush();
    expect(transport.inspectSubscriptions()).toHaveLength(0);
  });

  it("keeps simultaneous leases independently owned", async () => {
    const { duplex, machine, transport } = createHarness();
    const client = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    const first = actor.retain();
    const second = actor.retain();
    await Promise.all([first.ready, second.ready]);

    second.release();
    await flush();
    expect(transport.inspectSubscriptions()).toHaveLength(1);
    await expect(first.refresh()).resolves.toBeUndefined();

    first.release();
    await flush();
    expect(transport.inspectSubscriptions()).toHaveLength(0);

    const releaseListener = actor.subscribe(() => undefined);
    await waitFor(() => transport.inspectSubscriptions().length === 1);
    const explicit = actor.retain();
    await explicit.ready;
    explicit.release();
    await flush();
    expect(transport.inspectSubscriptions()).toHaveLength(1);
    releaseListener();
    await waitFor(() => transport.inspectSubscriptions().length === 0);
  });

  it("retains ownership through an in-flight terminal delivery", async () => {
    let releaseAuthorization!: () => void;
    let authorizationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorizationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        async authorizeDispatch(
          context: Parameters<typeof base.remoteIntent.authorizeDispatch>[0],
        ) {
          authorizationStarted();
          await gate;
          return base.remoteIntent.authorizeDispatch(context);
        },
      },
    };
    const { duplex, transport } = createHarness(machine);
    const renderer = duplex.connect();
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    const lease = actor.retain();
    await lease.ready;
    const pending = actor.dispatch({ type: "INCREMENT" });
    await started;

    lease.release();
    await flush();
    expect(transport.inspectSubscriptions()).toHaveLength(1);
    releaseAuthorization();
    await expect(pending).resolves.toMatchObject({ kind: "applied" });
    await flush();
    expect(transport.inspectSubscriptions()).toHaveLength(0);
  });

  it("unsubscribes the previous transport when completion is the only retain", async () => {
    let releaseAuthorization!: () => void;
    let authorizationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorizationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        async authorizeDispatch(
          context: Parameters<typeof base.remoteIntent.authorizeDispatch>[0],
        ) {
          authorizationStarted();
          await gate;
          return base.remoteIntent.authorizeDispatch(context);
        },
      },
    };
    const { duplex, transport } = createHarness(machine);
    const renderer = duplex.connect();
    const unsubscribe = vi.spyOn(renderer, "unsubscribe");
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    const releaseListener = actor.subscribe(() => undefined);
    await waitFor(() => actor.getStatus() === "ready");
    const pending = actor.dispatch({ type: "INCREMENT" });
    await started;

    releaseListener();
    await flush();
    expect(transport.inspectSubscriptions()).toHaveLength(1);
    client.replaceConnection(duplex.connect());
    await expect(pending).rejects.toMatchObject({
      code: "renderer-destroyed",
    } satisfies Partial<RemoteMachineTransportError>);
    expect(unsubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: machine.id }),
    );
    releaseAuthorization();
  });

  it("resyncs revision gaps and rejects stale or disposed actor lifetimes", async () => {
    const { duplex, host, machine, transport } = createHarness();
    const renderer = duplex.connect();
    const subscribe = vi.spyOn(transport, "subscribe");
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    actor.subscribe(() => undefined);
    await waitFor(() => actor.getStatus() === "ready");
    const bootstrap = renderer.view({
      protocolVersion: machine.remote.protocolVersion,
      machineId: machine.id,
      encodedKey: "actor",
    })!;

    renderer.injectSnapshot({
      protocolVersion: machine.remote.protocolVersion,
      machineId: machine.id,
      encodedKey: "actor",
      actorInstanceId: bootstrap.actorInstanceId!,
      revision: bootstrap.revision! + 2,
      encodedState: { value: 99 },
    });
    await waitFor(() => subscribe.mock.calls.length === 2);
    await actor.resync();
    expect(actor.getSnapshot()).toEqual({ value: 0 });

    await host.disposeKey(machine.id, "actor");
    expect(actor.getSnapshot()).toEqual({ value: 0 });
    await actor.resync();
    await actor.dispatch({ type: "INCREMENT" });
    expect(actor.getSnapshot()).toEqual({ value: 1 });
    renderer.injectSnapshot({
      protocolVersion: machine.remote.protocolVersion,
      machineId: machine.id,
      encodedKey: "actor",
      actorInstanceId: bootstrap.actorInstanceId!,
      revision: bootstrap.revision! + 1,
      encodedState: { value: 100 },
    });
    expect(actor.getSnapshot()).toEqual({ value: 1 });
  });

  it("resubscribes on renderer recreation and settles pending dispatches", async () => {
    let authorize!: () => void;
    let started!: () => void;
    const authorizationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      authorize = resolve;
    });
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        async authorizeDispatch(
          context: Parameters<typeof base.remoteIntent.authorizeDispatch>[0],
        ) {
          started();
          await gate;
          return base.remoteIntent.authorizeDispatch(context);
        },
      },
    };
    const harness = createHarness(machine);
    const renderer = harness.duplex.connect();
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(harness.machine, "actor");
    actor.subscribe(() => undefined);
    await waitFor(() => actor.getStatus() === "ready");

    const pending = actor.dispatch({ type: "INCREMENT" });
    await authorizationStarted;
    renderer.disconnect();
    await expect(pending).rejects.toMatchObject({
      code: "disconnected",
    } satisfies Partial<RemoteMachineTransportError>);
    authorize();

    const replacement = renderer.reconnect();
    client.replaceConnection(replacement);
    await waitFor(() => actor.getStatus() === "ready");
    expect(actor.getSnapshot()).toEqual({ value: 0 });
  });

  it("releases a live connection when replacing its renderer transport", async () => {
    const { duplex, machine, transport } = createHarness();
    const firstRenderer = duplex.connect();
    const client = new RemoteMachineClient(
      firstRenderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    actor.subscribe(() => undefined);
    await waitFor(() => actor.getStatus() === "ready");
    expect(transport.inspectSubscriptions()).toHaveLength(1);

    const replacement = duplex.connect();
    client.replaceConnection(replacement);
    await waitFor(
      () =>
        actor.getStatus() === "ready" &&
        transport.inspectSubscriptions()[0]?.totalReferences === 1,
    );

    const subscriptions = transport.inspectSubscriptions();
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.windows).toEqual(
      new Map([[duplex.windows.webContentsId(replacement.sessionId), 1]]),
    );
  });

  it("distinguishes committed dispatch receipts from later command failures", async () => {
    const { duplex, errors, machine } = createHarness();
    const client = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    actor.subscribe(() => undefined);
    await waitFor(() => actor.getStatus() === "ready");

    await expect(
      actor.dispatch({ type: "FAIL_COMMAND" }),
    ).resolves.toMatchObject({ kind: "applied" });
    await flush();
    expect(errors).toEqual([
      expect.objectContaining({
        failure: expect.objectContaining({ stage: "command" }),
      }),
    ]);
  });

  it("rejects a dispatch receipt for a different message", async () => {
    const { duplex, machine } = createHarness();
    const renderer = duplex.connect();
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    actor.subscribe(() => undefined);
    await waitFor(() => actor.getStatus() === "ready");
    vi.spyOn(renderer, "dispatch").mockResolvedValue({
      kind: "applied",
      actorInstanceId: "actor-1",
      revision: 1,
      transactionSequence: 1,
      messageId: "another-message",
    });

    await expect(actor.dispatch({ type: "INCREMENT" })).rejects.toMatchObject({
      code: "invalid-payload",
    } satisfies Partial<RemoteMachineTransportError>);
  });

  it("isolates subscriber failures from transport ownership", async () => {
    const { duplex, machine, transport } = createHarness();
    const errors: unknown[] = [];
    const client = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
      (error) => errors.push(error),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    const laterListener = vi.fn();
    actor.subscribe(() => {
      throw new Error("subscriber failed");
    });
    actor.subscribe(laterListener);

    await waitFor(() => actor.getStatus() === "ready");
    expect(errors).toEqual([
      expect.objectContaining({
        stage: "subscriber",
        error: expect.any(Error),
      }),
    ]);
    expect(laterListener).toHaveBeenCalledTimes(1);
    expect(transport.inspectSubscriptions()).toHaveLength(1);
  });

  it("makes disposal terminal for retained actor references", async () => {
    const { duplex, machine, transport } = createHarness();
    const renderer = duplex.connect();
    const subscribe = vi.spyOn(renderer, "subscribe");
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    actor.subscribe(() => undefined);
    await waitFor(() => actor.getStatus() === "ready");

    client.dispose();
    await waitFor(() => transport.inspectSubscriptions().length === 0);
    const subscribeCalls = subscribe.mock.calls.length;
    await actor.resync();

    expect(actor.getStatus()).toBe("disconnected");
    expect(subscribe).toHaveBeenCalledTimes(subscribeCalls);
    await expect(actor.dispatch({ type: "INCREMENT" })).rejects.toMatchObject({
      code: "renderer-destroyed",
    } satisfies Partial<RemoteMachineTransportError>);
  });

  it("surfaces wire protocol mismatches as incompatible", async () => {
    const { duplex, machine } = createHarness();
    const renderer = duplex.connect();
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    actor.subscribe(() => undefined);
    await waitFor(() => actor.getStatus() === "ready");
    const current = renderer.view({
      protocolVersion: machine.remote.protocolVersion,
      machineId: machine.id,
      encodedKey: "actor",
    })!;

    renderer.injectDisposed({
      protocolVersion: machine.remote.protocolVersion + 1,
      machineId: machine.id,
      encodedKey: "actor",
      actorInstanceId: current.actorInstanceId!,
      finalRevision: current.revision!,
    });

    expect(actor.getStatus()).toBe("incompatible");
    expect(actor.getSnapshot()).toEqual({ value: 0 });
  });

  it("detects a protocol mismatch in a bootstrap snapshot", async () => {
    const { duplex, machine } = createHarness();
    const renderer = duplex.connect();
    vi.spyOn(renderer, "subscribe").mockResolvedValue({
      protocolVersion: machine.remote.protocolVersion + 1,
      machineId: machine.id,
      encodedKey: "actor",
      actorInstanceId: "actor-1",
      revision: 0,
      encodedState: { value: 0 },
    });
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    actor.subscribe(() => undefined);

    await waitFor(() => actor.getStatus() === "incompatible");
    expect(actor.getSnapshot()).toEqual({ value: 0 });
  });

  it("detects renderer-to-main protocol skew through the fake connection", async () => {
    const { duplex, machine } = createHarness();
    const mismatchedMachine = {
      ...machine,
      remote: {
        ...machine.remote,
        protocolVersion: machine.remote.protocolVersion + 1,
      },
    };
    const client = new RemoteMachineClient(
      duplex.connect(),
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(mismatchedMachine, "actor");
    actor.subscribe(() => undefined);

    await waitFor(() => actor.getStatus() === "incompatible");
    expect(actor.getSnapshot()).toEqual({ value: 0 });
  });

  it("surfaces incompatible transport state without retaining a snapshot", async () => {
    const { duplex, machine } = createHarness();
    const renderer = duplex.connect();
    const client = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    client.start();
    const actor = client.actor(machine, "actor");
    actor.subscribe(() => undefined);
    await waitFor(() => actor.getStatus() === "ready");
    await actor.dispatch({ type: "INCREMENT" });
    expect(actor.getSnapshot()).toEqual({ value: 1 });

    renderer.reportIncompatible();
    expect(actor.getStatus()).toBe("incompatible");
    expect(actor.getSnapshot()).toEqual({ value: 0 });
    await expect(actor.dispatch({ type: "INCREMENT" })).rejects.toMatchObject({
      code: "incompatible",
    });
    client.stop();
    client.start();
    expect(actor.getStatus()).toBe("incompatible");

    const replacementClient = new RemoteMachineClient(
      renderer,
      createSequentialIdSource(),
    );
    expect(replacementClient.actor(machine, "actor").getStatus()).toBe(
      "incompatible",
    );
  });
});
