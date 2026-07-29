import { createHash } from "node:crypto";
import { serialize } from "node:v8";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type { Clock } from "@/state_machines/clock";
import { PendingReceiptLedger } from "@/state_machines/pending_receipt_ledger";
import type { WindowSessionId } from "@/window_infrastructure/types";
import { ActorAdmissionError, type ActorHost } from "./actor_host";
import type {
  ActorRuntimeMetadata,
  HostedActorRef,
  RemoteMachineSender,
} from "./definition";
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
import type { RemoteAuthorizationDecision } from "./remote_intent_contract";

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
  readonly maxPendingDeduplicationEntries?: number;
  readonly maxSettledDeduplicationEntries?: number;
  readonly maxSubscriptionsPerWindow?: number;
  readonly maxAddressEnvelopeBytes?: number;
  readonly maxDispatchEnvelopeBytes?: number;
  readonly maxSnapshotEnvelopeBytes?: number;
  readonly measureSerializedBytes?: (value: unknown) => number;
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

interface PreparedDispatchIdentity {
  readonly definition: AnyRemoteMachineDefinition;
  readonly key: unknown;
  readonly intent: { readonly type: string };
  readonly address: string;
  readonly admittedEntry: SubscriptionEntry;
  readonly actor: HostedActorRef<unknown, unknown, string>;
  readonly actorMetadata: ActorRuntimeMetadata;
  readonly lifecycleGeneration: {
    readonly host: number;
    readonly machine: number;
  };
  readonly windowSessionId: WindowSessionId;
  readonly fingerprint: string;
  consumed: boolean;
}

interface PendingSubscription {
  readonly address: string;
  readonly webContentsId: number;
  readonly countsTowardLimit: boolean;
  readonly lifecycleGeneration: {
    readonly host: number;
    readonly machine: number;
  };
  cancelled: boolean;
  accountingReleased: boolean;
  promise?: Promise<MachineSnapshotEnvelope>;
}

interface PreparedSubscribe {
  readonly definition: AnyRemoteMachineDefinition;
  readonly decodedKey: unknown;
  readonly encodedKey: unknown;
  readonly address: string;
  readonly windowSessionId: WindowSessionId;
  readonly pending: PendingSubscription;
  consumed: boolean;
}

const DEFAULT_DEDUPLICATION_RETENTION_MS = 60_000;
const DEFAULT_MAX_DEDUPLICATION_ENTRIES = 1_024;
const DEFAULT_MAX_SUBSCRIPTIONS_PER_WINDOW = 256;
const DEFAULT_MAX_ADDRESS_ENVELOPE_BYTES = 64 * 1_024;
const DEFAULT_MAX_DISPATCH_ENVELOPE_BYTES = 256 * 1_024;
const DEFAULT_MAX_SNAPSHOT_ENVELOPE_BYTES = 1_024 * 1_024;

export class RemoteMachineTransport {
  private readonly subscriptions = new Map<string, SubscriptionEntry>();
  private readonly actorKeys = new Map<string, unknown>();
  private readonly referencesPerWindow = new Map<number, number>();
  private readonly pendingSubscriptions = new Map<
    string,
    PendingSubscription
  >();
  private readonly pendingReferencesPerWindow = new Map<number, number>();
  private readonly receiptLedger: PendingReceiptLedger<MachineDispatchReceipt>;
  private readonly removeWindowListener: () => void;
  private readonly removeDisposalListener: () => void;
  private readonly maxSubscriptionsPerWindow: number;
  private readonly maxAddressEnvelopeBytes: number;
  private readonly maxDispatchEnvelopeBytes: number;
  private readonly maxSnapshotEnvelopeBytes: number;
  private readonly measureSerializedBytes: (value: unknown) => number;
  private disposed = false;

  constructor(private readonly options: RemoteMachineTransportOptions) {
    const legacyDeduplicationLimit =
      options.maxDeduplicationEntries ?? DEFAULT_MAX_DEDUPLICATION_ENTRIES;
    this.receiptLedger = new PendingReceiptLedger({
      clock: options.clock,
      maxPendingEntries:
        options.maxPendingDeduplicationEntries ?? legacyDeduplicationLimit,
      maxSettledEntries:
        options.maxSettledDeduplicationEntries ?? legacyDeduplicationLimit,
      settledRetentionMs:
        options.deduplicationRetentionMs ?? DEFAULT_DEDUPLICATION_RETENTION_MS,
      disposal: {
        kind: "resolve",
        value: ({ messageId }) => this.rejected(messageId, "host-disposing"),
      },
    });
    this.maxSubscriptionsPerWindow =
      options.maxSubscriptionsPerWindow ?? DEFAULT_MAX_SUBSCRIPTIONS_PER_WINDOW;
    this.maxAddressEnvelopeBytes =
      options.maxAddressEnvelopeBytes ?? DEFAULT_MAX_ADDRESS_ENVELOPE_BYTES;
    this.maxDispatchEnvelopeBytes =
      options.maxDispatchEnvelopeBytes ?? DEFAULT_MAX_DISPATCH_ENVELOPE_BYTES;
    this.maxSnapshotEnvelopeBytes =
      options.maxSnapshotEnvelopeBytes ?? DEFAULT_MAX_SNAPSHOT_ENVELOPE_BYTES;
    this.measureSerializedBytes =
      options.measureSerializedBytes ??
      ((value) => serialize(value).byteLength);
    for (const definition of options.manifest.definitions) {
      options.host.register(definition);
    }
    this.removeWindowListener = options.windows.onUnregister((webContentsId) =>
      this.removeWindow(webContentsId),
    );
    this.removeDisposalListener = options.host.onActorDisposed((event) => {
      const definition = options.manifest.get(event.machineId);
      if (!definition) return;
      const address = this.wireAddress(
        definition,
        this.encodeKey(definition, event.key),
      );
      this.cancelPendingSubscriptionsForAddress(address);
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
    this.assertOpen();
    this.assertAddressWithinLimit(input);
    const windowSessionId = this.options.windows.ensureRegistered(sender);
    const definition = this.requireDefinition(input.machineId);
    this.assertProtocol(sender, definition, input.protocolVersion);
    const key = this.decodeKey(definition, input.encodedKey);
    const encodedKey = this.encodeKey(definition, key);
    const address = this.wireAddress(definition, encodedKey);
    const existingBeforeAuthorization = this.subscriptions.get(address);
    const alreadySubscribedBeforeAuthorization =
      existingBeforeAuthorization?.windows.has(sender.id) === true;
    const pendingKey = this.pendingSubscriptionKey(sender.id, address);
    const existingPending = this.pendingSubscriptions.get(pendingKey);
    if (existingPending?.promise) return existingPending.promise;
    const pending = this.beginPendingSubscription(
      sender.id,
      address,
      !alreadySubscribedBeforeAuthorization,
      definition.id,
    );
    const prepared: PreparedSubscribe = {
      definition,
      decodedKey: key,
      encodedKey,
      address,
      windowSessionId,
      pending,
      consumed: false,
    };
    const promise = Promise.resolve().then(() =>
      this.completeSubscription(sender, prepared),
    );
    pending.promise = promise;
    return promise;
  }

  private async completeSubscription(
    sender: RemoteTransportEndpoint,
    prepared: PreparedSubscribe,
  ): Promise<MachineSnapshotEnvelope> {
    const { definition, pending, address } = prepared;
    const senderContext = this.senderContext(sender);
    try {
      const decision = await this.authorizeSubscribe(definition, {
        sender: senderContext,
        key: prepared.decodedKey,
        encodedKey: prepared.encodedKey,
      });
      if (decision.kind === "deny") throw decision.error;
      this.assertPreparedSubscribeCurrent(sender, prepared);

      const authorizedKey =
        definition.remote.canonicalizeKeyAfterAuthorization?.(
          prepared.decodedKey,
        ) ?? prepared.decodedKey;
      const canonicalEncodedKey = this.encodeKey(definition, authorizedKey);
      const canonicalKey = this.actorKeys.get(address) ?? authorizedKey;
      const currentReferences = this.referencesPerWindow.get(sender.id) ?? 0;
      let entry = this.subscriptions.get(address);
      const alreadySubscribed = entry?.windows.has(sender.id) === true;
      if (
        !alreadySubscribed &&
        currentReferences >= this.maxSubscriptionsPerWindow
      ) {
        throw new DyadError(
          "Remote machine subscription limit exceeded",
          DyadErrorKind.RateLimited,
        );
      }
      this.assertPreparedSubscribeCurrent(sender, prepared);
      if (
        entry &&
        this.options.host.peek(definition.id, entry.key) !== entry.actor
      ) {
        throw new DyadError(
          "Remote machine actor changed during subscription authorization",
          DyadErrorKind.Precondition,
        );
      }
      if (prepared.consumed) {
        throw new DyadError(
          "Prepared remote subscription was already consumed",
          DyadErrorKind.Precondition,
        );
      }
      prepared.consumed = true;

      if (!entry) {
        let actor: HostedActorRef<unknown, unknown, string>;
        try {
          actor = this.options.host.localRef(
            definition,
            canonicalKey,
          ) as HostedActorRef<unknown, unknown, string>;
        } catch (error) {
          if (error instanceof ActorAdmissionError) {
            throw new DyadError(
              `Remote machine subscription was refused: ${error.message}`,
              DyadErrorKind.Precondition,
              { cause: error },
            );
          }
          throw error;
        }
        this.actorKeys.set(address, canonicalKey);
        entry = {
          address,
          definition,
          key: canonicalKey,
          encodedKey: canonicalEncodedKey,
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
    } finally {
      this.finishPendingSubscription(pending);
    }
  }

  private assertPreparedSubscribeCurrent(
    sender: RemoteTransportEndpoint,
    prepared: PreparedSubscribe,
  ): void {
    this.assertOpen();
    if (
      prepared.pending.cancelled ||
      prepared.pending.accountingReleased ||
      this.pendingSubscriptions.get(
        this.pendingSubscriptionKey(sender.id, prepared.address),
      ) !== prepared.pending
    ) {
      throw new DyadError(
        "Remote machine subscription was cancelled",
        DyadErrorKind.Precondition,
      );
    }
    this.assertCurrentSender(sender, prepared.windowSessionId);
    if (
      !this.options.host.isAdmissionGenerationCurrent(
        prepared.definition.id,
        prepared.pending.lifecycleGeneration,
      )
    ) {
      throw new DyadError(
        "Remote machine lifecycle changed during subscription authorization",
        DyadErrorKind.Precondition,
      );
    }
  }

  async unsubscribe(
    sender: RemoteTransportEndpoint,
    input: MachineAddress,
  ): Promise<void> {
    this.assertOpen();
    this.assertAddressWithinLimit(input);
    this.options.windows.ensureRegistered(sender);
    const definition = this.requireDefinition(input.machineId);
    this.assertProtocol(sender, definition, input.protocolVersion);
    const key = this.decodeKey(definition, input.encodedKey);
    const address = this.wireAddress(
      definition,
      this.encodeKey(definition, key),
    );
    this.cancelPendingSubscriptions(sender.id, address);
    const entry = this.subscriptions.get(address);
    if (!entry) return;
    this.removeWindowReference(entry, sender.id);
  }

  dispatch(
    sender: RemoteTransportEndpoint,
    envelope: MachineDispatchEnvelope,
  ): Promise<MachineDispatchReceipt> {
    this.assertOpen();
    const windowSessionId = this.options.windows.ensureRegistered(sender);
    const dispatchLimit =
      this.options.manifest.get(envelope.machineId)?.remote
        .maxDispatchEnvelopeBytes ?? this.maxDispatchEnvelopeBytes;
    if (!this.isWithinSerializedLimit(envelope, dispatchLimit)) {
      return Promise.resolve(
        this.rejected(envelope.messageId, "invalid-event"),
      );
    }
    const prepared = this.prepareDispatchIdentity(
      sender,
      windowSessionId,
      envelope,
    );
    if ("receipt" in prepared) {
      return Promise.resolve(
        this.receiptLedger.hasReceipt(windowSessionId, envelope.messageId)
          ? this.rejected(envelope.messageId, "invalid-event")
          : prepared.receipt,
      );
    }
    const claim = this.receiptLedger.claim({
      scope: windowSessionId,
      messageId: envelope.messageId,
      fingerprint: prepared.fingerprint,
      start: () =>
        this.dispatchOnce(sender, windowSessionId, envelope, prepared),
      retention: (settlement) =>
        settlement.status === "fulfilled" &&
        settlement.value.kind === "rejected" &&
        settlement.value.reason === "host-disposing"
          ? "remove"
          : "retain",
    });
    switch (claim.kind) {
      case "fresh":
      case "duplicate":
        return claim.receipt;
      case "conflict":
        return Promise.resolve(
          this.rejected(envelope.messageId, "invalid-event"),
        );
      case "capacity-rejected":
        return Promise.reject(
          new DyadError(
            "Remote machine in-flight dispatch limit exceeded",
            DyadErrorKind.RateLimited,
          ),
        );
      case "disposed":
        return Promise.resolve(
          this.rejected(envelope.messageId, "host-disposing"),
        );
      default: {
        const exhaustive: never = claim;
        return exhaustive;
      }
    }
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

  inspectPendingSubscriptions(): readonly {
    address: string;
    webContentsId: number;
    countsTowardLimit: boolean;
  }[] {
    return [...this.pendingSubscriptions.values()].map((pending) => ({
      address: pending.address,
      webContentsId: pending.webContentsId,
      countsTowardLimit: pending.countsTowardLimit,
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pendingSubscriptions.values()) {
      this.cancelPendingSubscription(pending);
    }
    this.removeWindowListener();
    this.removeDisposalListener();
    for (const entry of this.subscriptions.values()) entry.unsubscribeActor();
    this.subscriptions.clear();
    this.actorKeys.clear();
    this.referencesPerWindow.clear();
    this.pendingReferencesPerWindow.clear();
    this.receiptLedger.dispose();
  }

  private prepareDispatchIdentity(
    sender: RemoteTransportEndpoint,
    windowSessionId: WindowSessionId,
    envelope: MachineDispatchEnvelope,
  ): PreparedDispatchIdentity | { readonly receipt: MachineDispatchReceipt } {
    const definition = this.options.manifest.get(envelope.machineId);
    if (!definition) {
      return { receipt: this.rejected(envelope.messageId, "unknown-machine") };
    }
    if (envelope.protocolVersion !== definition.remote.protocolVersion) {
      this.noteProtocolMismatch(sender, definition, envelope.protocolVersion);
      return { receipt: this.rejected(envelope.messageId, "protocol-version") };
    }
    const keyResult = definition.remote.keyCodec.safeParse(envelope.encodedKey);
    if (!keyResult.success) {
      return { receipt: this.rejected(envelope.messageId, "invalid-key") };
    }
    const intentResult = this.rendererIntentCodec(definition).safeParse(
      envelope.encodedEvent,
    );
    if (!intentResult.success) {
      return { receipt: this.rejected(envelope.messageId, "invalid-event") };
    }
    const intent = intentResult.data as { readonly type: string };
    const encodedKey = this.encodeKey(definition, keyResult.data);
    const address = this.wireAddress(definition, encodedKey);
    const admittedEntry = this.subscriptions.get(address);
    if (!admittedEntry || !admittedEntry.windows.has(sender.id)) {
      return { receipt: this.rejected(envelope.messageId, "stale-actor") };
    }
    if (
      definition.remoteIntent?.keyIntentRelationship.kind === "validate" &&
      !definition.remoteIntent.keyIntentRelationship.validate(
        admittedEntry.key,
        intent,
      )
    ) {
      return {
        receipt: this.rejected(
          envelope.messageId,
          definition.remoteIntent.refusalMap.keyIntentMismatch,
        ),
      };
    }
    const actor = this.options.host.peek<unknown, unknown, string>(
      definition.id,
      admittedEntry.key,
    );
    if (!actor || actor !== admittedEntry.actor) {
      return { receipt: this.rejected(envelope.messageId, "stale-actor") };
    }
    const actorMetadata = actor.getMetadata();
    if (
      envelope.expectedActorInstanceId !== undefined &&
      envelope.expectedActorInstanceId !== actorMetadata.actorInstanceId
    ) {
      return { receipt: this.rejected(envelope.messageId, "stale-actor") };
    }
    const revisionPolicy =
      definition.remoteIntent?.intents[intent.type]?.observedRevision;
    if (
      revisionPolicy?.kind === "actor" &&
      envelope.expectedRevision === undefined
    ) {
      return {
        receipt: this.rejected(envelope.messageId, "revision-conflict"),
      };
    }
    const fingerprint = createHash("sha256")
      .update(
        serialize([
          envelope.protocolVersion,
          definition.id,
          admittedEntry.encodedKey,
          intent,
          envelope.expectedActorInstanceId,
          envelope.expectedRevision,
          envelope.correlationId,
          envelope.causationId,
        ]),
      )
      .digest("hex");
    return {
      definition,
      key: admittedEntry.key,
      intent,
      address,
      admittedEntry,
      actor,
      actorMetadata,
      lifecycleGeneration: this.options.host.captureAdmissionGeneration(
        definition.id,
      ),
      windowSessionId,
      fingerprint,
      consumed: false,
    };
  }

  private async dispatchOnce(
    sender: RemoteTransportEndpoint,
    windowSessionId: WindowSessionId,
    envelope: MachineDispatchEnvelope,
    prepared: PreparedDispatchIdentity,
  ): Promise<MachineDispatchReceipt> {
    const {
      definition,
      key,
      intent,
      address,
      admittedEntry,
      actor,
      actorMetadata,
    } = prepared;
    const senderContext = this.senderContext(sender);
    const decision = await this.authorizeDispatch(definition, {
      sender: senderContext,
      key,
      intent,
      currentState: actor.getSnapshot(),
      actor: actorMetadata,
      expectedObservedRevision: envelope.expectedRevision,
    });
    if (decision.kind === "deny") {
      return this.rejected(
        envelope.messageId,
        definition.remoteIntent?.refusalMap.authorization ?? "unauthorized",
      );
    }
    if (this.disposed || !this.isCurrentSender(sender, windowSessionId)) {
      return this.rejected(envelope.messageId, "host-disposing");
    }
    if (
      this.subscriptions.get(address) !== admittedEntry ||
      !admittedEntry.windows.has(sender.id)
    ) {
      return this.rejected(envelope.messageId, "stale-actor");
    }
    if (
      !this.options.host.isAdmissionGenerationCurrent(
        definition.id,
        prepared.lifecycleGeneration,
      )
    ) {
      return this.rejected(envelope.messageId, "host-disposing");
    }
    const current = this.options.host.peek<unknown, unknown, string>(
      definition.id,
      key,
    );
    if (!current || current !== actor) {
      return this.rejected(envelope.messageId, "stale-actor");
    }
    const currentMetadata = current.getMetadata();
    if (currentMetadata.actorInstanceId !== actorMetadata.actorInstanceId) {
      return this.rejected(envelope.messageId, "stale-actor");
    }
    if (currentMetadata.snapshotRevision !== actorMetadata.snapshotRevision) {
      return this.rejected(envelope.messageId, "revision-conflict");
    }
    const revisionPolicy = definition.remote.revisionPolicy(intent as never);
    const currentRevision = currentMetadata.snapshotRevision;
    if (
      revisionPolicy === "reject-stale" &&
      (envelope.expectedRevision === undefined ||
        currentRevision !== envelope.expectedRevision)
    ) {
      return this.rejected(envelope.messageId, "revision-conflict");
    }

    const event = this.toInternalEvent(
      definition,
      key,
      intent,
      senderContext.windowSessionId,
    );
    if (
      prepared.consumed ||
      this.subscriptions.get(address) !== admittedEntry ||
      this.options.host.peek(definition.id, key) !== actor
    ) {
      return this.rejected(envelope.messageId, "stale-actor");
    }
    prepared.consumed = true;
    const ticket = this.options.host.dispatch(
      definition,
      key,
      event,
      actorMetadata.actorInstanceId,
      {
        messageId: envelope.messageId,
        correlationId: envelope.correlationId,
        causationId: envelope.causationId,
      },
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
      metadata,
    );
    const parsed = entry.definition.remote.snapshotCodec.safeParse(projected);
    if (!parsed.success) {
      throw new Error(
        `Remote snapshot projection failed for ${entry.definition.id}: ${parsed.error.message}`,
      );
    }
    const envelope: MachineSnapshotEnvelope = {
      protocolVersion: entry.definition.remote.protocolVersion,
      machineId: entry.definition.id,
      encodedKey: entry.encodedKey,
      actorInstanceId: metadata.actorInstanceId,
      revision: metadata.snapshotRevision,
      encodedState: parsed.data,
    };
    if (
      !this.isWithinSerializedLimit(
        envelope,
        entry.definition.remote.maxSnapshotEnvelopeBytes ??
          this.maxSnapshotEnvelopeBytes,
      )
    ) {
      throw new DyadError(
        `Remote snapshot exceeds the transport limit for ${entry.definition.id}`,
        DyadErrorKind.RateLimited,
      );
    }
    return envelope;
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
    for (const pending of this.pendingSubscriptions.values()) {
      if (pending.webContentsId === webContentsId) {
        this.cancelPendingSubscription(pending);
      }
    }
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
      this.domainAddress(definition, roundTrip.data) !==
        this.domainAddress(definition, key)
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

  private domainAddress(
    definition: AnyRemoteMachineDefinition,
    key: unknown,
  ): string {
    return `${definition.id}\0${definition.remote.keyToString(key)}`;
  }

  private wireAddress(
    definition: AnyRemoteMachineDefinition,
    encodedKey: unknown,
  ): string {
    return createHash("sha256")
      .update(
        serialize([
          definition.remote.protocolVersion,
          definition.id,
          encodedKey,
        ]),
      )
      .digest("hex");
  }

  private senderContext(
    sender: RemoteTransportEndpoint,
  ): RemoteMachineSender & { readonly windowSessionId: WindowSessionId } {
    const windowSessionId = this.options.windows.sessionForWebContents(
      sender.id,
    );
    if (!windowSessionId) {
      throw new DyadError(
        "Remote machine sender has no registered window session",
        DyadErrorKind.Precondition,
      );
    }
    return {
      webContentsId: sender.id,
      windowSessionId,
    };
  }

  private rendererIntentCodec(definition: AnyRemoteMachineDefinition) {
    return (
      definition.remoteIntent?.rendererIntentCodec ??
      definition.remote.eventCodec
    );
  }

  private async authorizeSubscribe(
    definition: AnyRemoteMachineDefinition,
    context: {
      readonly sender: RemoteMachineSender & {
        readonly windowSessionId: string;
      };
      readonly key: unknown;
      readonly encodedKey: unknown;
    },
  ): Promise<RemoteAuthorizationDecision> {
    if (definition.remoteIntent) {
      return definition.remoteIntent.authorizeSubscribe(context);
    }
    try {
      await definition.remote.authorizeSubscribe({
        sender: context.sender,
        key: context.key,
      });
      return { kind: "allow" };
    } catch (error) {
      if (isDyadError(error) && error.kind === DyadErrorKind.Auth) {
        return { kind: "deny", error };
      }
      throw error;
    }
  }

  private async authorizeDispatch(
    definition: AnyRemoteMachineDefinition,
    context: {
      readonly sender: RemoteMachineSender & {
        readonly windowSessionId: string;
      };
      readonly key: unknown;
      readonly intent: { readonly type: string };
      readonly currentState: unknown;
      readonly actor: ActorRuntimeMetadata;
      readonly expectedObservedRevision?: number;
    },
  ): Promise<RemoteAuthorizationDecision> {
    if (definition.remoteIntent) {
      return definition.remoteIntent.authorizeDispatch(context);
    }
    try {
      await definition.remote.authorizeDispatch({
        sender: context.sender,
        key: context.key,
        event: context.intent,
        currentState: context.currentState,
      });
      return { kind: "allow" };
    } catch (error) {
      if (isDyadError(error) && error.kind === DyadErrorKind.Auth) {
        return { kind: "deny", error };
      }
      throw error;
    }
  }

  private toInternalEvent(
    definition: AnyRemoteMachineDefinition,
    key: unknown,
    intent: { readonly type: string },
    windowSessionId: string,
  ): unknown {
    if (!definition.remoteIntent) return intent;
    const event = definition.remoteIntent.toInternalEvent({
      key,
      intent,
      sender: { windowSessionId },
    });
    if (
      typeof intent === "object" &&
      intent !== null &&
      Object.is(event, intent)
    ) {
      throw new Error(
        `Remote intent conversion for ${definition.id} reused renderer data`,
      );
    }
    return event;
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

  private assertOpen(): void {
    if (!this.disposed) return;
    throw new DyadError(
      "Remote machine transport is disposed",
      DyadErrorKind.Precondition,
    );
  }

  private beginPendingSubscription(
    webContentsId: number,
    address: string,
    countsTowardLimit: boolean,
    machineId: string,
  ): PendingSubscription {
    const currentReferences = this.referencesPerWindow.get(webContentsId) ?? 0;
    const pendingReferences =
      this.pendingReferencesPerWindow.get(webContentsId) ?? 0;
    if (
      countsTowardLimit &&
      currentReferences + pendingReferences >= this.maxSubscriptionsPerWindow
    ) {
      throw new DyadError(
        "Remote machine subscription limit exceeded",
        DyadErrorKind.RateLimited,
      );
    }
    const subscription: PendingSubscription = {
      address,
      webContentsId,
      countsTowardLimit,
      lifecycleGeneration:
        this.options.host.captureAdmissionGeneration(machineId),
      cancelled: false,
      accountingReleased: false,
    };
    const pendingKey = this.pendingSubscriptionKey(webContentsId, address);
    this.pendingSubscriptions.set(pendingKey, subscription);
    if (countsTowardLimit) {
      this.pendingReferencesPerWindow.set(webContentsId, pendingReferences + 1);
    }
    return subscription;
  }

  private finishPendingSubscription(subscription: PendingSubscription): void {
    this.releasePendingSubscriptionAccounting(subscription);
  }

  private cancelPendingSubscriptions(
    webContentsId: number,
    address: string,
  ): void {
    const pending = this.pendingSubscriptions.get(
      this.pendingSubscriptionKey(webContentsId, address),
    );
    if (!pending) return;
    this.cancelPendingSubscription(pending);
  }

  private cancelPendingSubscriptionsForAddress(address: string): void {
    for (const pending of this.pendingSubscriptions.values()) {
      if (pending.address === address) this.cancelPendingSubscription(pending);
    }
  }

  private cancelPendingSubscription(subscription: PendingSubscription): void {
    subscription.cancelled = true;
    this.releasePendingSubscriptionAccounting(subscription);
  }

  private releasePendingSubscriptionAccounting(
    subscription: PendingSubscription,
  ): void {
    if (subscription.accountingReleased) return;
    subscription.accountingReleased = true;
    const pendingKey = this.pendingSubscriptionKey(
      subscription.webContentsId,
      subscription.address,
    );
    if (this.pendingSubscriptions.get(pendingKey) === subscription) {
      this.pendingSubscriptions.delete(pendingKey);
    }
    if (subscription.countsTowardLimit) {
      this.decrementPendingWindowReferences(subscription.webContentsId);
    }
  }

  private pendingSubscriptionKey(
    webContentsId: number,
    address: string,
  ): string {
    return `${webContentsId}\0${address}`;
  }

  private decrementPendingWindowReferences(webContentsId: number): void {
    const next = (this.pendingReferencesPerWindow.get(webContentsId) ?? 0) - 1;
    if (next > 0) {
      this.pendingReferencesPerWindow.set(webContentsId, next);
    } else {
      this.pendingReferencesPerWindow.delete(webContentsId);
    }
  }

  private isWithinSerializedLimit(value: unknown, limit: number): boolean {
    try {
      return this.measureSerializedBytes(value) <= limit;
    } catch {
      return false;
    }
  }

  private assertAddressWithinLimit(address: MachineAddress): void {
    if (this.isWithinSerializedLimit(address, this.maxAddressEnvelopeBytes)) {
      return;
    }
    throw new DyadError(
      "Remote machine address exceeds the transport limit",
      DyadErrorKind.Validation,
    );
  }
}
