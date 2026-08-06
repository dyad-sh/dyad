import { createHash } from "node:crypto";
import { serialize } from "node:v8";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type { Clock } from "@/state_machines/clock";
import type { InvocationRef } from "@/state_machines/invocation_ref";
import { PendingReceiptLedger } from "@/state_machines/pending_receipt_ledger";
import type { WindowSessionId } from "@/window_infrastructure/types";
import {
  ActorAdmissionError,
  type ActorHost,
  type ActorHostAdmissionGeneration,
} from "./actor_host";
import type {
  ActorRuntimeMetadata,
  HostedActorRef,
  RemoteOperationContract,
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
  type MachineOperationOutcomeEnvelope,
  type MachineRejectedReason,
  type MachineSnapshotEnvelope,
} from "./remote_protocol";
import type {
  RequestId,
  RequestIdempotencyKey,
  RequestMessageId,
} from "./request_identity";
import type { RemoteAuthorizationDecision } from "./remote_intent_contract";
import {
  finalizeOperationAdmission,
  type OperationRegistry,
} from "./operation_registry";

export interface RemoteTransportEndpoint {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  once?(event: "destroyed", listener: () => void): this | void;
}

export type RendererConnectionId = string;

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
  // A WebContents survives navigation, so ownership is fenced by the
  // renderer-side connection lifetime rather than WebContents ID alone.
  readonly windows: Map<number, RendererConnectionId>;
  unsubscribeActor: () => void;
}

interface PreparedDispatchIdentity {
  readonly definition: AnyRemoteMachineDefinition;
  readonly key: unknown;
  readonly intent: { readonly type: string };
  readonly encodedKey: unknown;
  readonly address: string;
  readonly admittedEntry: SubscriptionEntry;
  readonly actor: HostedActorRef<unknown, unknown, string>;
  readonly actorMetadata: ActorRuntimeMetadata;
  readonly lifecycleGeneration: ActorHostAdmissionGeneration;
  readonly windowSessionId: WindowSessionId;
  readonly rendererConnectionId: RendererConnectionId;
  readonly fingerprint: string;
  consumed: boolean;
}

interface PendingSubscription {
  readonly address: string;
  readonly webContentsId: number;
  readonly rendererConnectionId: RendererConnectionId;
  readonly countsTowardLimit: boolean;
  readonly lifecycleGeneration: ActorHostAdmissionGeneration;
  cancelled: boolean;
  accountingReleased: boolean;
  promise?: Promise<MachineSnapshotEnvelope>;
}

interface PreparedSubscribe {
  readonly definition: AnyRemoteMachineDefinition;
  readonly decodedKey: unknown;
  readonly encodedKey: unknown;
  readonly address: string;
  readonly domainAddress: string;
  readonly windowSessionId: WindowSessionId;
  readonly rendererConnectionId: RendererConnectionId;
  readonly pending: PendingSubscription;
  consumed: boolean;
}

const DEFAULT_DEDUPLICATION_RETENTION_MS = 60_000;
const DEFAULT_MAX_DEDUPLICATION_ENTRIES = 1_024;
const DEFAULT_MAX_SUBSCRIPTIONS_PER_WINDOW = 256;
const DEFAULT_MAX_ADDRESS_ENVELOPE_BYTES = 64 * 1_024;
const DEFAULT_MAX_DISPATCH_ENVELOPE_BYTES = 256 * 1_024;
const DEFAULT_MAX_SNAPSHOT_ENVELOPE_BYTES = 1_024 * 1_024;
const MAX_LEGACY_AUTHORIZATION_STABILIZATION_ATTEMPTS = 3;

function deepFreezePreparedValue<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype &&
    prototype !== Array.prototype &&
    prototype !== null
  ) {
    throw new Error("Remote prepared values must use plain immutable data");
  }
  seen.add(value);
  for (const nested of Reflect.ownKeys(value).map(
    (key) => (value as Record<PropertyKey, unknown>)[key],
  )) {
    deepFreezePreparedValue(nested, seen);
  }
  return Object.freeze(value);
}

function immutablePreparedClone<T>(value: T): T {
  return deepFreezePreparedValue(structuredClone(value));
}

export class RemoteMachineTransport {
  private readonly subscriptions = new Map<string, SubscriptionEntry>();
  private readonly actorKeys = new Map<string, unknown>();
  private readonly referencesPerWindow = new Map<number, number>();
  private readonly pendingSubscriptions = new Map<
    string,
    PendingSubscription
  >();
  private readonly pendingReferencesPerWindow = new Map<number, number>();
  private readonly windowSessions = new Map<number, WindowSessionId>();
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
    rendererConnectionId: RendererConnectionId = this.legacyRendererConnectionId(
      sender,
    ),
  ): Promise<MachineSnapshotEnvelope> {
    this.assertOpen();
    this.assertAddressWithinLimit(input);
    const windowSessionId = this.options.windows.ensureRegistered(sender);
    this.windowSessions.set(sender.id, windowSessionId);
    const definition = this.requireDefinition(input.machineId);
    this.assertProtocol(sender, definition, input.protocolVersion);
    const key = this.decodeKey(definition, input.encodedKey);
    const encodedKey = this.encodeKey(definition, key);
    const address = this.wireAddress(definition, encodedKey);
    const existingBeforeAuthorization = this.subscriptions.get(address);
    const pendingKey = this.pendingSubscriptionKey(
      sender.id,
      rendererConnectionId,
      address,
    );
    const existingPending = this.pendingSubscriptions.get(pendingKey);
    if (existingPending?.promise) return existingPending.promise;
    this.cancelSupersededPendingSubscriptions(
      sender.id,
      rendererConnectionId,
      address,
    );
    const pending = this.beginPendingSubscription(
      sender.id,
      rendererConnectionId,
      address,
      !existingBeforeAuthorization?.windows.has(sender.id),
      definition.id,
      key,
    );
    const prepared: PreparedSubscribe = {
      definition,
      decodedKey: key,
      encodedKey,
      address,
      domainAddress: this.domainAddress(definition, key),
      windowSessionId,
      rendererConnectionId,
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
    const senderContext = this.senderContext(sender, prepared.windowSessionId);
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
      if (
        this.domainAddress(definition, authorizedKey) !== prepared.domainAddress
      ) {
        throw new DyadError(
          "Remote machine key changed during subscription authorization",
          DyadErrorKind.Precondition,
        );
      }
      if (
        !serialize(canonicalEncodedKey).equals(serialize(prepared.encodedKey))
      ) {
        throw new DyadError(
          "Remote machine wire address changed during subscription authorization",
          DyadErrorKind.Precondition,
        );
      }
      const canonicalKey = this.actorKeys.get(address) ?? authorizedKey;
      const currentReferences = this.referencesPerWindow.get(sender.id) ?? 0;
      let entry = this.subscriptions.get(address);
      const subscribedConnectionId = entry?.windows.get(sender.id);
      const alreadySubscribed =
        subscribedConnectionId === prepared.rendererConnectionId;
      const alreadyHasWindowReference = subscribedConnectionId !== undefined;
      if (
        !alreadyHasWindowReference &&
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
      let admittedActor: HostedActorRef<unknown, unknown, string> | undefined;
      if (!alreadySubscribed) {
        try {
          admittedActor = this.options.host.localRefCaptured(
            definition,
            canonicalKey,
            pending.lifecycleGeneration,
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
        if (entry && admittedActor !== entry.actor) {
          throw new DyadError(
            "Remote machine actor changed during subscription admission",
            DyadErrorKind.Precondition,
          );
        }
      }
      prepared.consumed = true;

      if (!entry) {
        if (!admittedActor) {
          throw new DyadError(
            "Remote machine subscription admission was not retained",
            DyadErrorKind.Precondition,
          );
        }
        this.actorKeys.set(address, canonicalKey);
        entry = {
          address,
          definition,
          key: canonicalKey,
          encodedKey: canonicalEncodedKey,
          actor: admittedActor,
          windows: new Map(),
          unsubscribeActor: () => undefined,
        };
        this.subscriptions.set(address, entry);
        entry.unsubscribeActor = admittedActor.subscribe(() =>
          this.broadcastSnapshot(entry!),
        );
      }

      if (!alreadySubscribed) {
        entry.windows.set(sender.id, prepared.rendererConnectionId);
        if (!alreadyHasWindowReference) {
          this.referencesPerWindow.set(sender.id, currentReferences + 1);
        }
      }

      // Atomic bootstrap invariant: there is deliberately no await between
      // subscriber registration above and this snapshot capture.
      try {
        return this.snapshotEnvelope(entry);
      } catch (error) {
        if (!alreadySubscribed) {
          if (subscribedConnectionId !== undefined) {
            entry.windows.set(sender.id, subscribedConnectionId);
          } else {
            this.removeWindowReference(
              entry,
              sender.id,
              prepared.rendererConnectionId,
            );
          }
        }
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
        this.pendingSubscriptionKey(
          sender.id,
          prepared.rendererConnectionId,
          prepared.address,
        ),
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
        prepared.decodedKey,
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
    rendererConnectionId: RendererConnectionId = this.legacyRendererConnectionId(
      sender,
    ),
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
    this.cancelPendingSubscriptions(sender.id, rendererConnectionId, address);
    const entry = this.subscriptions.get(address);
    if (!entry) return;
    this.removeWindowReference(entry, sender.id, rendererConnectionId);
  }

  dispatch(
    sender: RemoteTransportEndpoint,
    envelope: MachineDispatchEnvelope,
    rendererConnectionId: RendererConnectionId = this.legacyRendererConnectionId(
      sender,
    ),
  ): Promise<MachineDispatchReceipt> {
    this.assertOpen();
    const windowSessionId = this.options.windows.ensureRegistered(sender);
    this.windowSessions.set(sender.id, windowSessionId);
    const dispatchDefinition = this.options.manifest.get(envelope.machineId);
    const nativeDispatchLimit =
      dispatchDefinition?.remoteIntent?.budgets.intentBytes;
    const dispatchLimit =
      nativeDispatchLimit === undefined
        ? (dispatchDefinition?.remote.maxDispatchEnvelopeBytes ??
          this.maxDispatchEnvelopeBytes)
        : nativeDispatchLimit;
    if (!this.isWithinSerializedLimit(envelope, dispatchLimit)) {
      return Promise.resolve(
        this.rejected(envelope.messageId, "invalid-event"),
      );
    }
    const prepared = this.prepareDispatchIdentity(
      sender,
      windowSessionId,
      rendererConnectionId,
      envelope,
    );
    if ("receipt" in prepared) {
      if (
        prepared.fingerprint !== undefined &&
        this.receiptLedger.hasReceipt(windowSessionId, envelope.messageId)
      ) {
        const replay = this.receiptLedger.claim({
          scope: windowSessionId,
          messageId: envelope.messageId,
          fingerprint: prepared.fingerprint,
          start: () => prepared.receipt,
          retention: () => "remove",
        });
        if (replay.kind === "duplicate") return replay.receipt;
        if (replay.kind === "conflict") {
          return Promise.resolve(
            this.rejected(envelope.messageId, "invalid-event"),
          );
        }
        if (replay.kind === "fresh") return replay.receipt;
        if (replay.kind === "disposed") {
          return Promise.resolve(
            this.rejected(envelope.messageId, "host-disposing"),
          );
        }
      }
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
      start: () => this.dispatchOnce(sender, envelope, prepared),
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
      totalReferences: entry.windows.size,
      windows: new Map([...entry.windows.keys()].map((id) => [id, 1])),
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
    for (const definition of this.options.manifest.definitions) {
      const operation = definition.remoteOperation as
        | RemoteOperationContract<
            unknown,
            unknown,
            unknown,
            unknown,
            InvocationRef
          >
        | undefined;
      operation?.releaseManager?.();
    }
    for (const entry of this.subscriptions.values()) entry.unsubscribeActor();
    this.subscriptions.clear();
    this.actorKeys.clear();
    this.referencesPerWindow.clear();
    this.pendingReferencesPerWindow.clear();
    this.windowSessions.clear();
    this.receiptLedger.dispose();
  }

  private prepareDispatchIdentity(
    sender: RemoteTransportEndpoint,
    windowSessionId: WindowSessionId,
    rendererConnectionId: RendererConnectionId,
    envelope: MachineDispatchEnvelope,
  ):
    | PreparedDispatchIdentity
    | {
        readonly receipt: MachineDispatchReceipt;
        readonly fingerprint?: string;
      } {
    const definition = this.options.manifest.get(envelope.machineId);
    if (!definition) {
      return { receipt: this.rejected(envelope.messageId, "unknown-machine") };
    }
    if (envelope.protocolVersion !== definition.remote.protocolVersion) {
      this.noteProtocolMismatch(sender, definition, envelope.protocolVersion);
      return { receipt: this.rejected(envelope.messageId, "protocol-version") };
    }
    const keyResult = this.keyCodec(definition).safeParse(envelope.encodedKey);
    if (!keyResult.success) {
      return { receipt: this.rejected(envelope.messageId, "invalid-key") };
    }
    const intentResult = this.rendererIntentCodec(definition).safeParse(
      envelope.encodedEvent,
    );
    if (!intentResult.success) {
      return { receipt: this.rejected(envelope.messageId, "invalid-event") };
    }
    const intent = (
      definition.remoteIntent
        ? immutablePreparedClone(intentResult.data)
        : intentResult.data
    ) as { readonly type: string };
    const encodedKey = this.encodeKey(definition, keyResult.data);
    const address = this.wireAddress(definition, encodedKey);
    const fingerprint = this.dispatchFingerprint(
      definition,
      encodedKey,
      intent,
      envelope,
    );
    const admittedEntry = this.subscriptions.get(address);
    if (
      !admittedEntry ||
      admittedEntry.windows.get(sender.id) !== rendererConnectionId
    ) {
      return {
        receipt: this.rejected(envelope.messageId, "stale-actor"),
        fingerprint,
      };
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
      return {
        receipt: this.rejected(envelope.messageId, "stale-actor"),
        fingerprint,
      };
    }
    const actorMetadata = actor.getMetadata();
    if (
      envelope.expectedActorInstanceId !== undefined &&
      envelope.expectedActorInstanceId !== actorMetadata.actorInstanceId
    ) {
      return {
        receipt: this.rejected(envelope.messageId, "stale-actor"),
        fingerprint,
      };
    }
    const revisionPolicy =
      definition.remoteIntent?.intents[intent.type]?.observedRevision;
    if (
      revisionPolicy?.kind === "actor" &&
      (envelope.expectedActorInstanceId === undefined ||
        envelope.expectedRevision === undefined)
    ) {
      return {
        receipt: this.rejected(envelope.messageId, "revision-conflict"),
      };
    }
    if (
      revisionPolicy?.kind === "domain" &&
      envelope.expectedRevision === undefined
    ) {
      return {
        receipt: this.rejected(envelope.messageId, "revision-conflict"),
      };
    }
    return {
      definition,
      key: admittedEntry.key,
      intent,
      encodedKey,
      address,
      admittedEntry,
      actor,
      actorMetadata,
      lifecycleGeneration: this.options.host.captureAdmissionGeneration(
        definition.id,
        admittedEntry.key,
      ),
      windowSessionId,
      rendererConnectionId,
      fingerprint,
      consumed: false,
    };
  }

  private async dispatchOnce(
    sender: RemoteTransportEndpoint,
    envelope: MachineDispatchEnvelope,
    prepared: PreparedDispatchIdentity,
  ): Promise<MachineDispatchReceipt> {
    const { definition, key, intent, address, actor, actorMetadata } = prepared;
    const senderContext = this.senderContext(sender, prepared.windowSessionId);
    let event: unknown;
    let dispatchActorMetadata = actorMetadata;
    if (!definition.remoteIntent) {
      let stabilized = false;
      for (
        let attempt = 0;
        attempt < MAX_LEGACY_AUTHORIZATION_STABILIZATION_ATTEMPTS;
        attempt += 1
      ) {
        const authorizedMetadata = actor.getMetadata();
        const decision = await this.authorizeDispatch(definition, {
          sender: senderContext,
          key,
          intent,
          currentState: actor.getSnapshot(),
          actor: authorizedMetadata,
          expectedObservedRevision: envelope.expectedRevision,
        });
        if (decision.kind === "deny") {
          return this.rejected(envelope.messageId, "unauthorized");
        }
        if (
          this.disposed ||
          !this.isCurrentSender(sender, prepared.windowSessionId)
        ) {
          return this.rejected(envelope.messageId, "host-disposing");
        }
        if (
          this.subscriptions.get(address) !== prepared.admittedEntry ||
          prepared.admittedEntry.windows.get(sender.id) !==
            prepared.rendererConnectionId ||
          this.options.host.peek(definition.id, key) !== actor
        ) {
          return this.rejected(envelope.messageId, "stale-actor");
        }
        if (
          !this.options.host.isAdmissionGenerationCurrent(
            definition.id,
            key,
            prepared.lifecycleGeneration,
          )
        ) {
          return this.rejected(envelope.messageId, "host-disposing");
        }
        const currentMetadata = actor.getMetadata();
        if (
          currentMetadata.actorInstanceId ===
            authorizedMetadata.actorInstanceId &&
          currentMetadata.snapshotRevision ===
            authorizedMetadata.snapshotRevision
        ) {
          dispatchActorMetadata = currentMetadata;
          stabilized = true;
          break;
        }
      }
      if (!stabilized) {
        return this.rejected(envelope.messageId, "revision-conflict");
      }
      const revisionPolicy = definition.remote.revisionPolicy(intent as never);
      if (
        revisionPolicy === "reject-stale" &&
        (envelope.expectedRevision === undefined ||
          dispatchActorMetadata.snapshotRevision !== envelope.expectedRevision)
      ) {
        return this.rejected(envelope.messageId, "revision-conflict");
      }
      event = intent;
      const finalRefusal = this.revalidateLegacyPreparedDispatch(
        sender,
        prepared,
        dispatchActorMetadata,
      );
      if (finalRefusal) {
        return this.rejected(envelope.messageId, finalRefusal);
      }
    } else {
      const decision = await this.authorizeDispatch(definition, {
        sender: senderContext,
        key,
        intent,
        currentState: actor.getSnapshot(),
        actor: actorMetadata,
        expectedObservedRevision: envelope.expectedRevision,
      });
      if (decision.kind === "deny") {
        if (decision.error.kind !== DyadErrorKind.Auth) {
          throw decision.error;
        }
        return this.rejected(
          envelope.messageId,
          definition.remoteIntent.refusalMap.authorization,
        );
      }
      this.assertPreparedDispatchContent(prepared, envelope);
      const preConversionRefusal = this.revalidatePreparedDispatch(
        sender,
        envelope,
        prepared,
      );
      if (preConversionRefusal) {
        return this.rejected(envelope.messageId, preConversionRefusal);
      }
      const requestIdentity = this.requestIdentityFor(
        definition,
        intent,
        envelope,
        senderContext.windowSessionId,
      );
      event = this.toInternalEvent(
        definition,
        key,
        intent,
        senderContext.windowSessionId,
        requestIdentity,
      );
      this.assertPreparedDispatchContent(prepared, envelope);
      const finalRefusal = this.revalidatePreparedDispatch(
        sender,
        envelope,
        prepared,
      );
      if (finalRefusal) {
        return this.rejected(envelope.messageId, finalRefusal);
      }
      if (definition.remoteIntent.finalizeOperation && requestIdentity) {
        let admitted;
        try {
          admitted = definition.remoteIntent.finalizeOperation(
            {
              key,
              intent,
              event,
              currentState: actor.getSnapshot(),
              actor: dispatchActorMetadata,
              sender: { windowSessionId: senderContext.windowSessionId },
              requestIdentity,
              fingerprint: prepared.fingerprint,
            },
            {
              assertFinalAdmission: () => {
                this.assertPreparedDispatchContent(prepared, envelope);
                const refusal = this.revalidatePreparedDispatch(
                  sender,
                  envelope,
                  prepared,
                );
                if (refusal) {
                  throw new ActorAdmissionError(
                    refusal === "stale-actor"
                      ? "stale-actor-instance"
                      : refusal === "revision-conflict"
                        ? "stale-actor-revision"
                        : "stale-admission-generation",
                    `Remote operation admission was refused: ${refusal}`,
                  );
                }
              },
              enqueue: () =>
                this.options.host.dispatchCaptured(
                  definition,
                  key,
                  event,
                  prepared.lifecycleGeneration,
                  dispatchActorMetadata,
                  {
                    messageId: envelope.messageId,
                    correlationId: envelope.correlationId,
                    causationId: envelope.causationId,
                  },
                ),
            },
          );
        } catch (error) {
          if (!(error instanceof ActorAdmissionError)) throw error;
          prepared.consumed = true;
          return this.rejected(
            envelope.messageId,
            error.code === "stale-actor-instance"
              ? "stale-actor"
              : error.code === "stale-actor-revision"
                ? "revision-conflict"
                : "host-disposing",
          );
        }
        prepared.consumed = true;
        void admitted.operation.settled.then(
          (settlement: {
            readonly invocationRef: unknown;
            readonly outcome: unknown;
            readonly receipt: {
              readonly actor: ActorRuntimeMetadata;
            };
          }) => {
            try {
              if (
                this.options.windows.sessionForWebContents(sender.id) !==
                senderContext.windowSessionId
              ) {
                return;
              }
              const codecs = definition.remoteIntent?.operationOutcome;
              if (!codecs) {
                throw new Error(
                  `Remote machine ${definition.id} does not declare operation outcome codecs`,
                );
              }
              const invocationRef = codecs.invocationRefCodec.parse(
                settlement.invocationRef,
              );
              const outcome = codecs.outcomeCodec.parse(settlement.outcome);
              const outcomeEnvelope: MachineOperationOutcomeEnvelope = {
                protocolVersion: definition.remote.protocolVersion,
                machineId: definition.id,
                encodedKey: prepared.encodedKey,
                requestId: requestIdentity.requestId,
                invocationRef,
                outcome,
                actor: settlement.receipt.actor,
              };
              if (
                !this.isWithinSerializedLimit(
                  outcomeEnvelope,
                  codecs.maxEnvelopeBytes,
                )
              ) {
                throw new DyadError(
                  `Remote operation outcome exceeds the transport limit for ${definition.id}`,
                  DyadErrorKind.RateLimited,
                );
              }
              this.send(
                sender.id,
                "distributed-machine:operation-outcome",
                outcomeEnvelope,
              );
            } catch (error) {
              this.options.onError?.(error);
            }
          },
          (error: unknown) => this.options.onError?.(error),
        );
        if (admitted.disposition !== "fresh") {
          return {
            kind: "applied",
            actorInstanceId: dispatchActorMetadata.actorInstanceId,
            revision: dispatchActorMetadata.snapshotRevision,
            transactionSequence: dispatchActorMetadata.transactionSequence,
            messageId: envelope.messageId,
          };
        }
        return this.receiptFromDispatchTicket(
          definition,
          key,
          address,
          envelope.messageId,
          admitted.enqueueResult,
          admitted.rollbackAdmission,
        );
      }
    }
    const enqueue = () =>
      this.options.host.dispatchCaptured(
        definition,
        key,
        event,
        prepared.lifecycleGeneration,
        dispatchActorMetadata,
        {
          messageId: envelope.messageId,
          correlationId: envelope.correlationId,
          causationId: envelope.causationId,
        },
      );
    const remoteOperation = definition.remoteOperation as
      | RemoteOperationContract<
          unknown,
          unknown,
          unknown,
          unknown,
          InvocationRef
        >
      | undefined;
    const operationPreparation = remoteOperation?.prepare({
      key,
      intent,
      event,
      sender: { windowSessionId: prepared.windowSessionId },
      actor: dispatchActorMetadata,
      hostId: "main",
      fingerprint: prepared.fingerprint,
    });
    let ticket;
    let operationInvocationRef: InvocationRef | undefined;
    let freshOperation:
      | {
          readonly registry: OperationRegistry<unknown, InvocationRef>;
          readonly requestId: RequestId;
          readonly invocationRef: InvocationRef;
        }
      | undefined;
    if (operationPreparation) {
      const operationAdmission = finalizeOperationAdmission({
        registry: operationPreparation.registry as OperationRegistry<
          unknown,
          InvocationRef
        >,
        identity: operationPreparation.identity,
        createInvocationRef: operationPreparation.createInvocationRef,
        assertFinalAdmission: () => {
          const refusal = definition.remoteIntent
            ? this.revalidatePreparedDispatch(sender, envelope, prepared)
            : this.revalidateLegacyPreparedDispatch(
                sender,
                prepared,
                dispatchActorMetadata,
              );
          if (refusal) {
            throw new ActorAdmissionError(
              refusal === "stale-actor"
                ? "stale-actor-instance"
                : refusal === "revision-conflict"
                  ? "stale-actor-revision"
                  : "key-fenced",
              `Prepared operation admission was refused: ${refusal}`,
            );
          }
        },
        enqueue,
        receiptOnEnqueueFailure: () =>
          remoteOperation!.receipt(dispatchActorMetadata),
      });
      operationInvocationRef = operationAdmission.operation.invocationRef;
      if (operationAdmission.kind !== "enqueued") {
        prepared.consumed = true;
        return {
          kind: "applied",
          actorInstanceId: dispatchActorMetadata.actorInstanceId,
          revision: dispatchActorMetadata.snapshotRevision,
          transactionSequence: dispatchActorMetadata.transactionSequence,
          messageId: envelope.messageId,
        };
      }
      freshOperation = {
        registry: operationPreparation.registry as OperationRegistry<
          unknown,
          InvocationRef
        >,
        requestId: operationPreparation.identity.requestId,
        invocationRef: operationAdmission.operation.invocationRef,
      };
      ticket = operationAdmission.enqueueResult;
    } else {
      ticket = enqueue();
    }
    prepared.consumed = true;
    const dispatchedActor = this.options.host.peek<unknown, unknown, string>(
      definition.id,
      key,
    );
    const outcome = await ticket.settled;
    if (outcome.kind === "failed") {
      freshOperation?.registry.rollbackAdmission(
        freshOperation.requestId,
        freshOperation.invocationRef,
        outcome.error,
      );
      if (outcome.error instanceof ActorAdmissionError) {
        if (outcome.error.code === "stale-actor-instance") {
          return this.rejected(envelope.messageId, "stale-actor");
        }
        if (outcome.error.code === "stale-actor-revision") {
          return this.rejected(
            envelope.messageId,
            definition.remoteIntent?.refusalMap.revisionChanged ??
              "revision-conflict",
          );
        }
        return this.rejected(envelope.messageId, "host-disposing");
      }
      throw outcome.error;
    }
    if (outcome.kind === "disposed" || !dispatchedActor) {
      freshOperation?.registry.rollbackAdmission(
        freshOperation.requestId,
        freshOperation.invocationRef,
        new ActorAdmissionError(
          "actor-disposing",
          "Actor disposed before authoritative operation admission completed",
        ),
      );
      this.actorKeys.delete(address);
      return this.rejected(envelope.messageId, "host-disposing");
    }
    const metadata = ticket.getSettledMetadata();
    if (!metadata) {
      freshOperation?.registry.rollbackAdmission(
        freshOperation.requestId,
        freshOperation.invocationRef,
        new ActorAdmissionError(
          "actor-disposing",
          "Actor admission completed without settled metadata",
        ),
      );
      return this.rejected(envelope.messageId, "host-disposing");
    }
    if (outcome.kind === "ignored") {
      if (operationPreparation) {
        operationPreparation.registry.settle(
          operationPreparation.identity.requestId,
          operationInvocationRef!,
          remoteOperation!.ignoredOutcome(outcome.reason),
          remoteOperation!.receipt(metadata),
        );
      }
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

  private async receiptFromDispatchTicket(
    definition: AnyRemoteMachineDefinition,
    key: unknown,
    address: string,
    messageId: string,
    value: unknown,
    rollbackAdmission: (error: unknown) => void,
  ): Promise<MachineDispatchReceipt> {
    const ticket = value as {
      readonly settled: Promise<
        | { readonly kind: "applied" }
        | { readonly kind: "ignored"; readonly reason: unknown }
        | { readonly kind: "disposed" }
        | { readonly kind: "failed"; readonly error: unknown }
      >;
      getSettledMetadata(): ActorRuntimeMetadata | undefined;
    };
    if (!ticket || typeof ticket !== "object" || !("settled" in ticket)) {
      throw new Error(
        "Remote operation admission did not return a dispatch ticket",
      );
    }
    const dispatchedActor = this.options.host.peek<unknown, unknown, string>(
      definition.id,
      key,
    );
    const outcome = await ticket.settled;
    if (outcome.kind === "failed") {
      rollbackAdmission(outcome.error);
      if (outcome.error instanceof ActorAdmissionError) {
        if (outcome.error.code === "stale-actor-instance") {
          return this.rejected(messageId, "stale-actor");
        }
        if (outcome.error.code === "stale-actor-revision") {
          return this.rejected(
            messageId,
            definition.remoteIntent?.refusalMap.revisionChanged ??
              "revision-conflict",
          );
        }
        return this.rejected(messageId, "host-disposing");
      }
      throw outcome.error;
    }
    if (outcome.kind === "disposed" || !dispatchedActor) {
      rollbackAdmission(
        new ActorAdmissionError(
          "actor-disposing",
          "Actor disposed before authoritative operation admission completed",
        ),
      );
      this.actorKeys.delete(address);
      return this.rejected(messageId, "host-disposing");
    }
    const metadata = ticket.getSettledMetadata();
    if (!metadata) {
      rollbackAdmission(
        new ActorAdmissionError(
          "actor-disposing",
          "Actor admission completed without settled metadata",
        ),
      );
      return this.rejected(messageId, "host-disposing");
    }
    if (outcome.kind === "ignored") {
      rollbackAdmission(
        new ActorAdmissionError(
          "stale-actor-revision",
          `Actor ignored the correlated operation: ${outcome.reason}`,
        ),
      );
    }
    return outcome.kind === "ignored"
      ? {
          kind: "ignored",
          actorInstanceId: metadata.actorInstanceId,
          revision: metadata.snapshotRevision,
          transactionSequence: metadata.transactionSequence,
          messageId,
          reason: outcome.reason,
        }
      : {
          kind: "applied",
          actorInstanceId: metadata.actorInstanceId,
          revision: metadata.snapshotRevision,
          transactionSequence: metadata.transactionSequence,
          messageId,
        };
  }

  private requestIdentityFor(
    definition: AnyRemoteMachineDefinition,
    intent: { readonly type: string },
    envelope: MachineDispatchEnvelope,
    windowSessionId: string,
  ) {
    const policy = definition.remoteIntent?.intents[intent.type];
    if (policy?.completion !== "tracked-completion") return undefined;
    const legacyRequestId =
      "operationId" in intent && typeof intent.operationId === "string"
        ? intent.operationId
        : undefined;
    const requestId = envelope.correlationId ?? legacyRequestId;
    if (!requestId) return undefined;
    return Object.freeze({
      requestId: requestId as RequestId,
      messageId: envelope.messageId as RequestMessageId,
      idempotencyKey: (envelope.causationId ??
        envelope.messageId) as RequestIdempotencyKey,
      windowSessionId,
    });
  }

  private dispatchFingerprint(
    definition: AnyRemoteMachineDefinition,
    encodedKey: unknown,
    intent: { readonly type: string },
    envelope: MachineDispatchEnvelope,
  ): string {
    return createHash("sha256")
      .update(
        serialize([
          envelope.protocolVersion,
          definition.id,
          encodedKey,
          intent,
          envelope.expectedActorInstanceId,
          envelope.expectedRevision,
          envelope.correlationId,
          envelope.causationId,
        ]),
      )
      .digest("hex");
  }

  private assertPreparedDispatchContent(
    prepared: PreparedDispatchIdentity,
    envelope: MachineDispatchEnvelope,
  ): void {
    if (
      this.dispatchFingerprint(
        prepared.definition,
        prepared.encodedKey,
        prepared.intent,
        envelope,
      ) !== prepared.fingerprint
    ) {
      throw new Error(
        `Remote authorization mutated prepared intent for ${prepared.definition.id}`,
      );
    }
  }

  private revalidateLegacyPreparedDispatch(
    sender: RemoteTransportEndpoint,
    prepared: PreparedDispatchIdentity,
    stabilizedActorMetadata: ActorRuntimeMetadata,
  ): MachineRejectedReason | undefined {
    const { definition, address, admittedEntry, actor, key } = prepared;
    if (
      prepared.consumed ||
      this.disposed ||
      !this.isCurrentSender(sender, prepared.windowSessionId)
    ) {
      return "host-disposing";
    }
    if (
      this.subscriptions.get(address) !== admittedEntry ||
      admittedEntry.windows.get(sender.id) !== prepared.rendererConnectionId
    ) {
      return "stale-actor";
    }
    if (
      !this.options.host.isAdmissionGenerationCurrent(
        definition.id,
        key,
        prepared.lifecycleGeneration,
      )
    ) {
      return "host-disposing";
    }
    const current = this.options.host.peek<unknown, unknown, string>(
      definition.id,
      key,
    );
    if (!current || current !== actor) return "stale-actor";
    const currentMetadata = current.getMetadata();
    if (
      currentMetadata.actorInstanceId !==
        stabilizedActorMetadata.actorInstanceId ||
      currentMetadata.snapshotRevision !==
        stabilizedActorMetadata.snapshotRevision
    ) {
      return "revision-conflict";
    }
    return undefined;
  }

  private revalidatePreparedDispatch(
    sender: RemoteTransportEndpoint,
    envelope: MachineDispatchEnvelope,
    prepared: PreparedDispatchIdentity,
  ): MachineRejectedReason | undefined {
    const { definition, address, admittedEntry, actor, actorMetadata, key } =
      prepared;
    const refusalMap = definition.remoteIntent?.refusalMap;
    if (
      prepared.consumed ||
      this.disposed ||
      !this.isCurrentSender(sender, prepared.windowSessionId)
    ) {
      return refusalMap?.transportClosed ?? "host-disposing";
    }
    if (
      this.subscriptions.get(address) !== admittedEntry ||
      admittedEntry.windows.get(sender.id) !== prepared.rendererConnectionId
    ) {
      return refusalMap?.actorChanged ?? "stale-actor";
    }
    if (
      !this.options.host.isAdmissionGenerationCurrent(
        definition.id,
        key,
        prepared.lifecycleGeneration,
      )
    ) {
      return refusalMap?.transportClosed ?? "host-disposing";
    }
    const current = this.options.host.peek<unknown, unknown, string>(
      definition.id,
      key,
    );
    if (!current || current !== actor) {
      return refusalMap?.actorChanged ?? "stale-actor";
    }
    const currentMetadata = current.getMetadata();
    if (currentMetadata.actorInstanceId !== actorMetadata.actorInstanceId) {
      return refusalMap?.actorChanged ?? "stale-actor";
    }
    if (currentMetadata.snapshotRevision !== actorMetadata.snapshotRevision) {
      return refusalMap?.revisionChanged ?? "revision-conflict";
    }

    const observedRevision =
      definition.remoteIntent?.intents[prepared.intent.type]?.observedRevision;
    if (
      observedRevision?.kind === "actor" &&
      (envelope.expectedActorInstanceId !== actorMetadata.actorInstanceId ||
        envelope.expectedRevision !== actorMetadata.snapshotRevision)
    ) {
      return refusalMap?.revisionChanged ?? "revision-conflict";
    }
    if (observedRevision?.kind === "domain") {
      const currentDomainRevision =
        definition.remoteIntent?.resolveDomainRevision?.({
          name: observedRevision.name,
          key,
          intent: prepared.intent,
          currentState: current.getSnapshot(),
        });
      if (
        currentDomainRevision === undefined ||
        envelope.expectedRevision !== currentDomainRevision
      ) {
        return refusalMap?.revisionChanged ?? "revision-conflict";
      }
    }
    return undefined;
  }

  private snapshotEnvelope(entry: SubscriptionEntry): MachineSnapshotEnvelope {
    const metadata = entry.actor.getMetadata();
    const projected = entry.definition.remote.projectSnapshot(
      entry.actor.getSnapshot(),
      entry.key,
      metadata,
    );
    const parsed = (
      entry.definition.remoteIntent?.snapshotCodec ??
      entry.definition.remote.snapshotCodec
    ).safeParse(projected);
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
    const nativeSnapshotLimit =
      entry.definition.remoteIntent?.budgets.snapshotBytes;
    const snapshotLimit =
      nativeSnapshotLimit === undefined
        ? (entry.definition.remote.maxSnapshotEnvelopeBytes ??
          this.maxSnapshotEnvelopeBytes)
        : nativeSnapshotLimit;
    if (!this.isWithinSerializedLimit(envelope, snapshotLimit)) {
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
    const windowSessionId = this.windowSessions.get(webContentsId);
    this.windowSessions.delete(webContentsId);
    if (windowSessionId) {
      for (const definition of this.options.manifest.definitions) {
        definition.remoteIntent?.disposeWindowSession?.(windowSessionId);
      }
    }
    for (const pending of this.pendingSubscriptions.values()) {
      if (pending.webContentsId === webContentsId) {
        this.cancelPendingSubscription(pending);
      }
    }
    for (const entry of this.subscriptions.values()) {
      if (!entry.windows.has(webContentsId)) continue;
      entry.windows.delete(webContentsId);
      this.decrementWindowReferences(webContentsId, 1);
      this.releaseEntryIfUnused(entry);
    }
  }

  private removeWindowReference(
    entry: SubscriptionEntry,
    webContentsId: number,
    rendererConnectionId?: RendererConnectionId,
  ): void {
    const subscribedConnectionId = entry.windows.get(webContentsId);
    if (
      subscribedConnectionId === undefined ||
      (rendererConnectionId !== undefined &&
        subscribedConnectionId !== rendererConnectionId)
    ) {
      return;
    }
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
    for (const webContentsId of entry.windows.keys()) {
      this.decrementWindowReferences(webContentsId, 1);
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
    const parsed = this.keyCodec(definition).safeParse(encodedKey);
    if (!parsed.success) {
      throw new DyadError(
        "Invalid remote machine key",
        DyadErrorKind.Validation,
      );
    }
    return definition.remoteIntent
      ? immutablePreparedClone(parsed.data)
      : parsed.data;
  }

  private encodeKey(
    definition: AnyRemoteMachineDefinition,
    key: unknown,
  ): unknown {
    const keyContract = definition.remoteIntent ?? definition.remote;
    const encodedKey = keyContract.encodeKey(key);
    const roundTrip = keyContract.keyCodec.safeParse(encodedKey);
    if (
      !roundTrip.success ||
      this.domainAddress(definition, roundTrip.data) !==
        this.domainAddress(definition, key)
    ) {
      throw new Error(`Remote key encoding failed for ${definition.id}`);
    }
    return definition.remoteIntent
      ? immutablePreparedClone(encodedKey)
      : encodedKey;
  }

  private keyCodec(definition: AnyRemoteMachineDefinition) {
    return definition.remoteIntent?.keyCodec ?? definition.remote.keyCodec;
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
    const keyToString =
      definition.remoteIntent?.keyToString ?? definition.remote.keyToString;
    return `${definition.id}\0${keyToString(key)}`;
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
    capturedWindowSessionId?: WindowSessionId,
  ): RemoteMachineSender & { readonly windowSessionId: WindowSessionId } {
    const windowSessionId =
      capturedWindowSessionId ??
      this.options.windows.sessionForWebContents(sender.id);
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
    requestIdentity: ReturnType<RemoteMachineTransport["requestIdentityFor"]>,
  ): unknown {
    if (!definition.remoteIntent) return intent;
    const event = definition.remoteIntent.toInternalEvent({
      key,
      intent,
      sender: { windowSessionId },
      ...(requestIdentity ? { requestIdentity } : {}),
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
    return immutablePreparedClone(event);
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
    rendererConnectionId: RendererConnectionId,
    address: string,
    countsTowardLimit: boolean,
    machineId: string,
    key: unknown,
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
      rendererConnectionId,
      countsTowardLimit,
      lifecycleGeneration: this.options.host.captureAdmissionGeneration(
        machineId,
        key,
      ),
      cancelled: false,
      accountingReleased: false,
    };
    const pendingKey = this.pendingSubscriptionKey(
      webContentsId,
      rendererConnectionId,
      address,
    );
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
    rendererConnectionId: RendererConnectionId,
    address: string,
  ): void {
    const pending = this.pendingSubscriptions.get(
      this.pendingSubscriptionKey(webContentsId, rendererConnectionId, address),
    );
    if (!pending) return;
    this.cancelPendingSubscription(pending);
  }

  private cancelSupersededPendingSubscriptions(
    webContentsId: number,
    rendererConnectionId: RendererConnectionId,
    address: string,
  ): void {
    for (const pending of this.pendingSubscriptions.values()) {
      if (
        pending.webContentsId === webContentsId &&
        pending.address === address &&
        pending.rendererConnectionId !== rendererConnectionId
      ) {
        this.cancelPendingSubscription(pending);
      }
    }
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
      subscription.rendererConnectionId,
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
    rendererConnectionId: RendererConnectionId,
    address: string,
  ): string {
    return `${webContentsId}\0${rendererConnectionId}\0${address}`;
  }

  private legacyRendererConnectionId(
    sender: RemoteTransportEndpoint,
  ): RendererConnectionId {
    return `web-contents:${sender.id}`;
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
