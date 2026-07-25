import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { change } from "@/state_machines/types";
import { ActorHost, type ActorHostError } from "./actor_host";
import {
  createRemoteMachineManifest,
  type AnyRemoteMachineDefinition,
} from "./remote_manifest";
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
    machine?: AnyRemoteMachineDefinition;
    deduplicationRetentionMs?: number;
    maxDeduplicationEntries?: number;
    protocolMismatch?: ReturnType<typeof vi.fn>;
    onError?: ReturnType<typeof vi.fn>;
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
    onError: options.onError,
  });
  const duplex = new FakeDuplexRemoteTransport(transport, manifest, windows);
  return { clock, errors, host, machine, manifest, transport, duplex, windows };
}

function createObjectKeyMachine(
  authorizeDispatch: () => void | Promise<void> = () => undefined,
): AnyRemoteMachineDefinition {
  const keyCodec = z.string().transform((id) => ({ id }));
  const eventCodec = z.object({ type: z.literal("INCREMENT") }).strict();
  return {
    id: "object-key",
    host: "main",
    initialState: () => ({ value: 0 }),
    transition: (state: { value: number }) =>
      change({ value: state.value + 1 }),
    createScheduler: () => ({
      schedule: () => undefined,
    }),
    createCommandRunner: () => () => undefined,
    lifecycle: remoteTestLifecycle() as never,
    remote: {
      protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
      keyCodec,
      encodeKey: (key: { id: string }) => key.id,
      eventCodec,
      snapshotCodec: z.object({ value: z.number().int() }).strict(),
      keyToString: (key: { id: string }) => key.id,
      projectSnapshot: (state: { value: number }) => state,
      revisionPolicy: () => "allow-stale",
      authorizeSubscribe: () => undefined,
      authorizeDispatch,
    },
  } as AnyRemoteMachineDefinition;
}

const objectAddress = (): MachineAddress => ({
  protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
  machineId: "object-key",
  encodedKey: "actor",
});

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
    ).resolves.toMatchObject({ kind: "applied", revision: 2 });
    expect(renderer.view(address())?.state).toEqual({ value: 2 });

    const nonJsonEnvelope = dispatch({
      type: "ADD_BIGINT",
      amount: 2n,
    });
    await expect(renderer.dispatch(nonJsonEnvelope)).resolves.toMatchObject({
      kind: "applied",
      revision: 3,
    });
    await expect(renderer.dispatch(nonJsonEnvelope)).resolves.toMatchObject({
      kind: "applied",
      revision: 3,
    });
    expect(renderer.view(address())?.state).toEqual({ value: 4 });

    clock.advanceBy(11);
    await expect(renderer.dispatch(retryEnvelope)).resolves.toMatchObject({
      kind: "applied",
      revision: 4,
    });
  });

  it("retains pending deduplication entries and bounds unrelated in-flight work", async () => {
    let authorize!: () => void;
    let authorizationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorizationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      authorize = resolve;
    });
    let authorizationCount = 0;
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remote: {
        ...base.remote,
        async authorizeDispatch(
          context: Parameters<typeof base.remote.authorizeDispatch>[0],
        ) {
          authorizationCount += 1;
          if (authorizationCount === 1) {
            authorizationStarted();
            await gate;
          }
          return base.remote.authorizeDispatch(context);
        },
      },
    };
    const { duplex } = createHarness({
      machine,
      maxDeduplicationEntries: 1,
      deduplicationRetentionMs: 0,
    });
    const renderer = duplex.connect();
    const envelope = dispatch({ type: "INCREMENT" });
    const first = renderer.dispatch(envelope);
    await started;
    const retry = renderer.dispatch(envelope);

    await expect(
      renderer.dispatch(dispatch({ type: "INCREMENT" })),
    ).rejects.toThrow("Remote machine in-flight dispatch limit exceeded");
    expect(authorizationCount).toBe(1);

    authorize();
    await expect(Promise.all([first, retry])).resolves.toEqual([
      expect.objectContaining({ kind: "applied", revision: 1 }),
      expect.objectContaining({ kind: "applied", revision: 1 }),
    ]);
    await expect(
      renderer.dispatch(dispatch({ type: "INCREMENT" })),
    ).resolves.toMatchObject({ kind: "applied", revision: 2 });
  });

  it("applies declared revision policy and requires cancellation identity", async () => {
    const { duplex } = createHarness();
    const renderer = duplex.connect();
    const bootstrap = await renderer.subscribe(address());

    await expect(
      renderer.dispatch(
        dispatch(
          { type: "SET", value: 1 },
          { expectedRevision: bootstrap.revision },
        ),
      ),
    ).resolves.toMatchObject({ kind: "applied", revision: 1 });
    await expect(
      renderer.dispatch(
        dispatch(
          { type: "SET", value: 2 },
          { expectedRevision: bootstrap.revision },
        ),
      ),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });
    await expect(
      renderer.dispatch(dispatch({ type: "SET", value: 3 })),
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
      value: 0,
    });
    const replacement = renderer.reconnect();
    await replacement.subscribe(address());
    expect(replacement.view(address())?.state).toEqual({ value: 0 });
  });

  it("does not install a subscription after its window is destroyed during authorization", async () => {
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
        async authorizeSubscribe(
          context: Parameters<typeof base.remote.authorizeSubscribe>[0],
        ) {
          authorizationStarted();
          await gate;
          return base.remote.authorizeSubscribe(context);
        },
      },
    };
    const { duplex, host, transport } = createHarness({ machine });
    const renderer = duplex.connect();
    const pending = renderer.subscribe(address());
    await started;
    renderer.disconnect();
    authorize();

    await expect(pending).rejects.toThrow(
      "Remote machine sender was destroyed during authorization",
    );
    expect(transport.inspectSubscriptions()).toEqual([]);
    expect(host.peek(machine.id, "actor")).toBeUndefined();
  });

  it("re-authorizes when state changes during async authorization", async () => {
    let authorize!: () => void;
    let authorizationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorizationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      authorize = resolve;
    });
    let firstSet = true;
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remote: {
        ...base.remote,
        async authorizeDispatch(
          context: Parameters<typeof base.remote.authorizeDispatch>[0],
        ) {
          await base.remote.authorizeDispatch(context);
          if (context.event.type !== "SET") return;
          if (firstSet) {
            firstSet = false;
            authorizationStarted();
            await gate;
          }
          if (context.currentState?.value !== 0) {
            throw new Error("state no longer permits SET");
          }
        },
      },
    };
    const { duplex } = createHarness({ machine });
    const first = duplex.connect();
    const second = duplex.connect();
    await first.subscribe(address());
    const pending = first.dispatch(
      dispatch({ type: "SET", value: 10 }, { expectedRevision: 0 }),
    );
    await started;
    await second.dispatch(dispatch({ type: "INCREMENT" }));
    authorize();

    await expect(pending).resolves.toMatchObject({
      kind: "rejected",
      reason: "unauthorized",
    });
    expect(first.view(address())?.state).toEqual({ value: 1 });
  });

  it("canonicalizes transformed object keys across concurrent dispatches and broadcasts", async () => {
    const releases: Array<() => void> = [];
    let authorizationCount = 0;
    const machine = createObjectKeyMachine(async () => {
      authorizationCount += 1;
      if (authorizationCount > 2) return;
      await new Promise<void>((resolve) => releases.push(resolve));
    });
    const { duplex, host } = createHarness({ machine });
    const first = duplex.connect();
    const second = duplex.connect();
    const firstEnvelope: MachineDispatchEnvelope = {
      ...objectAddress(),
      messageId: "object-message:1",
      encodedEvent: { type: "INCREMENT" },
    };
    const secondEnvelope: MachineDispatchEnvelope = {
      ...objectAddress(),
      messageId: "object-message:2",
      encodedEvent: { type: "INCREMENT" },
    };
    const firstPending = first.dispatch(firstEnvelope);
    const secondPending = second.dispatch(secondEnvelope);
    while (releases.length < 2) await flush();
    for (const release of releases.splice(0)) release();
    const [firstReceipt, secondReceipt] = await Promise.all([
      firstPending,
      secondPending,
    ]);
    expect(firstReceipt).toMatchObject({ kind: "applied" });
    expect(secondReceipt).toMatchObject({
      kind: "applied",
      actorInstanceId:
        firstReceipt.kind === "applied"
          ? firstReceipt.actorInstanceId
          : "unreachable",
    });

    const subscriber = duplex.connect();
    await subscriber.subscribe(objectAddress());
    expect(subscriber.view(objectAddress())?.state).toEqual({ value: 2 });
    await subscriber.dispatch({
      ...objectAddress(),
      messageId: "object-message:3",
      encodedEvent: { type: "INCREMENT" },
    });
    expect(subscriber.view(objectAddress())?.state).toEqual({ value: 3 });
    await host.disposeMachine("object-key");
    expect(subscriber.view(objectAddress())?.state).toBeUndefined();
  });

  it("rolls back subscription ownership when bootstrap projection fails", async () => {
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remote: {
        ...base.remote,
        projectSnapshot() {
          throw new Error("synthetic projection failure");
        },
      },
    };
    const { duplex, transport } = createHarness({ machine });
    const renderer = duplex.connect();

    await expect(renderer.subscribe(address())).rejects.toThrow(
      "synthetic projection failure",
    );
    expect(transport.inspectSubscriptions()).toEqual([]);
  });

  it("isolates protocol reload prompt failures", async () => {
    const protocolMismatch = vi.fn(() => {
      throw new Error("synthetic reload prompt failure");
    });
    const onError = vi.fn();
    const { duplex } = createHarness({ protocolMismatch, onError });
    const renderer = duplex.connect();

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
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "synthetic reload prompt failure",
      }),
    );
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

  it("does not restore a disposed actor from a delayed bootstrap", async () => {
    const { duplex, host, transport } = createHarness();
    const renderer = duplex.connect();
    renderer.holdBootstrapResponses();
    const pending = renderer.subscribe(address());
    while (transport.inspectSubscriptions().length === 0) await flush();
    await host.disposeKey("remote-test", "actor");
    renderer.releaseBootstrapResponses();
    await pending;

    expect(renderer.view(address())?.state).toBeUndefined();
    expect(renderer.view(address())?.actorInstanceId).toBeUndefined();
  });

  it("rejects malformed bootstrap snapshots before making them authoritative", async () => {
    const { duplex, transport } = createHarness();
    const renderer = duplex.connect();
    vi.spyOn(transport, "subscribe").mockResolvedValueOnce({
      ...address(),
      actorInstanceId: "malformed-bootstrap",
      revision: 0,
      encodedState: { value: "not-a-number" },
    });

    await expect(renderer.subscribe(address())).rejects.toThrow(
      "Invalid remote snapshot state",
    );
    expect(renderer.view(address())).toBeUndefined();

    vi.spyOn(transport, "subscribe").mockResolvedValueOnce({
      ...address(),
      actorInstanceId: "",
      revision: 0,
      encodedState: { value: 0 },
    });
    await expect(renderer.subscribe(address())).rejects.toThrow(
      "Invalid remote snapshot envelope",
    );
    expect(renderer.view(address())).toBeUndefined();
  });

  it("reports exact transaction metadata before synchronous command re-entry", async () => {
    const { duplex } = createHarness();
    const renderer = duplex.connect();
    await renderer.subscribe(address());

    await expect(
      renderer.dispatch(dispatch({ type: "CHAIN_INCREMENT" })),
    ).resolves.toMatchObject({
      kind: "applied",
      revision: 0,
      transactionSequence: 1,
    });
    expect(renderer.view(address())?.state).toEqual({ value: 1 });
    expect(renderer.view(address())?.revision).toBe(1);
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
