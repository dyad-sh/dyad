import { describe, expect, it, vi } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { ActorHost, type ActorHostError } from "./actor_host";
import { createRemoteMachineManifest } from "./remote_manifest";
import {
  REMOTE_MACHINE_PROTOCOL_VERSION,
  type MachineAddress,
  type MachineDispatchEnvelope,
  type MachineSnapshotEnvelope,
} from "./remote_protocol";
import { RemoteMachineTransport } from "./remote_transport";
import {
  createRemoteTestMachine,
  FakeDuplexRemoteTransport,
  FakeTransportDisconnectedError,
  remoteTestLifecycle,
} from "./testing";
import { TwoWindowHarness } from "@/testing/two_window_harness";

const address = (
  key = "actor",
  protocolVersion = REMOTE_MACHINE_PROTOCOL_VERSION,
): MachineAddress => ({
  protocolVersion,
  machineId: "remote-test",
  encodedKey: key,
});

let nextMessageId = 1;
const dispatch = (
  encodedEvent: unknown,
  overrides: Partial<MachineDispatchEnvelope> = {},
): MachineDispatchEnvelope => ({
  ...address(),
  messageId: `message:${nextMessageId++}`,
  encodedEvent,
  ...overrides,
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness(
  options: {
    machine?: ReturnType<typeof createRemoteTestMachine>;
    deduplicationRetentionMs?: number;
    maxDeduplicationEntries?: number;
    protocolMismatch?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const clock = createFakeClock();
  const errors: ActorHostError[] = [];
  const host = new ActorHost({
    placement: "main",
    clock,
    ids: createSequentialIdSource(),
    reportError: (error) => errors.push(error),
  });
  const machine = options.machine ?? createRemoteTestMachine();
  const manifest = createRemoteMachineManifest([machine]);
  const windows = new TwoWindowHarness();
  const transport = new RemoteMachineTransport({
    host,
    manifest,
    windows: windows.registry,
    clock,
    deduplicationRetentionMs: options.deduplicationRetentionMs,
    maxDeduplicationEntries: options.maxDeduplicationEntries,
    onProtocolMismatch: options.protocolMismatch,
  });
  const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
  return { clock, errors, host, machine, manifest, transport, duplex, windows };
}

describe("remote machine manifest", () => {
  it("rejects duplicate IDs before registering any router target", () => {
    const first = createRemoteTestMachine();
    const second = createRemoteTestMachine();
    expect(() => createRemoteMachineManifest([first, second])).toThrow(
      "Duplicate remote machine ID: remote-test",
    );
  });
});

describe("remote machine transport", () => {
  it("shares one actor across two windows and disconnects them independently", async () => {
    const { duplex, transport, host, machine } = createHarness();
    const first = duplex.connect();
    const second = duplex.connect();
    await first.subscribe(address());
    await second.subscribe(address());
    await first.subscribe(address());

    expect(transport.inspectSubscriptions()).toEqual([
      expect.objectContaining({
        machineId: "remote-test",
        key: "actor",
        totalReferences: 2,
      }),
    ]);

    await expect(
      second.dispatch(dispatch({ type: "INCREMENT" })),
    ).resolves.toMatchObject({ kind: "applied", revision: 1 });
    expect(first.view(address())?.state).toEqual({ value: 1 });
    expect(second.view(address())?.state).toEqual({ value: 1 });

    await first.unsubscribe(address());
    await first.unsubscribe(address());
    await expect(
      second.dispatch(dispatch({ type: "INCREMENT" })),
    ).resolves.toMatchObject({ kind: "applied", revision: 2 });
    expect(second.view(address())?.state).toEqual({ value: 2 });

    second.disconnect();
    expect(transport.inspectSubscriptions()).toEqual([]);
    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      value: 2,
    });
  });

  it("follows the definition's no-subscriber lifecycle policy", async () => {
    const machine = createRemoteTestMachine(
      "remote-test",
      remoteTestLifecycle({
        idleEviction: { kind: "dispose-after", delayMs: 25 },
      }),
    );
    const { clock, duplex, host } = createHarness({ machine });
    const renderer = duplex.connect();
    await renderer.subscribe(address());
    renderer.disconnect();

    clock.advanceBy(24);
    expect(host.peek(machine.id, "actor")).toBeDefined();
    clock.advanceBy(1);
    await flush();
    expect(host.peek(machine.id, "actor")).toBeUndefined();
  });

  it("deduplicates duplicate delivery and retry after a dropped receipt", async () => {
    const { clock, duplex } = createHarness({
      deduplicationRetentionMs: 10,
      maxDeduplicationEntries: 2,
    });
    const renderer = duplex.connect();
    await renderer.subscribe(address());

    const firstEnvelope = dispatch({ type: "INCREMENT" });
    duplex.duplicateNextDispatch();
    const firstReceipt = await renderer.dispatch(firstEnvelope);
    expect(firstReceipt).toMatchObject({ kind: "applied", revision: 1 });
    expect(renderer.view(address())?.state).toEqual({ value: 1 });

    const retryEnvelope = dispatch({ type: "INCREMENT" });
    duplex.dropNextReceipt();
    await expect(renderer.dispatch(retryEnvelope)).rejects.toBeInstanceOf(
      FakeTransportDisconnectedError,
    );
    expect(renderer.view(address())?.state).toEqual({ value: 2 });
    await expect(renderer.dispatch(retryEnvelope)).resolves.toMatchObject({
      kind: "applied",
      revision: 2,
    });
    expect(renderer.view(address())?.state).toEqual({ value: 2 });

    await expect(
      renderer.dispatch({
        ...retryEnvelope,
        encodedEvent: { type: "IGNORE" },
      }),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "invalid-event",
    });

    clock.advanceBy(11);
    await expect(renderer.dispatch(retryEnvelope)).resolves.toMatchObject({
      kind: "applied",
      revision: 3,
    });
  });

  it("applies declared revision policy and requires cancellation identity", async () => {
    const { duplex } = createHarness();
    const renderer = duplex.connect();
    const bootstrap = await renderer.subscribe(address());

    await expect(
      renderer.dispatch(
        dispatch(
          { type: "INCREMENT" },
          { expectedRevision: bootstrap.revision },
        ),
      ),
    ).resolves.toMatchObject({ kind: "applied", revision: 1 });
    await expect(
      renderer.dispatch(
        dispatch(
          { type: "INCREMENT" },
          { expectedRevision: bootstrap.revision },
        ),
      ),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });

    const invocationRef = {
      kind: "remote-test" as const,
      entityKey: "actor",
      operationId: "operation:1",
    };
    await expect(
      renderer.dispatch(dispatch({ type: "START", invocationRef })),
    ).resolves.toMatchObject({ kind: "applied", revision: 2 });
    await expect(
      renderer.dispatch(dispatch({ type: "CANCEL" })),
    ).resolves.toMatchObject({ kind: "rejected", reason: "invalid-event" });
    await expect(
      renderer.dispatch(
        dispatch({
          type: "CANCEL",
          invocationRef: { ...invocationRef, entityKey: "other" },
        }),
      ),
    ).resolves.toMatchObject({ kind: "rejected", reason: "unauthorized" });
    await expect(
      renderer.dispatch(
        dispatch({ type: "CANCEL", invocationRef }, { expectedRevision: 0 }),
      ),
    ).resolves.toMatchObject({ kind: "applied", revision: 3 });
  });

  it("rejects stale actor identities, malformed payloads, unknown routes, and unauthorized access", async () => {
    const protocolMismatch = vi.fn();
    const { duplex, host, machine } = createHarness({ protocolMismatch });
    const renderer = duplex.connect();
    const bootstrap = await renderer.subscribe(address());

    await expect(
      renderer.dispatch(
        dispatch(
          { type: "INCREMENT" },
          { expectedActorInstanceId: "old-actor" },
        ),
      ),
    ).resolves.toMatchObject({ kind: "rejected", reason: "stale-actor" });
    await expect(
      renderer.dispatch(dispatch({ type: "INCREMENT" }, { encodedKey: 42 })),
    ).resolves.toMatchObject({ kind: "rejected", reason: "invalid-key" });
    await expect(
      renderer.dispatch(dispatch({ type: "ARBITRARY", payload: {} })),
    ).resolves.toMatchObject({ kind: "rejected", reason: "invalid-event" });
    await expect(
      renderer.dispatch(
        dispatch({ type: "INCREMENT", commands: [{ type: "DELETE_ALL" }] }),
      ),
    ).resolves.toMatchObject({ kind: "rejected", reason: "invalid-event" });
    await expect(
      renderer.dispatch(
        dispatch(
          { type: "INCREMENT" },
          { machineId: "renderer-invented-machine" },
        ),
      ),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "unknown-machine",
    });
    await expect(
      renderer.dispatch(
        dispatch({ type: "INCREMENT" }, { encodedKey: "forbidden" }),
      ),
    ).resolves.toMatchObject({ kind: "rejected", reason: "unauthorized" });
    await expect(renderer.subscribe(address("forbidden"))).rejects.toThrow(
      "Remote machine subscription is unauthorized",
    );
    expect(host.peek(machine.id, "forbidden")).toBeUndefined();
    await expect(
      renderer.dispatch(
        dispatch(
          { type: "INCREMENT" },
          { protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION + 1 },
        ),
      ),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "protocol-version",
    });
    expect(protocolMismatch).toHaveBeenCalledOnce();
    expect(bootstrap.encodedState).toEqual({ value: 0 });
    expect(bootstrap.encodedState).not.toHaveProperty("mainSecret");
  });

  it("buffers snapshots before bootstrap and applies only a monotonic actor stream", async () => {
    const { duplex, transport, windows } = createHarness();
    const renderer = duplex.connect();
    renderer.holdBootstrapResponses();
    const bootstrapPromise = renderer.subscribe(address());
    while (transport.inspectSubscriptions().length === 0) await flush();

    await renderer.dispatch(dispatch({ type: "INCREMENT" }));
    renderer.releaseBootstrapResponses();
    const bootstrap = await bootstrapPromise;
    expect(bootstrap.revision).toBe(0);
    expect(renderer.view(address())?.state).toEqual({ value: 1 });

    const current = renderer.view(address())!;
    const duplicate: MachineSnapshotEnvelope = {
      ...address(),
      actorInstanceId: current.actorInstanceId!,
      revision: current.revision!,
      encodedState: { value: 999 },
    };
    renderer.injectSnapshot(duplicate);
    renderer.injectSnapshot({ ...duplicate, revision: 0 });
    renderer.injectSnapshot({
      ...duplicate,
      actorInstanceId: "stale-actor",
      revision: 50,
    });
    expect(renderer.view(address())?.state).toEqual({ value: 1 });

    renderer.injectSnapshot({
      ...duplicate,
      revision: current.revision! + 2,
      encodedState: { value: 3 },
    });
    await flush();
    expect(renderer.view(address())?.resyncs).toBe(1);
    expect(renderer.view(address())?.state).toEqual({ value: 1 });

    renderer.injectSnapshot({
      ...duplicate,
      encodedState: { value: "not-a-number" },
    });
    renderer.injectSnapshot({ broken: true });
    expect(renderer.view(address())?.malformedSnapshots).toBe(2);
    expect(
      windows.received(renderer.sessionId, "distributed-machine:snapshot"),
    ).toHaveLength(1);
  });

  it("settles renderer disconnects independently and resubscribes on reconnect", async () => {
    let authorize!: () => void;
    let authorizationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorizationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      authorize = resolve;
    });
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remote: {
        ...base.remote,
        async authorizeDispatch(
          context: Parameters<typeof base.remote.authorizeDispatch>[0],
        ) {
          authorizationStarted();
          await gate;
          return base.remote.authorizeDispatch(context);
        },
      },
    };
    const { duplex, host } = createHarness({ machine });
    const renderer = duplex.connect();
    await renderer.subscribe(address());
    const pending = renderer.dispatch(dispatch({ type: "INCREMENT" }));
    await started;
    renderer.disconnect();
    authorize();

    await expect(pending).rejects.toBeInstanceOf(
      FakeTransportDisconnectedError,
    );
    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      value: 1,
    });
    const replacement = renderer.reconnect();
    await replacement.subscribe(address());
    expect(replacement.view(address())?.state).toEqual({ value: 1 });
  });

  it("publishes disposal and ignores late snapshots from the disposed lifetime", async () => {
    const { duplex, host } = createHarness();
    const renderer = duplex.connect();
    const bootstrap = await renderer.subscribe(address());
    await host.disposeKey("remote-test", "actor");
    expect(renderer.view(address())?.state).toBeUndefined();

    renderer.injectSnapshot({
      ...address(),
      actorInstanceId: bootstrap.actorInstanceId,
      revision: bootstrap.revision + 1,
      encodedState: { value: 99 },
    });
    expect(renderer.view(address())?.state).toBeUndefined();
  });

  it("returns an applied receipt before reporting a later command failure", async () => {
    const { duplex, errors } = createHarness();
    const renderer = duplex.connect();
    await renderer.subscribe(address());

    await expect(
      renderer.dispatch(dispatch({ type: "FAIL_COMMAND" })),
    ).resolves.toMatchObject({ kind: "applied", revision: 0 });
    await flush();
    expect(errors).toEqual([
      expect.objectContaining({
        machineId: "remote-test",
        failure: expect.objectContaining({ stage: "command" }),
      }),
    ]);
  });
});
