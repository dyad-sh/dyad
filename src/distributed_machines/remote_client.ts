import type { IdSource } from "@/state_machines/clock";
import { SnapshotStore } from "@/state_machines/snapshot_store";
import type { IgnoreReason } from "@/state_machines/types";
import type { RemoteMachineContract } from "./definition";
import {
  MachineDispatchReceiptSchema,
  MachineDisposedEnvelopeSchema,
  MachineSnapshotEnvelopeSchema,
  type MachineAddress,
  type MachineDispatchEnvelope,
  type MachineDispatchReceipt,
  type MachineDisposedEnvelope,
  type MachineSnapshotEnvelope,
} from "./remote_protocol";

export type RemoteConnectionStatus =
  | "connecting"
  | "ready"
  | "disconnected"
  | "incompatible";

export type RemoteTransportStatus =
  | "connected"
  | "disconnected"
  | "incompatible";

export interface RemoteMachineClientConnection {
  getStatus(): RemoteTransportStatus;
  onStatusChange(listener: (status: RemoteTransportStatus) => void): () => void;
  onSnapshot(listener: (payload: unknown) => void): () => void;
  onDisposed(listener: (payload: unknown) => void): () => void;
  subscribe(address: MachineAddress): Promise<MachineSnapshotEnvelope>;
  unsubscribe(address: MachineAddress): Promise<void>;
  dispatch(envelope: MachineDispatchEnvelope): Promise<MachineDispatchReceipt>;
}

export class RemoteMachineTransportError extends Error {
  constructor(
    readonly code:
      | "disconnected"
      | "incompatible"
      | "renderer-destroyed"
      | "invalid-payload",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RemoteMachineTransportError";
  }
}

export interface RemoteActorView<State> {
  readonly state: State;
  readonly connection: RemoteConnectionStatus;
}

export interface RemoteMachineClientError {
  readonly stage: "subscriber";
  readonly error: unknown;
}

export interface RemoteActorRef<State, Event, Reason extends IgnoreReason> {
  readonly kind: "remote";
  getStatus(): RemoteConnectionStatus;
  getSnapshot(): State;
  getView(): RemoteActorView<State>;
  subscribe(listener: () => void): () => void;
  dispatch(event: Event): Promise<MachineDispatchReceipt<Reason>>;
  resync(): Promise<void>;
}

export type RemoteClientDefinition<
  Key,
  State,
  Event,
  Reason extends IgnoreReason,
> = {
  readonly id: string;
  readonly host: "main";
  readonly remote: Pick<
    RemoteMachineContract<Key, unknown, Event, State>,
    | "protocolVersion"
    | "keyCodec"
    | "encodeKey"
    | "eventCodec"
    | "snapshotCodec"
    | "keyToString"
    | "unavailableSnapshot"
  >;
  readonly reasonType?: Reason;
};

interface StoreMetadata {
  readonly actorInstanceId: string;
  readonly revision: number;
}

const MAX_BUFFERED_SNAPSHOTS = 16;

class RemoteSnapshotStore<
  Key,
  State,
  Event,
  Reason extends IgnoreReason,
> implements RemoteActorRef<State, Event, Reason> {
  readonly kind = "remote" as const;
  private readonly view: SnapshotStore<RemoteActorView<State>>;
  private readonly buffered: MachineSnapshotEnvelope[] = [];
  private readonly disposedActorIds = new Set<string>();
  private metadata?: StoreMetadata;
  private bootstrapped = false;
  private subscribers = 0;
  private transportSubscribed = false;
  private bootstrapGeneration = 0;
  private bootstrapAttempt?: {
    readonly generation: number;
    readonly isCurrent: () => boolean;
    readonly promise: Promise<void>;
  };
  private disposed = false;

  constructor(
    private readonly client: RemoteMachineClient,
    readonly definition: RemoteClientDefinition<Key, State, Event, Reason>,
    readonly key: Key,
    readonly address: MachineAddress,
    readonly addressKey: string,
  ) {
    this.view = new SnapshotStore({
      state: definition.remote.unavailableSnapshot(key),
      connection: client.connectionStatus(),
    });
  }

  getStatus = (): RemoteConnectionStatus => this.view.getSnapshot().connection;

  getSnapshot = (): State => this.view.getSnapshot().state;

  getView = (): RemoteActorView<State> => this.view.getSnapshot();

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    const unsubscribeView = this.view.subscribe(() => {
      try {
        listener();
      } catch (error) {
        this.client.reportSubscriberError(error);
      }
    });
    this.subscribers += 1;
    if (this.subscribers === 1) this.client.retain(this);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      unsubscribeView();
      this.subscribers -= 1;
      if (this.subscribers === 0) this.client.release(this);
    };
  };

  dispatch = (event: Event): Promise<MachineDispatchReceipt<Reason>> =>
    this.client.dispatch(this, event);

  resync = (): Promise<void> => {
    if (this.disposed) return Promise.resolve();
    return this.bootstrap();
  };

  hasSubscribers(): boolean {
    return this.subscribers > 0;
  }

  releaseInterest(): void {
    this.invalidateBootstrap();
    this.bootstrapped = false;
    this.buffered.splice(0);
    this.metadata = undefined;
    this.transportSubscribed = false;
    this.setView(
      this.definition.remote.unavailableSnapshot(this.key),
      "connecting",
    );
  }

  currentMetadata(): StoreMetadata | undefined {
    return this.metadata;
  }

  setTransportStatus(status: RemoteTransportStatus): void {
    if (status === "connected") {
      this.setConnection("connecting");
      return;
    }
    this.invalidateBootstrap();
    this.bootstrapped = false;
    this.buffered.splice(0);
    this.metadata = undefined;
    this.transportSubscribed = false;
    this.setView(
      this.definition.remote.unavailableSnapshot(this.key),
      status === "incompatible" ? "incompatible" : "disconnected",
    );
  }

  replaceTransport(status: RemoteTransportStatus): void {
    this.invalidateBootstrap();
    this.bootstrapped = false;
    this.buffered.splice(0);
    this.metadata = undefined;
    this.transportSubscribed = false;
    this.setView(
      this.definition.remote.unavailableSnapshot(this.key),
      status === "connected"
        ? "connecting"
        : status === "incompatible"
          ? "incompatible"
          : "disconnected",
    );
  }

  bootstrap(): Promise<void> {
    if (!this.hasSubscribers() || !this.client.isConnected()) {
      return Promise.resolve();
    }
    const active = this.bootstrapAttempt;
    if (active?.isCurrent()) {
      if (active.generation === this.bootstrapGeneration) {
        return active.promise;
      }
      return active.promise.catch(() => undefined).then(() => this.bootstrap());
    }
    const generation = ++this.bootstrapGeneration;
    const subscription = this.client.beginSubscription(this.address);
    const previouslySubscribed = this.transportSubscribed;
    this.bootstrapped = false;
    this.setConnection("connecting");
    const run = async (): Promise<void> => {
      try {
        const payload = await subscription.bootstrap;
        if (generation !== this.bootstrapGeneration || !this.hasSubscribers()) {
          if (!subscription.isCurrent() || !this.hasSubscribers()) {
            await subscription.release().catch(() => undefined);
            if (subscription.isCurrent()) this.transportSubscribed = false;
          } else {
            this.transportSubscribed = true;
          }
          return;
        }
        this.applyBootstrap(this.validateSnapshot(payload));
        this.transportSubscribed = true;
      } catch (error) {
        if (generation !== this.bootstrapGeneration) {
          if (!subscription.isCurrent() || !this.hasSubscribers()) {
            await subscription.release().catch(() => undefined);
          }
          return;
        }
        if (!previouslySubscribed) {
          await subscription.release().catch(() => undefined);
          if (subscription.isCurrent()) this.transportSubscribed = false;
        }
        if (this.client.isProtocolError(error)) {
          this.client.markIncompatible(error);
        } else if (!this.client.isConnected()) {
          this.setTransportStatus("disconnected");
        } else {
          this.bootstrapped = false;
          this.setView(
            this.definition.remote.unavailableSnapshot(this.key),
            "disconnected",
          );
        }
        throw error;
      }
    };
    const promise = run().finally(() => {
      if (this.bootstrapAttempt?.promise === promise) {
        this.bootstrapAttempt = undefined;
      }
    });
    this.bootstrapAttempt = {
      generation,
      isCurrent: subscription.isCurrent,
      promise,
    };
    return promise;
  }

  receiveSnapshot(payload: MachineSnapshotEnvelope): void {
    let snapshot: MachineSnapshotEnvelope;
    try {
      snapshot = this.validateSnapshot(payload);
    } catch (error) {
      if (this.client.isProtocolError(error)) {
        this.client.markIncompatible(error);
      }
      return;
    }
    if (!this.bootstrapped) {
      this.buffered.push(snapshot);
      if (this.buffered.length > MAX_BUFFERED_SNAPSHOTS) {
        this.buffered.shift();
      }
      return;
    }
    this.applySnapshot(snapshot);
  }

  receiveDisposed(envelope: MachineDisposedEnvelope): void {
    if (envelope.protocolVersion !== this.address.protocolVersion) {
      this.client.markIncompatible(
        new RemoteMachineTransportError(
          "incompatible",
          "Remote disposed envelope protocol is incompatible",
        ),
      );
      return;
    }
    if (this.client.addressKey(envelope) !== this.addressKey) return;
    this.disposedActorIds.add(envelope.actorInstanceId);
    if (this.metadata?.actorInstanceId !== envelope.actorInstanceId) return;
    this.metadata = undefined;
    this.transportSubscribed = false;
    this.bootstrapped = true;
    this.buffered.splice(0);
    this.setView(this.definition.remote.unavailableSnapshot(this.key), "ready");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateBootstrap();
    this.subscribers = 0;
    this.bootstrapped = false;
    this.metadata = undefined;
    this.transportSubscribed = false;
    this.setView(
      this.definition.remote.unavailableSnapshot(this.key),
      "disconnected",
    );
    this.view.dispose();
    this.buffered.splice(0);
  }

  private applyBootstrap(snapshot: MachineSnapshotEnvelope): void {
    if (this.disposedActorIds.has(snapshot.actorInstanceId)) {
      this.bootstrapped = true;
      this.buffered.splice(0);
      this.metadata = undefined;
      this.setView(
        this.definition.remote.unavailableSnapshot(this.key),
        "ready",
      );
      return;
    }
    if (
      this.metadata &&
      this.metadata.actorInstanceId !== snapshot.actorInstanceId
    ) {
      this.disposedActorIds.add(this.metadata.actorInstanceId);
    }
    this.metadata = {
      actorInstanceId: snapshot.actorInstanceId,
      revision: snapshot.revision,
    };
    this.bootstrapped = true;
    this.setView(snapshot.encodedState as State, "ready");
    const buffered = this.buffered.splice(0);
    for (const entry of buffered) this.applySnapshot(entry);
  }

  private applySnapshot(snapshot: MachineSnapshotEnvelope): void {
    if (this.disposedActorIds.has(snapshot.actorInstanceId)) return;
    if (
      !this.metadata ||
      snapshot.actorInstanceId !== this.metadata.actorInstanceId
    ) {
      return;
    }
    if (snapshot.revision <= this.metadata.revision) return;
    if (snapshot.revision !== this.metadata.revision + 1) {
      void this.resync().catch(() => undefined);
      return;
    }
    this.metadata = {
      actorInstanceId: snapshot.actorInstanceId,
      revision: snapshot.revision,
    };
    this.setView(snapshot.encodedState as State, "ready");
  }

  private validateSnapshot(payload: unknown): MachineSnapshotEnvelope {
    const outer = MachineSnapshotEnvelopeSchema.safeParse(payload);
    if (
      !outer.success ||
      this.client.addressKey(outer.data) !== this.addressKey
    ) {
      throw new RemoteMachineTransportError(
        "invalid-payload",
        "Invalid remote snapshot envelope",
      );
    }
    if (outer.data.protocolVersion !== this.address.protocolVersion) {
      throw new RemoteMachineTransportError(
        "incompatible",
        "Remote snapshot protocol is incompatible",
      );
    }
    const state = this.definition.remote.snapshotCodec.safeParse(
      outer.data.encodedState,
    );
    if (!state.success) {
      throw new RemoteMachineTransportError(
        "invalid-payload",
        "Invalid remote snapshot state",
      );
    }
    return { ...outer.data, encodedState: state.data };
  }

  private setConnection(connection: RemoteConnectionStatus): void {
    const current = this.view.getSnapshot();
    if (current.connection === connection) return;
    this.view.setState({ state: current.state, connection });
  }

  private setView(state: State, connection: RemoteConnectionStatus): void {
    const current = this.view.getSnapshot();
    if (current.state === state && current.connection === connection) return;
    this.view.setState({ state, connection });
  }

  private invalidateBootstrap(): void {
    this.bootstrapGeneration += 1;
  }
}

export class RemoteMachineClient {
  private readonly stores = new Map<
    string,
    RemoteSnapshotStore<any, any, any, any>
  >();
  private readonly pendingDispatches = new Map<
    number,
    (error: RemoteMachineTransportError) => void
  >();
  private removeStatusListener?: () => void;
  private removeSnapshotListener?: () => void;
  private removeDisposedListener?: () => void;
  private started = false;
  private disposed = false;
  private generation = 0;
  private dispatchSequence = 0;
  private status: RemoteTransportStatus;

  constructor(
    private connection: RemoteMachineClientConnection,
    private readonly ids: IdSource,
    private readonly reportError?: (error: RemoteMachineClientError) => void,
  ) {
    this.status = connection.getStatus();
  }

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.attachConnection();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.detachConnection();
  }

  replaceConnection(connection: RemoteMachineClientConnection): void {
    if (this.disposed) return;
    this.detachConnection();
    this.rejectPending("renderer-destroyed", "Renderer transport was replaced");
    this.generation += 1;
    const previousConnection = this.connection;
    for (const store of this.stores.values()) {
      if (store.hasSubscribers()) {
        void previousConnection
          .unsubscribe(store.address)
          .catch(() => undefined);
      }
    }
    this.connection = connection;
    this.status = connection.getStatus();
    for (const store of this.stores.values()) {
      store.replaceTransport(this.status);
    }
    if (this.started) this.attachConnection();
  }

  actor<Key, State, Event, Reason extends IgnoreReason>(
    definition: RemoteClientDefinition<Key, State, Event, Reason>,
    key: Key,
  ): RemoteActorRef<State, Event, Reason> {
    if (this.disposed) throw new Error("RemoteMachineClient is disposed");
    const encodedKey = definition.remote.encodeKey(key);
    const parsedKey = definition.remote.keyCodec.safeParse(encodedKey);
    if (!parsedKey.success) throw new Error(`Invalid key for ${definition.id}`);
    const address: MachineAddress = {
      protocolVersion: definition.remote.protocolVersion,
      machineId: definition.id,
      encodedKey,
    };
    const addressKey = `${definition.id}\0${definition.remote.keyToString(parsedKey.data)}`;
    const existing = this.stores.get(addressKey);
    if (existing) return existing;
    const store = new RemoteSnapshotStore(
      this,
      definition,
      parsedKey.data,
      address,
      addressKey,
    );
    this.stores.set(addressKey, store);
    return store;
  }

  connectionStatus(): RemoteConnectionStatus {
    if (this.disposed) return "disconnected";
    if (this.status === "incompatible") return "incompatible";
    if (this.status === "disconnected") return "disconnected";
    return "connecting";
  }

  isConnected(): boolean {
    return !this.disposed && this.status === "connected";
  }

  retain(store: RemoteSnapshotStore<any, any, any, any>): void {
    if (!this.started) return;
    if (this.status === "connected") {
      void store.bootstrap().catch(() => undefined);
    } else {
      store.setTransportStatus(this.status);
    }
  }

  release(store: RemoteSnapshotStore<any, any, any, any>): void {
    store.releaseInterest();
    if (this.status !== "connected") return;
    void this.connection.unsubscribe(store.address).catch(() => undefined);
  }

  beginSubscription(address: MachineAddress): {
    readonly bootstrap: Promise<MachineSnapshotEnvelope>;
    readonly release: () => Promise<void>;
    readonly isCurrent: () => boolean;
  } {
    const connection = this.connection;
    return {
      bootstrap: connection.subscribe(address),
      release: () => connection.unsubscribe(address),
      isCurrent: () => !this.disposed && this.connection === connection,
    };
  }

  addressKey(
    address: Pick<MachineAddress, "machineId" | "encodedKey">,
  ): string {
    const matching = [...this.stores.values()].find(
      (store) => store.definition.id === address.machineId,
    );
    if (!matching) return `${address.machineId}\0<unknown>`;
    const key = matching.definition.remote.keyCodec.safeParse(
      address.encodedKey,
    );
    return key.success
      ? `${address.machineId}\0${matching.definition.remote.keyToString(key.data)}`
      : `${address.machineId}\0<invalid>`;
  }

  async dispatch<Key, State, Event, Reason extends IgnoreReason>(
    store: RemoteSnapshotStore<Key, State, Event, Reason>,
    event: Event,
  ): Promise<MachineDispatchReceipt<Reason>> {
    if (this.disposed) {
      throw new RemoteMachineTransportError(
        "renderer-destroyed",
        "Renderer was destroyed",
      );
    }
    if (this.status !== "connected") throw this.transportError();
    const parsedEvent = store.definition.remote.eventCodec.safeParse(event);
    if (!parsedEvent.success) {
      throw new RemoteMachineTransportError(
        "invalid-payload",
        `Invalid event for ${store.definition.id}`,
      );
    }
    const sequence = ++this.dispatchSequence;
    const generation = this.generation;
    const metadata = store.currentMetadata();
    const envelope: MachineDispatchEnvelope = {
      ...store.address,
      messageId: this.ids.next(`${store.definition.id}:message`),
      encodedEvent: parsedEvent.data,
      expectedActorInstanceId: metadata?.actorInstanceId,
      expectedRevision: metadata?.revision,
    };
    const disconnected = new Promise<never>((_, reject) => {
      this.pendingDispatches.set(sequence, reject);
    });
    try {
      const payload = await Promise.race([
        this.connection.dispatch(envelope),
        disconnected,
      ]);
      if (generation !== this.generation) throw this.transportError();
      const receipt = MachineDispatchReceiptSchema.safeParse(payload);
      if (!receipt.success || receipt.data.messageId !== envelope.messageId) {
        throw new RemoteMachineTransportError(
          "invalid-payload",
          "Invalid remote dispatch receipt",
        );
      }
      if (
        receipt.data.kind === "rejected" &&
        receipt.data.reason === "protocol-version"
      ) {
        this.markIncompatible();
      }
      return receipt.data as MachineDispatchReceipt<Reason>;
    } finally {
      this.pendingDispatches.delete(sequence);
    }
  }

  isProtocolError(error: unknown): boolean {
    return (
      error instanceof RemoteMachineTransportError &&
      error.code === "incompatible"
    );
  }

  markIncompatible(error?: unknown): void {
    this.handleStatus("incompatible", error);
  }

  reportSubscriberError(error: unknown): void {
    const failure: RemoteMachineClientError = { stage: "subscriber", error };
    if (!this.reportError) {
      console.error("Remote machine subscriber failure:", error);
      return;
    }
    try {
      this.reportError(failure);
    } catch {
      // Error reporting must never alter transport ownership.
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.rejectPending("renderer-destroyed", "Renderer was destroyed");
    for (const store of this.stores.values()) {
      if (this.status === "connected" && store.hasSubscribers()) {
        void this.connection.unsubscribe(store.address).catch(() => undefined);
      }
      store.dispose();
    }
    this.stores.clear();
    this.status = "disconnected";
  }

  private attachConnection(): void {
    this.removeStatusListener = this.connection.onStatusChange((status) =>
      this.handleStatus(status),
    );
    this.removeSnapshotListener = this.connection.onSnapshot((payload) => {
      const parsed = MachineSnapshotEnvelopeSchema.safeParse(payload);
      if (!parsed.success) return;
      this.stores
        .get(this.addressKey(parsed.data))
        ?.receiveSnapshot(parsed.data);
    });
    this.removeDisposedListener = this.connection.onDisposed((payload) => {
      const parsed = MachineDisposedEnvelopeSchema.safeParse(payload);
      if (!parsed.success) return;
      this.stores
        .get(this.addressKey(parsed.data))
        ?.receiveDisposed(parsed.data);
    });
    const currentStatus = this.connection.getStatus();
    if (currentStatus === this.status) {
      for (const store of this.stores.values()) {
        store.setTransportStatus(currentStatus);
        if (currentStatus === "connected" && store.hasSubscribers()) {
          void store.bootstrap().catch(() => undefined);
        }
      }
    } else {
      this.handleStatus(currentStatus);
    }
  }

  private detachConnection(): void {
    this.removeStatusListener?.();
    this.removeSnapshotListener?.();
    this.removeDisposedListener?.();
    this.removeStatusListener = undefined;
    this.removeSnapshotListener = undefined;
    this.removeDisposedListener = undefined;
  }

  private handleStatus(status: RemoteTransportStatus, cause?: unknown): void {
    if (this.disposed || this.status === status) return;
    this.status = status;
    this.generation += 1;
    if (status !== "connected") {
      this.rejectPending(
        status === "incompatible" ? "incompatible" : "disconnected",
        status === "incompatible"
          ? "Remote machine protocol is incompatible"
          : "Remote machine transport disconnected",
        cause,
      );
    }
    for (const store of this.stores.values()) {
      store.setTransportStatus(status);
      if (status === "connected" && store.hasSubscribers()) {
        void store.bootstrap().catch(() => undefined);
      }
    }
  }

  private rejectPending(
    code: RemoteMachineTransportError["code"],
    message: string,
    cause?: unknown,
  ): void {
    const error = new RemoteMachineTransportError(code, message, { cause });
    for (const reject of this.pendingDispatches.values()) reject(error);
    this.pendingDispatches.clear();
  }

  private transportError(): RemoteMachineTransportError {
    return new RemoteMachineTransportError(
      this.status === "incompatible" ? "incompatible" : "disconnected",
      this.status === "incompatible"
        ? "Remote machine protocol is incompatible"
        : "Remote machine transport disconnected",
    );
  }
}
