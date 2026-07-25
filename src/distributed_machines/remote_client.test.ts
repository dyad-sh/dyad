import { describe, expect, it, vi } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { TwoWindowHarness } from "@/testing/two_window_harness";
import { ActorHost, type ActorHostError } from "./actor_host";
import {
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

function createHarness() {
  const clock = createFakeClock();
  const errors: ActorHostError[] = [];
  const host = new ActorHost({
    placement: "main",
    clock,
    ids: createSequentialIdSource(),
    reportError: (error) => errors.push(error),
  });
  const machine = createRemoteTestMachine();
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
  it("reference-counts one bootstrap per key and applies pre-bootstrap snapshots", async () => {
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
    await waitFor(() => subscribe.mock.calls.length === 1);

    await actor.dispatch({ type: "INCREMENT" });
    renderer.releaseBootstrapResponses();
    await waitFor(() => actor.getStatus() === "ready");

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
    const harness = createHarness();
    const baseAuthorize = harness.machine.remote.authorizeDispatch;
    const mutableRemote = harness.machine.remote as {
      authorizeDispatch: typeof harness.machine.remote.authorizeDispatch;
    };
    mutableRemote.authorizeDispatch = async (context) => {
      started();
      await gate;
      return baseAuthorize(context);
    };
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
  });
});
