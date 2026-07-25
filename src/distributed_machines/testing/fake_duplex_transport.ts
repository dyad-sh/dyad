import type { WindowSessionId } from "@/window_infrastructure/types";
import { TwoWindowHarness } from "@/testing/two_window_harness";
import type { z } from "zod";
import type { RemoteMachineManifest } from "../remote_manifest";
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
  readonly address: MachineAddress;
  readonly snapshotCodec: z.ZodType;
  actorInstanceId?: string;
  revision?: number;
  state?: unknown;
  bootstrapped: boolean;
  readonly buffered: MachineSnapshotEnvelope[];
  readonly disposedActorIds: Set<string>;
  resyncs: number;
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

export class FakeRemoteRenderer {
  private readonly views = new Map<string, FakeRemoteView>();
  private readonly removeReceiveListener: () => void;
  private holdBootstrap = false;
  private readonly bootstrapReleases: Array<() => void> = [];
  private connected = true;

  constructor(
    private readonly duplex: FakeDuplexRemoteTransport,
    readonly sessionId: WindowSessionId,
  ) {
    this.removeReceiveListener = duplex.windows.onReceive(
      sessionId,
      (channel, payload) => {
        if (channel === "distributed-machine:snapshot") {
          this.receiveSnapshot(payload);
        } else if (channel === "distributed-machine:disposed") {
          this.receiveDisposed(payload);
        }
      },
    );
  }

  holdBootstrapResponses(): void {
    this.holdBootstrap = true;
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
    const view: FakeRemoteView = {
      address,
      snapshotCodec: definition.remote.snapshotCodec,
      bootstrapped: false,
      buffered: [],
      disposedActorIds: new Set(),
      resyncs: 0,
      malformedSnapshots: 0,
    };
    this.views.set(this.addressKey(address), view);
    const generation = this.connectionGeneration();
    const bootstrap = await this.duplex.main.subscribe(
      this.endpoint(),
      address,
    );
    if (this.holdBootstrap) {
      await new Promise<void>((resolve) =>
        this.bootstrapReleases.push(resolve),
      );
    }
    this.assertGeneration(generation);
    this.applyBootstrap(view, bootstrap);
    return bootstrap;
  }

  async unsubscribe(address: MachineAddress): Promise<void> {
    this.assertConnected();
    await this.duplex.main.unsubscribe(this.endpoint(), address);
    this.views.delete(this.addressKey(address));
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
    return receipt;
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.removeReceiveListener();
    this.duplex.windows.destroy(this.sessionId);
    this.releaseBootstrapResponses();
  }

  reconnect(): FakeRemoteRenderer {
    if (this.connected) this.disconnect();
    return this.duplex.connect(this.sessionId);
  }

  view(address: MachineAddress): Readonly<FakeRemoteView> | undefined {
    return this.views.get(this.addressKey(address));
  }

  injectSnapshot(payload: unknown): void {
    this.receiveSnapshot(payload);
  }

  injectDisposed(payload: unknown): void {
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
    if (!view.snapshotCodec.safeParse(outer.data.encodedState).success) {
      view.malformedSnapshots += 1;
      return;
    }
    if (!view.bootstrapped) {
      view.buffered.push(outer.data);
      if (view.buffered.length > 16) view.buffered.shift();
      return;
    }
    this.applySnapshot(view, outer.data);
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
    try {
      const bootstrap = await this.duplex.main.subscribe(
        this.endpoint(),
        view.address,
      );
      if (!this.connected) return;
      this.applyBootstrap(view, bootstrap);
    } catch {
      // The fake exposes the resync count; connection handling belongs to B4.
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
    return `${address.machineId}\0${JSON.stringify(address.encodedKey)}`;
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
