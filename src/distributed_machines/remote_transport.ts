import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { Clock } from "@/state_machines/clock";
import type { WindowSessionId } from "@/window_infrastructure/types";
import { ActorAdmissionError, type ActorHost } from "./actor_host";
import type { HostedActorRef, RemoteMachineSender } from "./definition";
import type {
  AnyRemoteMachineDefinition,
  RemoteMachineManifest,
} from "./remote_manifest";
import {
  type MachineAddress,
  type MachineDispatchEnvelope,
  type MachineDispatchReceipt,
  type MachineDisposedEnvelope,
  type MachineRejectedReason,
  type MachineSnapshotEnvelope,
} from "./remote_protocol";

export interface RemoteTransportEndpoint {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  once?(event: "destroyed", listener: () => void): this | void;
}

export interface RemoteTransportWindowRegistry {
  ensureRegistered(endpoint: RemoteTransportEndpoint): WindowSessionId;
  onUnregister(listener: (webContentsId: number) => void): () => void;
  sessionForWebContents(webContentsId: number): WindowSessionId | undefined;
  endpointForSession(
    sessionId: WindowSessionId,
  ): RemoteTransportEndpoint | undefined;
}

export interface RemoteMachineTransportOptions {
  readonly host: ActorHost;
  readonly manifest: RemoteMachineManifest;
  readonly windows: RemoteTransportWindowRegistry;
  readonly clock: Clock;
  readonly deduplicationRetentionMs?: number;
  readonly maxDeduplicationEntries?: number;
  readonly maxSubscriptionsPerWindow?: number;
  readonly onProtocolMismatch?: (context: {
    readonly sender: RemoteMachineSender;
    readonly machineId: string;
    readonly expected: number;
    readonly received: number;
  }) => void;
  readonly onError?: (error: unknown) => void;
}

interface SubscriptionEntry {
  readonly address: string;
  readonly definition: AnyRemoteMachineDefinition;
  readonly key: unknown;
  readonly encodedKey: unknown;
  readonly actor: HostedActorRef<unknown, unknown, string>;
  readonly windows: Map<number, number>;
  unsubscribeActor: () => void;
}

interface DeduplicationEntry {
  readonly createdAt: number;
  readonly receipt: Promise<MachineDispatchReceipt>;
  settled: boolean;
}

const DEFAULT_DEDUPLICATION_RETENTION_MS = 60_000;
const DEFAULT_MAX_DEDUPLICATION_ENTRIES = 1_024;
const DEFAULT_MAX_SUBSCRIPTIONS_PER_WINDOW = 256;

export class RemoteMachineTransport {
  private readonly subscriptions = new Map<string, SubscriptionEntry>();
  private readonly actorKeys = new Map<string, unknown>();
  private readonly referencesPerWindow = new Map<number, number>();
  private readonly deduplication = new Map<string, DeduplicationEntry>();
  private readonly removeWindowListener: () => void;
  private readonly removeDisposalListener: () => void;
  private readonly deduplicationRetentionMs: number;
  private readonly maxDeduplicationEntries: number;
  private readonly maxSubscriptionsPerWindow: number;

  constructor(private readonly options: RemoteMachineTransportOptions) {
    this.deduplicationRetentionMs =
      options.deduplicationRetentionMs ?? DEFAULT_DEDUPLICATION_RETENTION_MS;
    this.maxDeduplicationEntries =
      options.maxDeduplicationEntries ?? DEFAULT_MAX_DEDUPLICATION_ENTRIES;
    this.maxSubscriptionsPerWindow =
      options.maxSubscriptionsPerWindow ?? DEFAULT_MAX_SUBSCRIPTIONS_PER_WINDOW;
    for (const definition of options.manifest.definitions) {
      options.host.register(definition);
    }
    this.removeWindowListener = options.windows.onUnregister((webContentsId) =>
      this.removeWindow(webContentsId),
    );
    this.removeDisposalListener = options.host.onActorDisposed((event) => {
      const definition = options.manifest.get(event.machineId);
      if (!definition) return;
      const address = this.address(definition, event.key);
      this.actorKeys.delete(address);
      const entry = this.subscriptions.get(address);
      if (!entry) return;
      this.subscriptions.delete(address);
      entry.unsubscribeActor();
      this.decrementAllWindowReferences(entry);
      const envelope: MachineDisposedEnvelope = {
        protocolVersion: definition.remote.protocolVersion,
        machineId: definition.id,
        encodedKey: entry.encodedKey,
        actorInstanceId: event.metadata.actorInstanceId,
        finalRevision: event.metadata.snapshotRevision,
      };
      for (const webContentsId of entry.windows.keys()) {
        this.send(webContentsId, "distributed-machine:disposed", envelope);
      }
    });
  }

  async subscribe(
    sender: RemoteTransportEndpoint,
    input: MachineAddress,
  ): Promise<MachineSnapshotEnvelope> {
    const windowSessionId = this.options.windows.ensureRegistered(sender);
    const definition = this.requireDefinition(input.machineId);
    this.assertProtocol(sender, definition, input.protocolVersion);
    const key = this.decodeKey(definition, input.encodedKey);
    const senderContext = this.senderContext(sender);
    try {
      await definition.remote.authorizeSubscribe({
        sender: senderContext,
        key,
      });
    } catch (error) {
      throw new DyadError(
        "Remote machine subscription is unauthorized",
        DyadErrorKind.Auth,
        {
          cause: error,
        },
      );
    }
    this.assertCurrentSender(sender, windowSessionId);

    const currentReferences = this.referencesPerWindow.get(sender.id) ?? 0;
    const address = this.address(definition, key);
    const existingEntry = this.subscriptions.get(address);
    const alreadySubscribed = existingEntry?.windows.has(sender.id) === true;
    if (
      !alreadySubscribed &&
      currentReferences >= this.maxSubscriptionsPerWindow
    ) {
      throw new DyadError(
        "Remote machine subscription limit exceeded",
        DyadErrorKind.RateLimited,
      );
    }

    let entry = existingEntry;
    if (!entry) {
      const canonicalKey = this.actorKeys.get(address) ?? key;
      this.actorKeys.set(address, canonicalKey);
      const encodedKey = this.encodeKey(definition, canonicalKey);
      const actor = this.options.host.localRef(
        definition,
        canonicalKey,
      ) as HostedActorRef<unknown, unknown, string>;
      entry = {
        address,
        definition,
        key: canonicalKey,
        encodedKey,
        actor,
        windows: new Map(),
        unsubscribeActor: () => undefined,
      };
      this.subscriptions.set(address, entry);
      entry.unsubscribeActor = actor.subscribe(() =>
        this.broadcastSnapshot(entry!),
      );
    }

    if (!alreadySubscribed) {
      entry.windows.set(sender.id, 1);
      this.referencesPerWindow.set(sender.id, currentReferences + 1);
    }

    // Atomic bootstrap invariant: there is deliberately no await between
    // subscriber registration above and this snapshot capture.
    try {
      return this.snapshotEnvelope(entry);
    } catch (error) {
      if (!alreadySubscribed) this.removeWindowReference(entry, sender.id);
      throw error;
    }
  }

  async unsubscribe(
    sender: RemoteTransportEndpoint,
    input: MachineAddress,
  ): Promise<void> {
    this.options.windows.ensureRegistered(sender);
    const definition = this.requireDefinition(input.machineId);
    this.assertProtocol(sender, definition, input.protocolVersion);
    const key = this.decodeKey(definition, input.encodedKey);
    const entry = this.subscriptions.get(this.address(definition, key));
    if (!entry) return;
    this.removeWindowReference(entry, sender.id);
  }

  dispatch(
    sender: RemoteTransportEndpoint,
    envelope: MachineDispatchEnvelope,
  ): Promise<MachineDispatchReceipt> {
    const windowSessionId = this.options.windows.ensureRegistered(sender);
    this.pruneDeduplication();
    const deduplicationKey = `${sender.id}\0${envelope.messageId}`;
    const previous = this.deduplication.get(deduplicationKey);
    if (previous) return previous.receipt;
    if (!this.reserveDeduplicationCapacity()) {
      return Promise.reject(
        new DyadError(
          "Remote machine in-flight dispatch limit exceeded",
          DyadErrorKind.RateLimited,
        ),
      );
    }
    const receipt = this.dispatchOnce(sender, windowSessionId, envelope);
    const entry: DeduplicationEntry = {
      createdAt: this.options.clock.now(),
      receipt,
      settled: false,
    };
    this.deduplication.set(deduplicationKey, entry);
    void receipt.then(
      () => {
        entry.settled = true;
      },
      () => {
        entry.settled = true;
      },
    );
    return receipt;
  }

  inspectSubscriptions(): readonly {
    machineId: string;
    key: unknown;
    totalReferences: number;
    windows: ReadonlyMap<number, number>;
  }[] {
    return [...this.subscriptions.values()].map((entry) => ({
      machineId: entry.definition.id,
      key: entry.key,
      totalReferences: [...entry.windows.values()].reduce(
        (total, count) => total + count,
        0,
      ),
      windows: new Map(entry.windows),
    }));
  }

  dispose(): void {
    this.removeWindowListener();
    this.removeDisposalListener();
    for (const entry of this.subscriptions.values()) entry.unsubscribeActor();
    this.subscriptions.clear();
    this.actorKeys.clear();
    this.referencesPerWindow.clear();
    this.deduplication.clear();
  }

  private async dispatchOnce(
    sender: RemoteTransportEndpoint,
    windowSessionId: WindowSessionId,
    envelope: MachineDispatchEnvelope,
  ): Promise<MachineDispatchReceipt> {
    const definition = this.options.manifest.get(envelope.machineId);
    if (!definition) {
      return this.rejected(envelope.messageId, "unknown-machine");
    }
    if (envelope.protocolVersion !== definition.remote.protocolVersion) {
      this.noteProtocolMismatch(sender, definition, envelope.protocolVersion);
      return this.rejected(envelope.messageId, "protocol-version");
    }
    const keyResult = definition.remote.keyCodec.safeParse(envelope.encodedKey);
    if (!keyResult.success) {
      return this.rejected(envelope.messageId, "invalid-key");
    }
    const eventResult = definition.remote.eventCodec.safeParse(
      envelope.encodedEvent,
    );
    if (!eventResult.success) {
      return this.rejected(envelope.messageId, "invalid-event");
    }
    const address = this.address(definition, keyResult.data);
    const senderContext = this.senderContext(sender);
    let key = this.actorKeys.get(address) ?? keyResult.data;
    let current = this.options.host.peek<unknown, unknown, string>(
      definition.id,
      key,
    );
    for (;;) {
      const authorizedActorInstanceId = current?.getMetadata().actorInstanceId;
      const authorizedRevision = current?.getMetadata().snapshotRevision;
      try {
        await definition.remote.authorizeDispatch({
          sender: senderContext,
          key,
          event: eventResult.data,
          currentState: current?.getSnapshot(),
        });
      } catch {
        return this.rejected(envelope.messageId, "unauthorized");
      }
      if (!this.isCurrentSender(sender, windowSessionId)) {
        return this.rejected(envelope.messageId, "host-disposing");
      }

      key = this.actorKeys.get(address) ?? key;
      const authorizedCurrent = this.options.host.peek<
        unknown,
        unknown,
        string
      >(definition.id, key);
      const metadata = authorizedCurrent?.getMetadata();
      if (
        metadata?.actorInstanceId === authorizedActorInstanceId &&
        metadata?.snapshotRevision === authorizedRevision
      ) {
        current = authorizedCurrent;
        break;
      }
      current = authorizedCurrent;
    }

    const revisionPolicy = definition.remote.revisionPolicy(eventResult.data);
    const currentRevision = current?.getMetadata().snapshotRevision ?? 0;
    if (
      revisionPolicy === "reject-stale" &&
      (envelope.expectedRevision === undefined ||
        currentRevision !== envelope.expectedRevision)
    ) {
      return this.rejected(envelope.messageId, "revision-conflict");
    }

    this.actorKeys.set(address, key);
    const ticket = this.options.host.dispatch(
      definition,
      key,
      eventResult.data,
      envelope.expectedActorInstanceId,
    );
    const dispatchedActor = this.options.host.peek<unknown, unknown, string>(
      definition.id,
      key,
    );
    const outcome = await ticket.settled;
    if (outcome.kind === "failed") {
      if (outcome.error instanceof ActorAdmissionError) {
        if (outcome.error.code === "stale-actor-instance") {
          return this.rejected(envelope.messageId, "stale-actor");
        }
        return this.rejected(envelope.messageId, "host-disposing");
      }
      throw outcome.error;
    }
    if (outcome.kind === "disposed" || !dispatchedActor) {
      this.actorKeys.delete(address);
      return this.rejected(envelope.messageId, "host-disposing");
    }
    const metadata = ticket.getSettledMetadata();
    if (!metadata) {
      return this.rejected(envelope.messageId, "host-disposing");
    }
    if (outcome.kind === "ignored") {
      return {
        kind: "ignored",
        actorInstanceId: metadata.actorInstanceId,
        revision: metadata.snapshotRevision,
        transactionSequence: metadata.transactionSequence,
        messageId: envelope.messageId,
        reason: outcome.reason,
      };
    }
    return {
      kind: "applied",
      actorInstanceId: metadata.actorInstanceId,
      revision: metadata.snapshotRevision,
      transactionSequence: metadata.transactionSequence,
      messageId: envelope.messageId,
    };
  }

  private snapshotEnvelope(entry: SubscriptionEntry): MachineSnapshotEnvelope {
    const metadata = entry.actor.getMetadata();
    const projected = entry.definition.remote.projectSnapshot(
      entry.actor.getSnapshot(),
      entry.key,
    );
    const parsed = entry.definition.remote.snapshotCodec.safeParse(projected);
    if (!parsed.success) {
      throw new Error(
        `Remote snapshot projection failed for ${entry.definition.id}: ${parsed.error.message}`,
      );
    }
    return {
      protocolVersion: entry.definition.remote.protocolVersion,
      machineId: entry.definition.id,
      encodedKey: entry.encodedKey,
      actorInstanceId: metadata.actorInstanceId,
      revision: metadata.snapshotRevision,
      encodedState: parsed.data,
    };
  }

  private broadcastSnapshot(entry: SubscriptionEntry): void {
    let envelope: MachineSnapshotEnvelope;
    try {
      envelope = this.snapshotEnvelope(entry);
    } catch (error) {
      this.options.onError?.(error);
      return;
    }
    for (const webContentsId of entry.windows.keys()) {
      this.send(webContentsId, "distributed-machine:snapshot", envelope);
    }
  }

  private send(webContentsId: number, channel: string, payload: unknown): void {
    const sessionId = this.options.windows.sessionForWebContents(webContentsId);
    const endpoint = sessionId
      ? this.options.windows.endpointForSession(sessionId)
      : undefined;
    if (!endpoint || endpoint.isDestroyed()) return;
    try {
      endpoint.send(channel, payload);
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  private removeWindow(webContentsId: number): void {
    for (const entry of this.subscriptions.values()) {
      const count = entry.windows.get(webContentsId);
      if (count === undefined) continue;
      entry.windows.delete(webContentsId);
      this.decrementWindowReferences(webContentsId, count);
      this.releaseEntryIfUnused(entry);
    }
  }

  private removeWindowReference(
    entry: SubscriptionEntry,
    webContentsId: number,
  ): void {
    const count = entry.windows.get(webContentsId);
    if (count === undefined) return;
    entry.windows.delete(webContentsId);
    this.decrementWindowReferences(webContentsId, 1);
    this.releaseEntryIfUnused(entry);
  }

  private releaseEntryIfUnused(entry: SubscriptionEntry): void {
    if (entry.windows.size > 0) return;
    this.subscriptions.delete(entry.address);
    entry.unsubscribeActor();
  }

  private decrementAllWindowReferences(entry: SubscriptionEntry): void {
    for (const [webContentsId, count] of entry.windows) {
      this.decrementWindowReferences(webContentsId, count);
    }
  }

  private decrementWindowReferences(webContentsId: number, count: number) {
    const next = (this.referencesPerWindow.get(webContentsId) ?? 0) - count;
    if (next > 0) {
      this.referencesPerWindow.set(webContentsId, next);
    } else {
      this.referencesPerWindow.delete(webContentsId);
    }
  }

  private decodeKey(
    definition: AnyRemoteMachineDefinition,
    encodedKey: unknown,
  ): unknown {
    const parsed = definition.remote.keyCodec.safeParse(encodedKey);
    if (!parsed.success) {
      throw new DyadError(
        "Invalid remote machine key",
        DyadErrorKind.Validation,
      );
    }
    return parsed.data;
  }

  private encodeKey(
    definition: AnyRemoteMachineDefinition,
    key: unknown,
  ): unknown {
    const encodedKey = definition.remote.encodeKey(key);
    const roundTrip = definition.remote.keyCodec.safeParse(encodedKey);
    if (
      !roundTrip.success ||
      this.address(definition, roundTrip.data) !== this.address(definition, key)
    ) {
      throw new Error(`Remote key encoding failed for ${definition.id}`);
    }
    return encodedKey;
  }

  private requireDefinition(machineId: string): AnyRemoteMachineDefinition {
    const definition = this.options.manifest.get(machineId);
    if (!definition) {
      throw new DyadError(
        `Unknown remote machine: ${machineId}`,
        DyadErrorKind.NotFound,
      );
    }
    return definition;
  }

  private address(
    definition: AnyRemoteMachineDefinition,
    key: unknown,
  ): string {
    return `${definition.id}\0${definition.remote.keyToString(key)}`;
  }

  private senderContext(sender: RemoteTransportEndpoint): RemoteMachineSender {
    return {
      webContentsId: sender.id,
      windowSessionId: this.options.windows.sessionForWebContents(sender.id),
    };
  }

  private assertProtocol(
    sender: RemoteTransportEndpoint,
    definition: AnyRemoteMachineDefinition,
    received: number,
  ): void {
    if (received === definition.remote.protocolVersion) return;
    this.noteProtocolMismatch(sender, definition, received);
    throw new DyadError(
      "Remote machine protocol mismatch; reload the renderer",
      DyadErrorKind.Precondition,
    );
  }

  private noteProtocolMismatch(
    sender: RemoteTransportEndpoint,
    definition: AnyRemoteMachineDefinition,
    received: number,
  ): void {
    try {
      this.options.onProtocolMismatch?.({
        sender: this.senderContext(sender),
        machineId: definition.id,
        expected: definition.remote.protocolVersion,
        received,
      });
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  private assertCurrentSender(
    sender: RemoteTransportEndpoint,
    sessionId: WindowSessionId,
  ): void {
    if (this.isCurrentSender(sender, sessionId)) return;
    throw new DyadError(
      "Remote machine sender was destroyed during authorization",
      DyadErrorKind.Precondition,
    );
  }

  private isCurrentSender(
    sender: RemoteTransportEndpoint,
    sessionId: WindowSessionId,
  ): boolean {
    return (
      !sender.isDestroyed() &&
      this.options.windows.sessionForWebContents(sender.id) === sessionId
    );
  }

  private rejected(
    messageId: string,
    reason: MachineRejectedReason,
  ): MachineDispatchReceipt {
    return { kind: "rejected", messageId, reason };
  }

  private pruneDeduplication(): void {
    const oldestAllowed =
      this.options.clock.now() - this.deduplicationRetentionMs;
    for (const [key, entry] of this.deduplication) {
      if (entry.settled && entry.createdAt < oldestAllowed) {
        this.deduplication.delete(key);
      }
    }
  }

  private reserveDeduplicationCapacity(): boolean {
    while (this.deduplication.size >= this.maxDeduplicationEntries) {
      const oldestSettled = [...this.deduplication].find(
        ([, entry]) => entry.settled,
      );
      if (!oldestSettled) return false;
      this.deduplication.delete(oldestSettled[0]);
    }
    return true;
  }
}
