import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { getTraceLog } from "@/state_machines/trace";
import { change, ignore } from "@/state_machines/types";
import type { InvocationRef } from "@/state_machines/invocation_ref";
import { ActorHost, type ActorHostError } from "./actor_host";
import {
  assertRemoteProtocolV1CompatibilityInventory,
  createRemoteMachineManifest,
  defineLegacyRemoteMachineCompatibility,
  REMOTE_PROTOCOL_V1_COMPATIBILITY_INVENTORY,
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
  finalizeOperationAdmission,
  OperationRegistry,
} from "./operation_registry";
import type { RequestId } from "./request_identity";
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
    machines?: readonly AnyRemoteMachineDefinition[];
    deduplicationRetentionMs?: number;
    maxDeduplicationEntries?: number;
    maxSubscriptionsPerWindow?: number;
    maxAddressEnvelopeBytes?: number;
    maxDispatchEnvelopeBytes?: number;
    maxSnapshotEnvelopeBytes?: number;
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
  const machine: AnyRemoteMachineDefinition =
    options.machine ?? createRemoteTestMachine();
  const manifest = createRemoteMachineManifest(options.machines ?? [machine]);
  const windows = new TwoWindowHarness();
  const transport = new RemoteMachineTransport({
    host,
    manifest,
    windows: windows.registry,
    clock,
    deduplicationRetentionMs: options.deduplicationRetentionMs,
    maxDeduplicationEntries: options.maxDeduplicationEntries,
    maxSubscriptionsPerWindow: options.maxSubscriptionsPerWindow,
    maxAddressEnvelopeBytes: options.maxAddressEnvelopeBytes,
    maxDispatchEnvelopeBytes: options.maxDispatchEnvelopeBytes,
    maxSnapshotEnvelopeBytes: options.maxSnapshotEnvelopeBytes,
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
      unavailableSnapshot: () => ({ value: 0 }),
      revisionPolicy: () => "allow-stale",
      authorizeSubscribe: () => undefined,
      authorizeDispatch,
    },
  } as AnyRemoteMachineDefinition;
}

function createNativeObjectKeyMachine(
  authorizeSubscribe: (context: {
    readonly key: { readonly id: string };
  }) => { readonly kind: "allow" } | Promise<{ readonly kind: "allow" }>,
): AnyRemoteMachineDefinition {
  const legacy = createObjectKeyMachine();
  const native = createRemoteTestMachine().remoteIntent;
  return {
    ...legacy,
    remoteIntent: {
      keyCodec: legacy.remote.keyCodec,
      encodeKey: legacy.remote.encodeKey,
      keyToString: legacy.remote.keyToString,
      rendererIntentCodec: legacy.remote.eventCodec,
      snapshotCodec: legacy.remote.snapshotCodec,
      toInternalEvent: ({ intent }: { readonly intent: { type: string } }) =>
        Object.freeze({ ...intent }),
      authorizeSubscribe,
      authorizeDispatch: () => ({ kind: "allow" }),
      keyIntentRelationship: { kind: "entity-relative" },
      intents: { INCREMENT: native.intents.INCREMENT },
      refusalMap: native.refusalMap,
      budgets: native.budgets,
    },
  } as AnyRemoteMachineDefinition;
}

const objectAddress = (): MachineAddress => ({
  protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
  machineId: "object-key",
  encodedKey: "actor",
});

describe("remote machine manifest", () => {
  it("accepts remote definitions with a typed transition outcome channel", () => {
    const base = createRemoteTestMachine();
    const withOutcomes = {
      ...base,
      transition: (
        state: ReturnType<typeof base.initialState>,
        _event: Parameters<typeof base.transition>[1],
      ) => change(state, [], [{ requestId: "request-one" }]),
      createOutcomePublisher:
        () => (_outcome: { readonly requestId: string }) =>
          undefined,
    };

    expect(createRemoteMachineManifest([withOutcomes]).get(base.id)).toBe(
      withOutcomes,
    );
  });

  it("rejects duplicate IDs before registering any router target", () => {
    const first = createRemoteTestMachine();
    const second = createRemoteTestMachine();
    expect(() => createRemoteMachineManifest([first, second])).toThrow(
      "Duplicate remote machine ID: remote-test",
    );
  });

  it("rejects machine identities that the IPC address contract cannot encode", () => {
    const base = createRemoteTestMachine();
    expect(() => createRemoteMachineManifest([{ ...base, id: "" }])).toThrow(
      "Invalid remote machine identity",
    );
    expect(() =>
      createRemoteMachineManifest([{ ...base, id: "x".repeat(129) }]),
    ).toThrow("Invalid remote machine identity");
    expect(() =>
      createRemoteMachineManifest([
        {
          ...base,
          remote: { ...base.remote, protocolVersion: -1 },
        },
      ]),
    ).toThrow("Invalid remote machine identity");
    expect(() =>
      createRemoteMachineManifest([
        {
          ...base,
          remote: { ...base.remote, protocolVersion: 1.5 },
        },
      ]),
    ).toThrow("Invalid remote machine identity");
  });

  it("requires the production compatibility inventory to exactly match legacy definitions", () => {
    const legacy = createObjectKeyMachine();
    const productionLegacyDefinitions =
      REMOTE_PROTOCOL_V1_COMPATIBILITY_INVENTORY.map((id) => ({
        ...legacy,
        id,
      }));

    expect(() =>
      assertRemoteProtocolV1CompatibilityInventory(productionLegacyDefinitions),
    ).not.toThrow();
    expect(() =>
      assertRemoteProtocolV1CompatibilityInventory([
        ...productionLegacyDefinitions,
        { ...legacy, id: "unlisted" },
      ]),
    ).toThrow("Unlisted: unlisted");
    expect(() =>
      assertRemoteProtocolV1CompatibilityInventory(
        productionLegacyDefinitions.slice(1),
      ),
    ).toThrow(`Stale: ${REMOTE_PROTOCOL_V1_COMPATIBILITY_INVENTORY[0]}`);
  });

  it("refuses to brand an unlisted legacy production definition", () => {
    const legacy = createObjectKeyMachine();
    expect(() =>
      defineLegacyRemoteMachineCompatibility({
        ...legacy,
        id: "unlisted",
      }),
    ).toThrow("is not in the legacy definition inventory");
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
    expect(transport.inspectSubscriptions()).toEqual([
      expect.objectContaining({
        totalReferences: 1,
        windows: new Map([[2, 1]]),
      }),
    ]);
    const secondAfterRelease = await second.dispatch(
      dispatch({ type: "INCREMENT" }),
    );
    expect(
      secondAfterRelease.kind === "rejected"
        ? secondAfterRelease.reason
        : "applied",
    ).toBe("applied");
    expect(secondAfterRelease).toMatchObject({ kind: "applied", revision: 2 });
    expect(second.view(address())?.state).toEqual({ value: 2 });

    second.disconnect();
    expect(transport.inspectSubscriptions()).toEqual([]);
    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      value: 2,
    });
  });

  it("keeps a replacement renderer connection subscribed after a stale release", async () => {
    const { host, machine, transport, windows } = createHarness();
    const sessionId = windows.createTrustedRendererWindow();
    const endpoint = windows.endpoint(sessionId);
    const oldConnection = "renderer:old";
    const replacementConnection = "renderer:replacement";

    await transport.subscribe(endpoint, address(), oldConnection);
    const replacementBootstrap = await transport.subscribe(
      endpoint,
      address(),
      replacementConnection,
    );
    expect(replacementBootstrap.encodedState).toEqual({ value: 0 });

    await transport.unsubscribe(endpoint, address(), oldConnection);
    expect(transport.inspectSubscriptions()).toEqual([
      expect.objectContaining({
        totalReferences: 1,
        windows: new Map([[endpoint.id, 1]]),
      }),
    ]);

    await host.peek(machine.id, "actor")?.send({ type: "INCREMENT" });

    const snapshots = windows.received(
      sessionId,
      "distributed-machine:snapshot",
    ) as MachineSnapshotEnvelope[];
    expect(snapshots.at(-1)?.encodedState).toEqual({ value: 1 });
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

  it("classifies expected subscription admission refusals", async () => {
    const machine = createRemoteTestMachine(
      "remote-test",
      remoteTestLifecycle({ subscriptionCreates: false }),
    );
    const { duplex } = createHarness({ machine });
    const renderer = duplex.connect();

    await expect(renderer.subscribe(address())).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Precondition,
    });
    expect(renderer.view(address())).toBeUndefined();
  });

  it("preserves classified subscription authorization errors", async () => {
    const expected = new DyadError(
      "Synthetic subscription quota",
      DyadErrorKind.RateLimited,
    );
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        authorizeSubscribe() {
          return { kind: "deny", error: expected } as const;
        },
      },
    };
    const { duplex } = createHarness({ machine });
    const renderer = duplex.connect();

    await expect(renderer.subscribe(address())).rejects.toBe(expected);
    expect(renderer.view(address())).toBeUndefined();
  });

  it("preserves unexpected authorization failures", async () => {
    const subscribeFailure = new Error(
      "Synthetic subscription backend failure",
    );
    const dispatchFailure = new Error("Synthetic dispatch backend failure");
    const base = createRemoteTestMachine();
    const subscribeMachine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        authorizeSubscribe() {
          throw subscribeFailure;
        },
      },
    };
    const subscribeHarness = createHarness({ machine: subscribeMachine });
    await expect(
      subscribeHarness.duplex.connect().subscribe(address()),
    ).rejects.toBe(subscribeFailure);

    const dispatchMachine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        authorizeDispatch() {
          throw dispatchFailure;
        },
      },
    };
    const dispatchHarness = createHarness({ machine: dispatchMachine });
    const renderer = dispatchHarness.duplex.connect();
    await renderer.subscribe(address());
    await expect(
      renderer.dispatch(dispatch({ type: "INCREMENT" })),
    ).rejects.toBe(dispatchFailure);
  });

  it("propagates non-auth typed dispatch denials", async () => {
    const expected = new DyadError(
      "Synthetic dispatch dependency failure",
      DyadErrorKind.Validation,
    );
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        authorizeDispatch() {
          return { kind: "deny", error: expected } as const;
        },
      },
    };
    const { duplex } = createHarness({ machine });
    const renderer = duplex.connect();
    await renderer.subscribe(address());

    await expect(
      renderer.dispatch(dispatch({ type: "INCREMENT" })),
    ).rejects.toBe(expected);
  });

  it("rejects producer events and forged provenance at the renderer boundary", async () => {
    const { duplex, host, machine } = createHarness();
    const renderer = duplex.connect();
    await renderer.subscribe(address());

    await expect(
      renderer.dispatch(dispatch({ type: "PRODUCER_INCREMENT" })),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "invalid-event",
    });
    await expect(
      renderer.dispatch(
        dispatch({
          type: "INCREMENT",
          sender: { windowSessionId: "forged" },
        }),
      ),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "invalid-event",
    });
    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      value: 0,
    });
  });

  it("creates a new immutable internal event without mutating decoded intent data", () => {
    const machine = createRemoteTestMachine();
    const intent = {
      type: "START",
      invocationRef: {
        kind: "remote-test",
        entityKey: "actor",
        operationId: "operation",
      },
    } as const;
    const event = machine.remoteIntent.toInternalEvent({
      key: "actor",
      intent,
      sender: { windowSessionId: "main-derived-session" },
    });

    expect(event).not.toBe(intent);
    expect(event).toEqual(intent);
    expect(Object.isFrozen(event)).toBe(true);
    if (event.type === "START") {
      expect(Object.isFrozen(event.invocationRef)).toBe(true);
    }
    expect(intent).toEqual({
      type: "START",
      invocationRef: {
        kind: "remote-test",
        entityKey: "actor",
        operationId: "operation",
      },
    });
  });

  it("keeps prepared native intents immutable across authorization", async () => {
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        authorizeDispatch(
          context: Parameters<typeof base.remoteIntent.authorizeDispatch>[0],
        ) {
          Object.assign(context.intent as object, {
            type: "PRODUCER_INCREMENT",
          });
          return { kind: "allow" } as const;
        },
      },
    };
    const { duplex, host } = createHarness({ machine });
    const renderer = duplex.connect();
    await renderer.subscribe(address());

    await expect(
      renderer.dispatch(dispatch({ type: "INCREMENT" })),
    ).rejects.toBeInstanceOf(TypeError);
    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      value: 0,
    });
  });

  it("keeps decoded native keys immutable across subscription authorization", async () => {
    const machine = createNativeObjectKeyMachine(({ key }) => {
      Object.assign(key as object, { id: "mutated" });
      return { kind: "allow" };
    });
    const { duplex, transport } = createHarness({ machine });

    await expect(
      duplex.connect().subscribe(objectAddress()),
    ).rejects.toBeInstanceOf(TypeError);
    expect(transport.inspectSubscriptions()).toEqual([]);
  });

  it("uses native key, snapshot, and budget contracts authoritatively", async () => {
    const base = createRemoteTestMachine();
    const keyMachine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        keyCodec: z.literal("native-only"),
      },
    };
    const keyHarness = createHarness({ machine: keyMachine });
    await expect(
      keyHarness.duplex.connect().subscribe(address("legacy-only")),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });

    const snapshotMachine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        snapshotCodec: z.object({ value: z.literal(999) }).strict(),
      },
    };
    await expect(
      createHarness({ machine: snapshotMachine })
        .duplex.connect()
        .subscribe(address()),
    ).rejects.toThrow("Remote snapshot projection failed");

    const budgetMachine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        budgets: { ...base.remoteIntent.budgets, intentBytes: 1 },
      },
    };
    const budgetHarness = createHarness({ machine: budgetMachine });
    const budgetRenderer = budgetHarness.duplex.connect();
    await budgetRenderer.subscribe(address());
    await expect(
      budgetRenderer.dispatch(dispatch({ type: "INCREMENT" })),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "invalid-event",
    });
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
    ).resolves.toMatchObject({ kind: "rejected", reason: "invalid-event" });
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

  it("conflicts when one message ID changes machine, address, payload, or revision", async () => {
    const firstMachine = createRemoteTestMachine();
    const secondMachine = createRemoteTestMachine("remote-test-2");
    const { duplex } = createHarness({
      machine: firstMachine,
      machines: [firstMachine, secondMachine],
    });
    const renderer = duplex.connect();
    const bootstrap = await renderer.subscribe(address("actor"));
    const otherBootstrap = await renderer.subscribe(address("other"));
    const secondBootstrap = await renderer.subscribe({
      protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
      machineId: secondMachine.id,
      encodedKey: "actor",
    });
    const envelope = dispatch(
      { type: "SET", value: 1 },
      {
        messageId: "stable-conflict",
        expectedActorInstanceId: bootstrap.actorInstanceId,
        expectedRevision: 0,
      },
    );
    await expect(renderer.dispatch(envelope)).resolves.toMatchObject({
      kind: "applied",
    });

    const conflicts: MachineDispatchEnvelope[] = [
      { ...envelope, machineId: "unknown-machine" },
      {
        ...envelope,
        machineId: secondMachine.id,
        expectedActorInstanceId: secondBootstrap.actorInstanceId,
      },
      {
        ...envelope,
        encodedKey: "other",
        expectedActorInstanceId: otherBootstrap.actorInstanceId,
      },
      { ...envelope, encodedEvent: { type: "SET", value: 2 } },
      { ...envelope, expectedActorInstanceId: "different-actor-instance" },
      { ...envelope, expectedRevision: 1 },
    ];
    for (const conflict of conflicts) {
      await expect(renderer.dispatch(conflict)).resolves.toMatchObject({
        kind: "rejected",
        reason: "invalid-event",
      });
    }
  });

  it("deduplicates a committed retry across renderer reconnection", async () => {
    const { duplex, host, machine } = createHarness();
    const renderer = duplex.connect();
    await renderer.subscribe(address());
    const envelope = dispatch({ type: "INCREMENT" });

    duplex.dropNextReceipt();
    await expect(renderer.dispatch(envelope)).rejects.toBeInstanceOf(
      FakeTransportDisconnectedError,
    );
    const reconnected = renderer.reconnect();
    await reconnected.subscribe(address());
    await expect(reconnected.dispatch(envelope)).resolves.toMatchObject({
      kind: "applied",
      revision: 1,
    });
    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      value: 1,
    });
  });

  it("replays a retained receipt after its subscription is released", async () => {
    const { duplex, host, machine } = createHarness();
    const renderer = duplex.connect();
    await renderer.subscribe(address());
    const envelope = dispatch({ type: "INCREMENT" });

    duplex.dropNextReceipt();
    await expect(renderer.dispatch(envelope)).rejects.toBeInstanceOf(
      FakeTransportDisconnectedError,
    );
    await renderer.unsubscribe(address());
    await expect(renderer.dispatch(envelope)).resolves.toMatchObject({
      kind: "applied",
      revision: 1,
    });
    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      value: 1,
    });
  });

  it("starts deduplication retention when a slow dispatch settles", async () => {
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
    const { clock, duplex, host } = createHarness({
      machine,
      deduplicationRetentionMs: 10,
    });
    const renderer = duplex.connect();
    await renderer.subscribe(address());
    const envelope = dispatch({ type: "INCREMENT" });
    duplex.dropNextReceipt();
    const pending = renderer.dispatch(envelope);
    await started;
    clock.advanceBy(11);
    releaseAuthorization();

    await expect(pending).rejects.toBeInstanceOf(
      FakeTransportDisconnectedError,
    );
    await expect(renderer.dispatch(envelope)).resolves.toMatchObject({
      kind: "applied",
      revision: 1,
    });
    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      value: 1,
    });
  });

  it("rejects dispatch to an actor that no subscription created", async () => {
    const { duplex, host, machine } = createHarness();
    host.localRef(machine, "actor");
    const renderer = duplex.connect();

    await expect(
      renderer.dispatch(dispatch({ type: "INCREMENT" })),
    ).resolves.toMatchObject({ kind: "rejected", reason: "stale-actor" });
    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      value: 0,
    });
  });

  it("bounds structured-clone dispatch and snapshot envelopes", async () => {
    const addressHarness = createHarness({ maxAddressEnvelopeBytes: 256 });
    const addressRenderer = addressHarness.duplex.connect();
    const oversizedAddress = address("x".repeat(1_024));
    await expect(
      addressRenderer.subscribe(oversizedAddress),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Validation,
    });
    await expect(
      addressRenderer.unsubscribe(oversizedAddress),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Validation,
    });
    expect(addressHarness.transport.inspectSubscriptions()).toEqual([]);

    const dispatchBase = createRemoteTestMachine();
    const dispatchMachine = {
      ...dispatchBase,
      remoteIntent: {
        ...dispatchBase.remoteIntent,
        budgets: { ...dispatchBase.remoteIntent.budgets, intentBytes: 128 },
      },
    };
    const dispatchHarness = createHarness({ machine: dispatchMachine });
    const renderer = dispatchHarness.duplex.connect();
    await renderer.subscribe(address());
    await expect(
      renderer.dispatch(
        dispatch({
          type: "START",
          invocationRef: {
            kind: "remote-test",
            entityKey: "actor",
            operationId: "x".repeat(1_024),
          },
        }),
      ),
    ).resolves.toMatchObject({ kind: "rejected", reason: "invalid-event" });
    expect(
      dispatchHarness.host
        .peek(dispatchHarness.machine.id, "actor")
        ?.getSnapshot(),
    ).toMatchObject({ value: 0 });

    const snapshotBase = createRemoteTestMachine();
    const snapshotMachine = {
      ...snapshotBase,
      remoteIntent: {
        ...snapshotBase.remoteIntent,
        budgets: { ...snapshotBase.remoteIntent.budgets, snapshotBytes: 32 },
      },
    };
    const snapshotHarness = createHarness({ machine: snapshotMachine });
    const snapshotRenderer = snapshotHarness.duplex.connect();
    await expect(snapshotRenderer.subscribe(address())).rejects.toThrow(
      "Remote snapshot exceeds the transport limit",
    );
    expect(snapshotHarness.transport.inspectSubscriptions()).toEqual([]);
  });

  it("allows a machine to raise its bounded dispatch and snapshot ceilings", async () => {
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remote: {
        ...base.remote,
        maxDispatchEnvelopeBytes: 2_048,
        maxSnapshotEnvelopeBytes: 2_048,
      },
      remoteIntent: {
        ...base.remoteIntent,
        budgets: { intentBytes: 2_048, snapshotBytes: 2_048 },
      },
    } as AnyRemoteMachineDefinition;
    const { duplex, host } = createHarness({
      machine,
      maxDispatchEnvelopeBytes: 128,
      maxSnapshotEnvelopeBytes: 32,
    });
    const renderer = duplex.connect();

    await expect(renderer.subscribe(address())).resolves.toBeDefined();
    await expect(
      renderer.dispatch(
        dispatch({
          type: "START",
          invocationRef: {
            kind: "remote-test",
            entityKey: "actor",
            operationId: "x".repeat(512),
          },
        }),
      ),
    ).resolves.toMatchObject({ kind: "applied" });
    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      activeInvocationRef: {
        operationId: "x".repeat(512),
      },
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
      remoteIntent: {
        ...base.remoteIntent,
        async authorizeDispatch(
          context: Parameters<typeof base.remoteIntent.authorizeDispatch>[0],
        ) {
          authorizationCount += 1;
          if (authorizationCount === 1) {
            authorizationStarted();
            await gate;
          }
          return base.remoteIntent.authorizeDispatch(context);
        },
      },
    };
    const { duplex } = createHarness({
      machine,
      maxDeduplicationEntries: 1,
      deduplicationRetentionMs: 0,
    });
    const renderer = duplex.connect();
    await renderer.subscribe(address());
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
          {
            expectedActorInstanceId: bootstrap.actorInstanceId,
            expectedRevision: bootstrap.revision,
          },
        ),
      ),
    ).resolves.toMatchObject({ kind: "applied", revision: 1 });
    await expect(
      renderer.dispatch(
        dispatch(
          { type: "SET", value: 2 },
          {
            expectedActorInstanceId: bootstrap.actorInstanceId,
            expectedRevision: bootstrap.revision,
          },
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
    ).resolves.toMatchObject({ kind: "rejected", reason: "invalid-event" });
    await expect(
      renderer.dispatch(
        dispatch({ type: "CANCEL", invocationRef }, { expectedRevision: 0 }),
      ),
    ).resolves.toMatchObject({ kind: "applied", revision: 3 });
  });

  it("requires paired actor revision tokens and ignores legacy revision policy for native intents", async () => {
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remote: {
        ...base.remote,
        revisionPolicy: () => "allow-stale" as const,
      },
    };
    const { duplex } = createHarness({ machine });
    const renderer = duplex.connect();
    const bootstrap = await renderer.subscribe(address());

    await expect(
      renderer.dispatch(
        dispatch(
          { type: "SET", value: 1 },
          { expectedRevision: bootstrap.revision },
        ),
      ),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });

    await renderer.dispatch(dispatch({ type: "INCREMENT" }));
    await expect(
      renderer.dispatch(
        dispatch(
          { type: "SET", value: 2 },
          {
            expectedActorInstanceId: bootstrap.actorInstanceId,
            expectedRevision: bootstrap.revision,
          },
        ),
      ),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });
  });

  it("validates declared domain revisions at final native admission", async () => {
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
    } as AnyRemoteMachineDefinition;
    const { duplex } = createHarness({ machine });
    const renderer = duplex.connect();
    await renderer.subscribe(address());

    await expect(
      renderer.dispatch(
        dispatch(
          { type: "INCREMENT" },
          {
            expectedRevision: 99,
          },
        ),
      ),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });
    await expect(
      renderer.dispatch(
        dispatch(
          { type: "INCREMENT" },
          {
            expectedRevision: 0,
          },
        ),
      ),
    ).resolves.toMatchObject({ kind: "applied", revision: 1 });
  });

  it("revalidates the exact revision after trusted event conversion", async () => {
    const base = createRemoteTestMachine();
    let actor: ReturnType<ActorHost["peek"]>;
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        toInternalEvent(
          context: Parameters<typeof base.remoteIntent.toInternalEvent>[0],
        ) {
          if (context.intent.type === "SET") {
            actor?.send({ type: "INCREMENT" });
          }
          return base.remoteIntent.toInternalEvent(context);
        },
      },
    };
    const { duplex, host } = createHarness({ machine });
    const renderer = duplex.connect();
    const bootstrap = await renderer.subscribe(address());
    actor = host.peek(machine.id, "actor");

    await expect(
      renderer.dispatch(
        dispatch(
          { type: "SET", value: 10 },
          {
            expectedActorInstanceId: bootstrap.actorInstanceId,
            expectedRevision: bootstrap.revision,
          },
        ),
      ),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });
    expect(actor?.getSnapshot()).toMatchObject({ value: 1 });
  });

  it("maps a final host revision race to the revision refusal", async () => {
    const { duplex, host, machine } = createHarness();
    const renderer = duplex.connect();
    const bootstrap = await renderer.subscribe(address());
    const actor = host.peek(machine.id, "actor")!;
    let reentered = false;
    const fence = host.beginFence(machine, {
      key: "actor",
      allowDuringDrain(event) {
        if (event.type === "SET" && !reentered) {
          reentered = true;
          actor.send({ type: "INCREMENT" });
        }
        return event.type === "SET" || event.type === "INCREMENT";
      },
    });

    await expect(
      renderer.dispatch(
        dispatch(
          { type: "SET", value: 10 },
          {
            expectedActorInstanceId: bootstrap.actorInstanceId,
            expectedRevision: bootstrap.revision,
          },
        ),
      ),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });
    expect(actor.getSnapshot()).toMatchObject({ value: 1 });
    expect(fence.abort()).toBe(true);
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
    ).resolves.toMatchObject({ kind: "rejected", reason: "stale-actor" });
    await expect(
      renderer.subscribe(address("forbidden")),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Auth,
      message: "forbidden key",
    });
    expect(renderer.view(address("forbidden"))).toBeUndefined();
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

  it("ignores superseded resync responses that arrive out of order", async () => {
    const { duplex, transport } = createHarness();
    const renderer = duplex.connect();
    const bootstrap = await renderer.subscribe(address());
    let resolveOlder!: (value: MachineSnapshotEnvelope) => void;
    let resolveNewer!: (value: MachineSnapshotEnvelope) => void;
    const older = new Promise<MachineSnapshotEnvelope>((resolve) => {
      resolveOlder = resolve;
    });
    const newer = new Promise<MachineSnapshotEnvelope>((resolve) => {
      resolveNewer = resolve;
    });
    vi.spyOn(transport, "subscribe")
      .mockImplementationOnce(() => older)
      .mockImplementationOnce(() => newer);

    renderer.injectSnapshot({
      ...bootstrap,
      revision: 2,
      encodedState: { value: 2 },
    });
    renderer.injectSnapshot({
      ...bootstrap,
      revision: 3,
      encodedState: { value: 3 },
    });
    resolveNewer({
      ...bootstrap,
      revision: 3,
      encodedState: { value: 3 },
    });
    await flush();
    resolveOlder({
      ...bootstrap,
      revision: 2,
      encodedState: { value: 2 },
    });
    await flush();

    expect(renderer.view(address())).toMatchObject({
      revision: 3,
      state: { value: 3 },
    });
  });

  it("does not let an older failed subscribe tear down a newer view", async () => {
    const { duplex, transport } = createHarness();
    const renderer = duplex.connect();
    let rejectOlder!: (reason: Error) => void;
    const older = new Promise<MachineSnapshotEnvelope>((_, reject) => {
      rejectOlder = reject;
    });
    const subscribe = transport.subscribe.bind(transport);
    vi.spyOn(transport, "subscribe")
      .mockImplementationOnce(() => older)
      .mockImplementation((sender, input) => subscribe(sender, input));

    const olderPending = renderer.subscribe(address());
    const newerBootstrap = await renderer.subscribe(address());
    rejectOlder(new Error("synthetic older subscribe failure"));
    await expect(olderPending).rejects.toThrow(
      "synthetic older subscribe failure",
    );

    expect(renderer.view(address())).toMatchObject({
      actorInstanceId: newerBootstrap.actorInstanceId,
      revision: newerBootstrap.revision,
      state: { value: 0 },
    });
    expect(transport.inspectSubscriptions()).toHaveLength(1);
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
    const { duplex, host } = createHarness({ machine });
    const renderer = duplex.connect();
    await renderer.subscribe(address());
    const envelope = dispatch({ type: "INCREMENT" });
    const pending = renderer.dispatch(envelope);
    await started;
    const replacement = renderer.reconnect();
    await replacement.subscribe(address());
    authorize();

    await expect(pending).rejects.toBeInstanceOf(
      FakeTransportDisconnectedError,
    );
    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      value: 0,
    });
    await expect(replacement.dispatch(envelope)).resolves.toMatchObject({
      kind: "applied",
      revision: 1,
    });
    expect(replacement.view(address())?.state).toEqual({ value: 1 });
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
      remoteIntent: {
        ...base.remoteIntent,
        async authorizeSubscribe(
          context: Parameters<typeof base.remoteIntent.authorizeSubscribe>[0],
        ) {
          authorizationStarted();
          await gate;
          return base.remoteIntent.authorizeSubscribe(context);
        },
      },
    };
    const { duplex, host, transport } = createHarness({ machine });
    const renderer = duplex.connect();
    const pending = renderer.subscribe(address());
    await started;
    renderer.disconnect();
    expect(transport.inspectPendingSubscriptions()).toEqual([]);
    authorize();

    await expect(pending).rejects.toThrow(
      "Remote machine subscription was cancelled",
    );
    expect(transport.inspectSubscriptions()).toEqual([]);
    expect(host.peek(machine.id, "actor")).toBeUndefined();
  });

  it("coalesces concurrent pending subscribe retries behind one quota slot", async () => {
    let releaseAuthorization!: () => void;
    let authorizationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorizationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    let authorizationCount = 0;
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        async authorizeSubscribe(
          context: Parameters<typeof base.remoteIntent.authorizeSubscribe>[0],
        ) {
          authorizationCount += 1;
          authorizationStarted();
          await gate;
          return base.remoteIntent.authorizeSubscribe(context);
        },
      },
    };
    const { transport, windows } = createHarness({
      machine,
      maxSubscriptionsPerWindow: 1,
    });
    const sessionId = windows.createTrustedRendererWindow();
    const endpoint = windows.endpoint(sessionId);

    const first = transport.subscribe(endpoint, address());
    await started;
    const retry = transport.subscribe(endpoint, address());
    expect(authorizationCount).toBe(1);
    expect(transport.inspectPendingSubscriptions()).toHaveLength(1);
    releaseAuthorization();

    await expect(Promise.all([first, retry])).resolves.toEqual([
      expect.objectContaining({ revision: 0 }),
      expect.objectContaining({ revision: 0 }),
    ]);
    expect(transport.inspectSubscriptions()).toEqual([
      expect.objectContaining({ totalReferences: 1 }),
    ]);
  });

  it("cancels a pending subscribe when unsubscribe completes first", async () => {
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
        async authorizeSubscribe(
          context: Parameters<typeof base.remoteIntent.authorizeSubscribe>[0],
        ) {
          authorizationStarted();
          await gate;
          return base.remoteIntent.authorizeSubscribe(context);
        },
      },
    };
    const { duplex, host, transport } = createHarness({ machine });
    const renderer = duplex.connect();
    const pending = renderer.subscribe(address());
    await started;

    await renderer.unsubscribe(address());
    releaseAuthorization();

    await expect(pending).rejects.toThrow(
      "Remote machine subscription was cancelled",
    );
    expect(transport.inspectSubscriptions()).toEqual([]);
    expect(host.peek(machine.id, "actor")).toBeUndefined();
  });

  it("rejects a prepared subscribe after the machine lifecycle changes", async () => {
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
        async authorizeSubscribe(
          context: Parameters<typeof base.remoteIntent.authorizeSubscribe>[0],
        ) {
          authorizationStarted();
          await gate;
          return base.remoteIntent.authorizeSubscribe(context);
        },
      },
    };
    const { duplex, host } = createHarness({ machine });
    const renderer = duplex.connect();
    const pending = renderer.subscribe(address());
    await started;
    await host.disposeMachine(machine.id);
    releaseAuthorization();

    await expect(pending).rejects.toThrow(
      "lifecycle changed during subscription authorization",
    );
    expect(host.peek(machine.id, "actor")).toBeUndefined();
  });

  it("rejects a prepared subscribe when a keyed fence publishes during authorization", async () => {
    let releaseAuthorization!: () => void;
    let authorizationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorizationStarted = resolve;
    });
    const authorization = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        async authorizeSubscribe(
          context: Parameters<typeof base.remoteIntent.authorizeSubscribe>[0],
        ) {
          authorizationStarted();
          await authorization;
          return base.remoteIntent.authorizeSubscribe(context);
        },
      },
    };
    const { duplex, host } = createHarness({ machine });
    const renderer = duplex.connect();
    const pending = renderer.subscribe(address());
    await started;
    const fence = host.beginFence(machine, {
      key: "actor",
      allowDuringDrain: () => false,
    });
    releaseAuthorization();

    await expect(pending).rejects.toThrow(
      "lifecycle changed during subscription authorization",
    );
    expect(host.peek(machine.id, "actor")).toBeUndefined();
    expect(fence.abort()).toBe(true);
  });

  it("rejects a fresh window subscription while an existing actor is sealed", async () => {
    const { duplex, host, machine, transport } = createHarness();
    const first = duplex.connect();
    const second = duplex.connect();
    await first.subscribe(address());
    const fence = host.beginFence(machine, {
      key: "actor",
      allowDuringDrain: () => false,
    });
    await fence.seal();

    await expect(first.subscribe(address())).resolves.toMatchObject({
      revision: 0,
    });
    await expect(second.subscribe(address())).rejects.toThrow(
      "Remote machine subscription was refused",
    );
    expect(transport.inspectSubscriptions()).toEqual([
      expect.objectContaining({
        totalReferences: 1,
        windows: new Map([[1, 1]]),
      }),
    ]);
    expect(fence.abort()).toBe(true);
  });

  it("rejects the first remote subscription to a sealed local actor", async () => {
    const { duplex, host, machine, transport } = createHarness();
    host.localRef(machine, "actor");
    const fence = host.beginFence(machine, {
      key: "actor",
      allowDuringDrain: () => false,
    });
    await fence.seal();

    await expect(duplex.connect().subscribe(address())).rejects.toThrow(
      "Remote machine subscription was refused",
    );
    expect(transport.inspectSubscriptions()).toEqual([]);
    expect(fence.abort()).toBe(true);
  });

  it("prevents pending and future admissions after transport disposal", async () => {
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
        async authorizeSubscribe(
          context: Parameters<typeof base.remoteIntent.authorizeSubscribe>[0],
        ) {
          authorizationStarted();
          await gate;
          return base.remoteIntent.authorizeSubscribe(context);
        },
      },
    };
    const { duplex, host, transport } = createHarness({ machine });
    const renderer = duplex.connect();
    const pending = renderer.subscribe(address());
    await started;

    transport.dispose();
    releaseAuthorization();

    await expect(pending).rejects.toThrow(
      "Remote machine transport is disposed",
    );
    await expect(renderer.subscribe(address())).rejects.toThrow(
      "Remote machine transport is disposed",
    );
    await expect(
      renderer.dispatch(dispatch({ type: "INCREMENT" })),
    ).rejects.toThrow("Remote machine transport is disposed");
    expect(transport.inspectSubscriptions()).toEqual([]);
    expect(host.peek(machine.id, "actor")).toBeUndefined();
  });

  it("does not recreate an actor when disposal crosses pending resync authorization", async () => {
    let releaseAuthorization!: () => void;
    let authorizationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorizationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    let authorizationCount = 0;
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        async authorizeSubscribe(
          context: Parameters<typeof base.remoteIntent.authorizeSubscribe>[0],
        ) {
          authorizationCount += 1;
          if (authorizationCount > 1) {
            authorizationStarted();
            await gate;
          }
          return base.remoteIntent.authorizeSubscribe(context);
        },
      },
    };
    const { host, transport, windows } = createHarness({ machine });
    const sessionId = windows.createTrustedRendererWindow();
    const endpoint = windows.endpoint(sessionId);
    await transport.subscribe(endpoint, address());
    const pendingResync = transport.subscribe(endpoint, address());
    await started;

    await host.disposeKey(machine.id, "actor");
    expect(transport.inspectPendingSubscriptions()).toEqual([]);
    expect(host.peek(machine.id, "actor")).toBeUndefined();
    releaseAuthorization();

    await expect(pendingResync).rejects.toThrow(
      "Remote machine subscription was cancelled",
    );
    expect(transport.inspectSubscriptions()).toEqual([]);
    expect(host.peek(machine.id, "actor")).toBeUndefined();
  });

  it("never dispatches to an actor replacement admitted during authorization", async () => {
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
    const { duplex, host } = createHarness({ machine });
    const renderer = duplex.connect();
    await renderer.subscribe(address());
    const originalActor = host.peek(machine.id, "actor")!;
    const pending = renderer.dispatch(dispatch({ type: "INCREMENT" }));
    await started;

    await host.disposeKey(machine.id, "actor");
    await renderer.subscribe(address());
    const replacement = host.peek(machine.id, "actor")!;
    expect(replacement.actorInstanceId).not.toBe(originalActor.actorInstanceId);
    releaseAuthorization();

    await expect(pending).resolves.toMatchObject({
      kind: "rejected",
      reason: "stale-actor",
    });
    expect(replacement.getSnapshot()).toMatchObject({ value: 0 });
  });

  it("rejects a prepared dispatch when a keyed fence publishes during authorization", async () => {
    let releaseAuthorization!: () => void;
    let authorizationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorizationStarted = resolve;
    });
    const authorization = new Promise<void>((resolve) => {
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
          await authorization;
          return base.remoteIntent.authorizeDispatch(context);
        },
      },
    };
    const { duplex, host } = createHarness({ machine });
    const renderer = duplex.connect();
    await renderer.subscribe(address());
    const pending = renderer.dispatch(dispatch({ type: "INCREMENT" }));
    await started;
    const fence = host.beginFence(machine, {
      key: "actor",
      allowDuringDrain: () => false,
    });
    releaseAuthorization();

    await expect(pending).resolves.toMatchObject({
      kind: "rejected",
      reason: "host-disposing",
    });
    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      value: 0,
    });
    expect(fence.abort()).toBe(true);
  });

  it("rejects when revision changes during async authorization", async () => {
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
      remoteIntent: {
        ...base.remoteIntent,
        async authorizeDispatch(
          context: Parameters<typeof base.remoteIntent.authorizeDispatch>[0],
        ) {
          const decision = await base.remoteIntent.authorizeDispatch(context);
          if (decision.kind === "deny" || context.intent.type !== "SET") {
            return decision;
          }
          if (firstSet) {
            firstSet = false;
            authorizationStarted();
            await gate;
          }
          if (context.currentState?.value !== 0) {
            return {
              kind: "deny",
              error: new DyadError(
                "state no longer permits SET",
                DyadErrorKind.Auth,
              ),
            } as const;
          }
          return decision;
        },
      },
    };
    const { duplex } = createHarness({ machine });
    const first = duplex.connect();
    const second = duplex.connect();
    const bootstrap = await first.subscribe(address());
    await second.subscribe(address());
    const pending = first.dispatch(
      dispatch(
        { type: "SET", value: 10 },
        {
          expectedActorInstanceId: bootstrap.actorInstanceId,
          expectedRevision: 0,
        },
      ),
    );
    await started;
    await second.dispatch(dispatch({ type: "INCREMENT" }));
    authorize();

    await expect(pending).resolves.toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });
    expect(first.view(address())?.state).toEqual({ value: 1 });
  });

  it("does not re-authorize a changed revision", async () => {
    let mutateDuringAuthorization: (() => Promise<void>) | undefined;
    let authorizationCount = 0;
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      remoteIntent: {
        ...base.remoteIntent,
        async authorizeDispatch(
          context: Parameters<typeof base.remoteIntent.authorizeDispatch>[0],
        ) {
          authorizationCount += 1;
          await mutateDuringAuthorization?.();
          return base.remoteIntent.authorizeDispatch(context);
        },
      },
    };
    const { duplex, host } = createHarness({
      machine,
      maxDeduplicationEntries: 1,
    });
    const renderer = duplex.connect();
    await renderer.subscribe(address());
    mutateDuringAuthorization = async () => {
      await host.dispatch(machine as AnyRemoteMachineDefinition, "actor", {
        type: "INCREMENT",
      }).settled;
    };

    await expect(
      renderer.dispatch(dispatch({ type: "INCREMENT" })),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "revision-conflict",
    });
    expect(authorizationCount).toBe(1);

    mutateDuringAuthorization = undefined;
    await expect(
      renderer.dispatch(dispatch({ type: "INCREMENT" })),
    ).resolves.toMatchObject({ kind: "applied", revision: 2 });
  });

  it("propagates correlation and causation metadata into machine traces", async () => {
    const { duplex } = createHarness();
    const renderer = duplex.connect();
    await renderer.subscribe(address());

    await renderer.dispatch(
      dispatch(
        { type: "INCREMENT" },
        {
          messageId: "trace-message",
          correlationId: "trace-correlation",
          causationId: "trace-cause",
        },
      ),
    );

    expect(
      getTraceLog("remote-test").find(
        (entry) => entry.messageId === "trace-message",
      ),
    ).toMatchObject({
      correlationId: "trace-correlation",
      causationId: "trace-cause",
    });
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
    await first.subscribe(objectAddress());
    await second.subscribe(objectAddress());
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
    });
    const retryReceipt = await second.dispatch({
      ...secondEnvelope,
      messageId: "object-message:2-retry",
    });
    expect(retryReceipt).toMatchObject({
      kind: "applied",
      actorInstanceId:
        firstReceipt.kind === "applied"
          ? firstReceipt.actorInstanceId
          : "unreachable",
    });

    const subscriber = duplex.connect();
    await subscriber.subscribe(objectAddress());
    expect(subscriber.view(objectAddress())?.state).toEqual({ value: 3 });
    await subscriber.dispatch({
      ...objectAddress(),
      messageId: "object-message:3",
      encodedEvent: { type: "INCREMENT" },
    });
    expect(subscriber.view(objectAddress())?.state).toEqual({ value: 4 });
    await host.disposeMachine("object-key");
    expect(subscriber.view(objectAddress())?.state).toBeUndefined();
  });

  it("preserves protocol-v1 definitions through the compatibility adapter", async () => {
    const machine = createObjectKeyMachine();
    const { duplex } = createHarness({ machine });
    const renderer = duplex.connect();

    const bootstrap = await renderer.subscribe(objectAddress());
    expect(bootstrap.protocolVersion).toBe(REMOTE_MACHINE_PROTOCOL_VERSION);
    await expect(
      renderer.dispatch({
        ...objectAddress(),
        messageId: "legacy-v1-message",
        encodedEvent: { type: "INCREMENT" },
      }),
    ).resolves.toMatchObject({ kind: "applied", revision: 1 });
    expect(renderer.view(objectAddress())?.state).toEqual({ value: 1 });
  });

  it("re-authorizes allow-stale protocol-v1 dispatch after the actor revision changes", async () => {
    let releaseAuthorization!: () => void;
    let authorizationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorizationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    let delayFirstAuthorization = true;
    const machine = createObjectKeyMachine(async () => {
      if (!delayFirstAuthorization) return;
      delayFirstAuthorization = false;
      authorizationStarted();
      await gate;
    });
    const { duplex } = createHarness({ machine });
    const first = duplex.connect();
    const second = duplex.connect();
    await first.subscribe(objectAddress());
    await second.subscribe(objectAddress());

    const pending = first.dispatch({
      ...objectAddress(),
      messageId: "legacy-racing-message",
      encodedEvent: { type: "INCREMENT" },
    });
    await started;
    await expect(
      second.dispatch({
        ...objectAddress(),
        messageId: "legacy-concurrent-message",
        encodedEvent: { type: "INCREMENT" },
      }),
    ).resolves.toMatchObject({ kind: "applied", revision: 1 });
    releaseAuthorization();

    await expect(pending).resolves.toMatchObject({
      kind: "applied",
      revision: 2,
    });
    expect(first.view(objectAddress())?.state).toEqual({ value: 2 });
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

  it("restores prior connection ownership when replacement bootstrap fails", async () => {
    const base = createRemoteTestMachine();
    let projectionCount = 0;
    const machine = {
      ...base,
      remote: {
        ...base.remote,
        projectSnapshot(
          ...args: Parameters<typeof base.remote.projectSnapshot>
        ) {
          projectionCount += 1;
          if (projectionCount === 2) {
            throw new Error("synthetic replacement projection failure");
          }
          return base.remote.projectSnapshot(...args);
        },
      },
    } as AnyRemoteMachineDefinition;
    const { transport, windows } = createHarness({ machine });
    const sessionId = windows.createTrustedRendererWindow();
    const endpoint = windows.endpoint(sessionId);
    const priorConnectionId = "00000000-0000-4000-8000-000000000001";
    const replacementConnectionId = "00000000-0000-4000-8000-000000000002";

    const bootstrap = await transport.subscribe(
      endpoint,
      address(),
      priorConnectionId,
    );
    await expect(
      transport.subscribe(endpoint, address(), replacementConnectionId),
    ).rejects.toThrow("synthetic replacement projection failure");

    await expect(
      transport.dispatch(
        endpoint,
        {
          ...dispatch({ type: "INCREMENT" }),
          expectedActorInstanceId: bootstrap.actorInstanceId,
          expectedRevision: bootstrap.revision,
        },
        priorConnectionId,
      ),
    ).resolves.toMatchObject({ kind: "applied", revision: 1 });
  });

  it("does not retain a canonical key when key encoding fails", async () => {
    let decodeSequence = 0;
    let failEncoding = true;
    const keyCodec = z.string().transform((id) => ({
      id,
      sequence: ++decodeSequence,
    }));
    const base = createObjectKeyMachine();
    const machine = {
      ...base,
      initialState: (key: { id: string; sequence: number }) => ({
        value: key.sequence,
      }),
      remote: {
        ...base.remote,
        keyCodec,
        encodeKey(key: { id: string }) {
          if (failEncoding) throw new Error("synthetic key encoding failure");
          return key.id;
        },
      },
    } as AnyRemoteMachineDefinition;
    const { transport, windows } = createHarness({ machine });
    const sessionId = windows.createTrustedRendererWindow();
    const endpoint = windows.endpoint(sessionId);

    await expect(
      transport.subscribe(endpoint, objectAddress()),
    ).rejects.toThrow("synthetic key encoding failure");
    failEncoding = false;
    const bootstrap = await transport.subscribe(endpoint, objectAddress());

    expect(bootstrap.encodedState).toEqual({ value: 2 });
  });

  it("does not intern object IDs rejected by subscription authorization", async () => {
    const canonicalize = vi.fn((key: { id: string }) => key);
    const base = createObjectKeyMachine();
    const machine = {
      ...base,
      remote: {
        ...base.remote,
        canonicalizeKeyAfterAuthorization: canonicalize,
        authorizeSubscribe() {
          throw new DyadError("object key denied", DyadErrorKind.Auth);
        },
      },
    } as AnyRemoteMachineDefinition;
    const { transport, windows } = createHarness({ machine });
    const sessionId = windows.createTrustedRendererWindow();
    const endpoint = windows.endpoint(sessionId);

    for (const encodedKey of ["rejected-a", "rejected-b", "rejected-c"]) {
      await expect(
        transport.subscribe(endpoint, {
          ...objectAddress(),
          encodedKey,
        }),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Auth });
    }
    expect(canonicalize).not.toHaveBeenCalled();
    expect(transport.inspectSubscriptions()).toEqual([]);
  });

  it("rejects post-authorization key canonicalization that changes the wire address", async () => {
    const keyCodec = z.string().transform((wireId) => ({
      entityId: "actor",
      wireId,
    }));
    const base = createNativeObjectKeyMachine(() => ({ kind: "allow" }));
    const machine = {
      ...base,
      remote: {
        ...base.remote,
        keyCodec,
        encodeKey: (key: { wireId: string }) => key.wireId,
        keyToString: (key: { entityId: string }) => key.entityId,
        canonicalizeKeyAfterAuthorization: (key: {
          entityId: string;
          wireId: string;
        }) => ({ ...key, wireId: "canonical-actor" }),
      },
      remoteIntent: {
        ...base.remoteIntent,
        keyCodec,
        encodeKey: (key: { wireId: string }) => key.wireId,
      },
    } as AnyRemoteMachineDefinition;
    const { transport, windows } = createHarness({ machine });
    const sessionId = windows.createTrustedRendererWindow();

    await expect(
      transport.subscribe(windows.endpoint(sessionId), objectAddress()),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message:
        "Remote machine wire address changed during subscription authorization",
    });
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
    await expect(pending).rejects.toThrow(
      "Remote bootstrap references a disposed actor",
    );

    expect(renderer.view(address())).toBeUndefined();
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

  it("rolls back a fresh operation when actor dispatch fails", async () => {
    type Outcome =
      | { readonly kind: "disposed" }
      | { readonly kind: "superseded" }
      | { readonly kind: "failed" }
      | { readonly kind: "ignored" };
    const operations = new OperationRegistry<Outcome, InvocationRef>({
      maxUnresolved: 1,
      maxSettledReplay: 1,
      now: () => 0,
      disposalOutcome: () => ({ kind: "disposed" }),
      supersededOutcome: () => ({ kind: "superseded" }),
      enqueueFailureOutcome: () => ({ kind: "failed" }),
    });
    const failure = new Error("synthetic transition failure");
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      transition: (
        state: Parameters<typeof base.transition>[0],
        event: Parameters<typeof base.transition>[1],
        context: Parameters<typeof base.transition>[2],
      ) => {
        if (event.type === "INCREMENT") throw failure;
        return base.transition(state, event, context);
      },
      remoteOperation: {
        prepare: ({
          key,
          intent,
          sender,
          actor,
          hostId,
          fingerprint,
        }: {
          key: string;
          intent: { readonly type: string };
          sender: { readonly windowSessionId: string };
          actor: {
            readonly actorInstanceId: string;
            readonly snapshotRevision: number;
          };
          hostId: string;
          fingerprint: string;
        }) =>
          intent.type === "INCREMENT"
            ? {
                registry: operations,
                identity: {
                  requestId: "failed-operation" as RequestId,
                  fingerprint,
                  owner: {
                    hostId,
                    machineId: base.id,
                    keyId: key,
                    actorInstanceId: actor.actorInstanceId,
                    actorRevision: actor.snapshotRevision,
                    windowSessionId: sender.windowSessionId,
                  },
                },
                createInvocationRef: () => ({
                  kind: "remote-test",
                  entityKey: key,
                  operationId: "failed-invocation",
                }),
              }
            : undefined,
        ignoredOutcome: () => ({ kind: "ignored" as const }),
        receipt: (actor: {
          readonly actorInstanceId: string;
          readonly snapshotRevision: number;
          readonly transactionSequence: number;
        }) => ({ actor, acknowledgedAt: 0 }),
      },
    } as AnyRemoteMachineDefinition;
    const { duplex, host } = createHarness({ machine });
    const renderer = duplex.connect();
    await renderer.subscribe(address());

    await expect(
      renderer.dispatch(dispatch({ type: "INCREMENT" })),
    ).rejects.toBe(failure);

    expect(host.peek(machine.id, "actor")?.getSnapshot()).toMatchObject({
      value: 0,
    });
    expect(operations.inspect()).toEqual({
      unresolved: 0,
      settled: 0,
      total: 0,
    });
  });

  it("rolls back a native operation when actor dispatch is ignored", async () => {
    type Outcome =
      | { readonly kind: "disposed" }
      | { readonly kind: "superseded" }
      | { readonly kind: "failed" };
    const operations = new OperationRegistry<Outcome, InvocationRef>({
      maxUnresolved: 1,
      maxSettledReplay: 0,
      now: () => 0,
      disposalOutcome: () => ({ kind: "disposed" }),
      supersededOutcome: () => ({ kind: "superseded" }),
      enqueueFailureOutcome: () => ({ kind: "failed" }),
    });
    const base = createRemoteTestMachine();
    const machine = {
      ...base,
      transition: (
        state: Parameters<typeof base.transition>[0],
        event: Parameters<typeof base.transition>[1],
        key: Parameters<typeof base.transition>[2],
      ) =>
        event.type === "START"
          ? ignore(state, "ignored")
          : base.transition(state, event, key),
      remoteIntent: {
        ...base.remoteIntent,
        operationOutcome: {
          maxEnvelopeBytes: 1_024,
          invocationRefCodec: z.any(),
          outcomeCodec: z.any(),
        },
        finalizeOperation: (context, controls) => {
          const admitted = finalizeOperationAdmission({
            registry: operations,
            identity: {
              requestId: context.requestIdentity.requestId,
              fingerprint: context.fingerprint,
              owner: {
                hostId: "main",
                machineId: base.id,
                keyId: context.key,
                actorInstanceId: context.actor.actorInstanceId,
                actorRevision: context.actor.snapshotRevision,
                windowSessionId: context.sender.windowSessionId,
              },
            },
            createInvocationRef: () => ({
              kind: "remote-test",
              entityKey: context.key,
              operationId: "ignored-invocation",
            }),
            assertFinalAdmission: controls.assertFinalAdmission,
            enqueue: controls.enqueue,
            receiptOnEnqueueFailure: () => ({
              actor: context.actor,
              acknowledgedAt: 0,
            }),
          });
          return admitted.kind === "enqueued"
            ? {
                disposition: "fresh" as const,
                enqueueResult: admitted.enqueueResult,
                operation: admitted.operation,
                rollbackAdmission: (error: unknown) => {
                  operations.rollbackAdmission(
                    context.requestIdentity.requestId,
                    admitted.operation.invocationRef,
                    error,
                  );
                },
              }
            : {
                disposition: admitted.kind,
                operation: admitted.operation,
              };
        },
      },
    } satisfies typeof base;
    const { duplex } = createHarness({ machine });
    const renderer = duplex.connect();
    await renderer.subscribe(address());

    await expect(
      renderer.dispatch(
        dispatch(
          {
            type: "START",
            invocationRef: {
              kind: "remote-test",
              entityKey: "actor",
              operationId: "wire-invocation",
            },
          },
          { correlationId: "ignored-request" },
        ),
      ),
    ).resolves.toMatchObject({
      kind: "ignored",
      reason: "ignored",
    });

    expect(operations.inspect()).toEqual({
      unresolved: 0,
      settled: 0,
      total: 0,
    });
  });

  it("rejects legacy dispatch when revision policy replaces its captured gate generation", async () => {
    let revisionPolicyReentry = () => undefined;
    const base = createObjectKeyMachine();
    const machine = {
      ...base,
      remote: {
        ...base.remote,
        revisionPolicy: () => {
          revisionPolicyReentry();
          return "allow-stale" as const;
        },
      },
    } as AnyRemoteMachineDefinition;
    const { duplex, host, transport } = createHarness({ machine });
    const renderer = duplex.connect();
    await renderer.subscribe(objectAddress());

    revisionPolicyReentry = () => {
      const fence = host.beginFence(machine, {
        key: { id: "actor" },
        allowDuringDrain: () => false,
      });
      expect(fence.abort()).toBe(true);
    };

    await expect(
      renderer.dispatch({
        ...dispatch({ type: "INCREMENT" }),
        machineId: "object-key",
      }),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "host-disposing",
    });
    expect(renderer.view(objectAddress())?.state).toEqual({ value: 0 });
    transport.dispose();
  });

  it("revalidates the dispatching window after legacy revision policy reentry", async () => {
    let revisionPolicyReentry = () => undefined;
    const base = createObjectKeyMachine();
    const machine = {
      ...base,
      remote: {
        ...base.remote,
        revisionPolicy: () => {
          revisionPolicyReentry();
          return "allow-stale" as const;
        },
      },
    } as AnyRemoteMachineDefinition;
    const { duplex, transport } = createHarness({ machine });
    const first = duplex.connect();
    const second = duplex.connect();
    await first.subscribe(objectAddress());
    await second.subscribe(objectAddress());

    revisionPolicyReentry = () => {
      revisionPolicyReentry = () => undefined;
      void first.unsubscribe(objectAddress());
    };
    await expect(
      first.dispatch({
        ...dispatch({ type: "INCREMENT" }),
        machineId: "object-key",
      }),
    ).resolves.toMatchObject({
      kind: "rejected",
      reason: "stale-actor",
    });
    expect(transport.inspectSubscriptions()).toEqual([
      expect.objectContaining({
        totalReferences: 1,
        windows: new Map([[2, 1]]),
      }),
    ]);
    await expect(
      second.dispatch({
        ...dispatch({ type: "INCREMENT" }),
        machineId: "object-key",
      }),
    ).resolves.toMatchObject({ kind: "applied", revision: 1 });
    transport.dispose();
  });
});
