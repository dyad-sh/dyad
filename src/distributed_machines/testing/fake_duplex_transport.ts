import type { WindowSessionId } from "@/window_infrastructure/types";
import { TwoWindowHarness } from "@/testing/two_window_harness";
import type { z } from "zod";
import type { RemoteMachineManifest } from "../remote_manifest";
import type {
  RemoteMachineClientConnection,
  RemoteTransportStatus,
} from "../remote_client";
import { RemoteMachineTransportError } from "../remote_client";
import {
  MachineDisposedEnvelopeSchema,
  MachineSnapshotEnvelopeSchema,
  type MachineAddress,
  type MachineDispatchEnvelope,
  type MachineDispatchReceipt,
  type MachineDisposedEnvelope,
  type MachineSnapshotEnvelope,
} from "../remote_protocol";
import {
  type RemoteTransportEndpoint,
  RemoteMachineTransport,
} from "../remote_transport";

interface FakeRemoteView {
  readonly generation: number;
  readonly address: MachineAddress;
  readonly snapshotCodec: z.ZodType;
  actorInstanceId?: string;
  revision?: number;
  state?: unknown;
  bootstrapped: boolean;
  readonly buffered: MachineSnapshotEnvelope[];
  readonly disposedActorIds: Set<string>;
  resyncs: number;
  resyncGeneration: number;
  malformedSnapshots: number;
}

export class FakeTransportDisconnectedError extends Error {
  constructor() {
    super("Fake renderer transport disconnected");
    this.name = "FakeTransportDisconnectedError";
  }
}

export class FakeDuplexRemoteTransport {
  private duplicateDispatch = false;
  private dropReceipt = false;

  constructor(
    readonly main: RemoteMachineTransport,
    readonly manifest: RemoteMachineManifest,
    readonly windows = new TwoWindowHarness(),
  ) {}

  connect(sessionId?: WindowSessionId): FakeRemoteRenderer {
    const connectedSessionId =
      sessionId === undefined
        ? this.windows.createTrustedRendererWindow()
        : this.windows.createTrustedRendererWindow(sessionId);
    return new FakeRemoteRenderer(this, connectedSessionId);
  }

  duplicateNextDispatch(): void {
    this.duplicateDispatch = true;
  }

  dropNextReceipt(): void {
    this.dropReceipt = true;
  }

  consumeDuplicateDispatch(): boolean {
    const duplicate = this.duplicateDispatch;
    this.duplicateDispatch = false;
    return duplicate;
  }

  consumeDroppedReceipt(): boolean {
    const drop = this.dropReceipt;
    this.dropReceipt = false;
    return drop;
  }
}

export class FakeRemoteRenderer implements RemoteMachineClientConnection {
  private readonly views = new Map<string, FakeRemoteView>();
  private nextViewGeneration = 1;
  private readonly removeReceiveListener: () => void;
  private readonly statusListeners = new Set<
    (status: RemoteTransportStatus) => void
  >();
  private readonly snapshotListeners = new Set<(payload: unknown) => void>();
  private readonly disposedListeners = new Set<(payload: unknown) => void>();
  private readonly operationOutcomeListeners = new Set<
    (payload: unknown) => void
  >();
  private holdBootstrap = false;
  private readonly bootstrapReleases: Array<() => void> = [];
  private connected = true;
  private status: RemoteTransportStatus = "connected";

  constructor(
    private readonly duplex: FakeDuplexRemoteTransport,
    readonly sessionId: WindowSessionId,
  ) {
    this.removeReceiveListener = duplex.windows.onReceive(
      sessionId,
      (channel, payload) => {
        if (channel === "distributed-machine:snapshot") {
          for (const listener of this.snapshotListeners) listener(payload);
          this.receiveSnapshot(payload);
        } else if (channel === "distributed-machine:disposed") {
          for (const listener of this.disposedListeners) listener(payload);
          this.receiveDisposed(payload);
        } else if (channel === "distributed-machine:operation-outcome") {
          for (const listener of this.operationOutcomeListeners) {
            listener(payload);
          }
        }
      },
    );
  }

  holdBootstrapResponses(): void {
    this.holdBootstrap = true;
  }

  getStatus(): RemoteTransportStatus {
    return this.status;
  }

  onStatusChange(
    listener: (status: RemoteTransportStatus) => void,
  ): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onSnapshot(listener: (payload: unknown) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onDisposed(listener: (payload: unknown) => void): () => void {
    this.disposedListeners.add(listener);
    return () => this.disposedListeners.delete(listener);
  }

  onOperationOutcome(listener: (payload: unknown) => void): () => void {
    this.operationOutcomeListeners.add(listener);
    return () => this.operationOutcomeListeners.delete(listener);
  }

  reportIncompatible(): void {
    this.status = "incompatible";
    for (const listener of this.statusListeners) listener("incompatible");
  }

  releaseBootstrapResponses(): void {
    this.holdBootstrap = false;
    for (const release of this.bootstrapReleases.splice(0)) release();
  }

  async subscribe(address: MachineAddress): Promise<MachineSnapshotEnvelope> {
    this.assertConnected();
    const definition = this.duplex.manifest.get(address.machineId);
    if (!definition)
      throw new Error(`Unknown fake machine ${address.machineId}`);
    const addressKey = this.addressKey(address);
    if (definition.remote.protocolVersion !== address.protocolVersion) {
      await Promise.resolve();
      this.reportIncompatible();
      throw new RemoteMachineTransportError(
        "incompatible",
        "Fake renderer/main machine protocols are incompatible",
      );
    }
    const view: FakeRemoteView = {
      generation: this.nextViewGeneration++,
      address,
      snapshotCodec: definition.remote.snapshotCodec,
      bootstrapped: false,
      buffered: [],
      disposedActorIds: new Set(),
      resyncs: 0,
      resyncGeneration: 0,
      malformedSnapshots: 0,
    };
    this.views.set(addressKey, view);
    const generation = this.connectionGeneration();
    let mainSubscribed = false;
    try {
      const bootstrap = await this.duplex.main.subscribe(
        this.endpoint(),
        address,
      );
      mainSubscribed = true;
      if (this.holdBootstrap) {
        await new Promise<void>((resolve) =>
          this.bootstrapReleases.push(resolve),
        );
      }
      this.assertGeneration(generation);
      if (!this.isCurrentView(view)) {
        throw new Error(
          `Remote subscription was superseded (generation ${view.generation})`,
        );
      }
      const validated = this.validateSnapshot(view, bootstrap, address);
      this.applyBootstrap(view, validated);
      return validated;
    } catch (error) {
      if (this.isCurrentView(view)) {
        this.views.delete(addressKey);
        await this.compensateSubscription(address);
      } else if (mainSubscribed && !this.views.has(addressKey)) {
        await this.compensateSubscription(address);
      }
      throw error;
    }
  }

  async unsubscribe(address: MachineAddress): Promise<void> {
    this.assertConnected();
    this.views.delete(this.addressKey(address));
    await this.duplex.main.unsubscribe(this.endpoint(), address);
  }

  async dispatch(
    envelope: MachineDispatchEnvelope,
  ): Promise<MachineDispatchReceipt> {
    this.assertConnected();
    const generation = this.connectionGeneration();
    const first = this.duplex.main.dispatch(this.endpoint(), envelope);
    if (this.duplex.consumeDuplicateDispatch()) {
      void this.duplex.main.dispatch(this.endpoint(), envelope);
    }
    const receipt = await first;
    if (this.duplex.consumeDroppedReceipt()) {
      throw new FakeTransportDisconnectedError();
    }
    this.assertGeneration(generation);
    if (receipt.kind === "rejected" && receipt.reason === "protocol-version") {
      this.reportIncompatible();
    }
    return receipt;
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.views.clear();
    this.status = "disconnected";
    this.removeReceiveListener();
    this.duplex.windows.destroy(this.sessionId);
    this.releaseBootstrapResponses();
    for (const listener of this.statusListeners) listener("disconnected");
  }

  reconnect(): FakeRemoteRenderer {
    if (this.connected) this.disconnect();
    return this.duplex.connect(this.sessionId);
  }

  view(address: MachineAddress): Readonly<FakeRemoteView> | undefined {
    return this.views.get(this.addressKey(address));
  }

  injectSnapshot(payload: unknown): void {
    for (const listener of this.snapshotListeners) listener(payload);
    this.receiveSnapshot(payload);
  }

  injectDisposed(payload: unknown): void {
    for (const listener of this.disposedListeners) listener(payload);
    this.receiveDisposed(payload);
  }

  private receiveSnapshot(payload: unknown): void {
    const outer = MachineSnapshotEnvelopeSchema.safeParse(payload);
    if (!outer.success) {
      for (const view of this.views.values()) view.malformedSnapshots += 1;
      return;
    }
    const view = this.views.get(this.addressKey(outer.data));
    if (!view) return;
    let validated: MachineSnapshotEnvelope;
    try {
      validated = this.validateSnapshot(view, outer.data, view.address);
    } catch {
      view.malformedSnapshots += 1;
      return;
    }
    if (!view.bootstrapped) {
      view.buffered.push(validated);
      if (view.buffered.length > 16) view.buffered.shift();
      return;
    }
    this.applySnapshot(view, validated);
  }

  private receiveDisposed(payload: unknown): void {
    const outer = MachineDisposedEnvelopeSchema.safeParse(payload);
    if (!outer.success) return;
    const view = this.views.get(this.addressKey(outer.data));
    if (!view) return;
    const envelope = outer.data as MachineDisposedEnvelope;
    view.disposedActorIds.add(envelope.actorInstanceId);
    if (view.actorInstanceId === envelope.actorInstanceId) {
      view.actorInstanceId = undefined;
      view.revision = undefined;
      view.state = undefined;
    }
  }

  private applyBootstrap(
    view: FakeRemoteView,
    bootstrap: MachineSnapshotEnvelope,
  ): void {
    if (view.disposedActorIds.has(bootstrap.actorInstanceId)) {
      throw new Error("Remote bootstrap references a disposed actor");
    }
    if (
      view.bootstrapped &&
      view.actorInstanceId === bootstrap.actorInstanceId &&
      bootstrap.revision <= (view.revision ?? -1)
    ) {
      return;
    }
    view.actorInstanceId = bootstrap.actorInstanceId;
    view.revision = bootstrap.revision;
    view.state = bootstrap.encodedState;
    view.bootstrapped = true;
    const buffered = view.buffered.splice(0).sort((left, right) => {
      if (left.actorInstanceId !== right.actorInstanceId) return 0;
      return left.revision - right.revision;
    });
    for (const snapshot of buffered) this.applySnapshot(view, snapshot);
  }

  private applySnapshot(
    view: FakeRemoteView,
    snapshot: MachineSnapshotEnvelope,
  ): void {
    if (view.disposedActorIds.has(snapshot.actorInstanceId)) return;
    if (snapshot.actorInstanceId !== view.actorInstanceId) return;
    const currentRevision = view.revision ?? -1;
    if (snapshot.revision <= currentRevision) return;
    if (snapshot.revision !== currentRevision + 1) {
      view.resyncs += 1;
      void this.resync(view);
      return;
    }
    view.revision = snapshot.revision;
    view.state = snapshot.encodedState;
  }

  private async resync(view: FakeRemoteView): Promise<void> {
    const requestGeneration = ++view.resyncGeneration;
    let mainSubscribed = false;
    try {
      const bootstrap = await this.duplex.main.subscribe(
        this.endpoint(),
        view.address,
      );
      mainSubscribed = true;
      if (!this.isCurrentView(view)) {
        if (!this.views.has(this.addressKey(view.address))) {
          await this.compensateSubscription(view.address);
        }
        return;
      }
      if (requestGeneration !== view.resyncGeneration) return;
      const validated = this.validateSnapshot(view, bootstrap, view.address);
      this.applyBootstrap(view, validated);
    } catch {
      if (mainSubscribed && !this.isCurrentView(view)) {
        await this.compensateSubscription(view.address);
      }
      // The fake exposes the resync count; connection handling belongs to B4.
    }
  }

  private isCurrentView(view: FakeRemoteView): boolean {
    return (
      this.connected && this.views.get(this.addressKey(view.address)) === view
    );
  }

  private async compensateSubscription(address: MachineAddress): Promise<void> {
    if (!this.connected) return;
    try {
      await this.duplex.main.unsubscribe(this.endpoint(), address);
    } catch {
      // A destroyed endpoint is already cleaned up by the main transport.
    }
  }

  private endpoint(): RemoteTransportEndpoint {
    return this.duplex.windows.endpoint(
      this.sessionId,
    ) as RemoteTransportEndpoint;
  }

  private addressKey(
    address: Pick<MachineAddress, "machineId" | "encodedKey">,
  ) {
    const definition = this.duplex.manifest.get(address.machineId);
    const decoded = definition?.remote.keyCodec.safeParse(address.encodedKey);
    if (!definition || !decoded?.success) {
      return `${address.machineId}\0<invalid-key>`;
    }
    return `${address.machineId}\0${definition.remote.keyToString(decoded.data)}`;
  }

  private validateSnapshot(
    view: FakeRemoteView,
    payload: unknown,
    expectedAddress: MachineAddress,
  ): MachineSnapshotEnvelope {
    const outer = MachineSnapshotEnvelopeSchema.safeParse(payload);
    if (
      !outer.success ||
      outer.data.protocolVersion !== expectedAddress.protocolVersion ||
      this.addressKey(outer.data) !== this.addressKey(expectedAddress)
    ) {
      throw new Error("Invalid remote snapshot envelope");
    }
    const state = view.snapshotCodec.safeParse(outer.data.encodedState);
    if (!state.success) throw new Error("Invalid remote snapshot state");
    return { ...outer.data, encodedState: state.data };
  }

  private connectionGeneration(): number {
    return this.duplex.windows.webContentsId(this.sessionId);
  }

  private assertGeneration(generation: number): void {
    if (
      !this.connected ||
      this.duplex.windows.webContentsId(this.sessionId) !== generation
    ) {
      throw new FakeTransportDisconnectedError();
    }
  }

  private assertConnected(): void {
    if (!this.connected) throw new FakeTransportDisconnectedError();
  }
}
