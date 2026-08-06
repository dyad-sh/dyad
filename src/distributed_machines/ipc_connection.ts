import { ipc } from "@/ipc/types";
import type {
  RemoteMachineClientConnection,
  RemoteTransportStatus,
} from "./remote_client";
import type {
  MachineAddress,
  MachineDispatchEnvelope,
  MachineDispatchReceipt,
  MachineSnapshotEnvelope,
} from "./remote_protocol";

/**
 * Renderer connection for the production Electron transport.
 *
 * Renderer lifetimes are represented by this object: replacing or disposing
 * it releases every listener while main retains the authoritative actors.
 */
export class IpcRemoteMachineConnection implements RemoteMachineClientConnection {
  private readonly statusListeners = new Set<
    (status: RemoteTransportStatus) => void
  >();
  private status: RemoteTransportStatus = "connected";
  private readonly rendererConnectionId = globalThis.crypto.randomUUID();

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
    return ipc.events.distributedMachine.onSnapshot(listener);
  }

  onDisposed(listener: (payload: unknown) => void): () => void {
    return ipc.events.distributedMachine.onDisposed(listener);
  }

  onOperationOutcome(listener: (payload: unknown) => void): () => void {
    return ipc.events.distributedMachine.onOperationOutcome(listener);
  }

  subscribe(address: MachineAddress): Promise<MachineSnapshotEnvelope> {
    return ipc.distributedMachine.subscribe({
      ...address,
      rendererConnectionId: this.rendererConnectionId,
    });
  }

  unsubscribe(address: MachineAddress): Promise<void> {
    return ipc.distributedMachine.unsubscribe({
      ...address,
      rendererConnectionId: this.rendererConnectionId,
    });
  }

  dispatch(envelope: MachineDispatchEnvelope): Promise<MachineDispatchReceipt> {
    return ipc.distributedMachine.dispatch({
      ...envelope,
      rendererConnectionId: this.rendererConnectionId,
    });
  }

  start(): () => void {
    this.setStatus("connected");
    const unsubscribe = ipc.events.distributedMachine.onProtocolMismatch(() => {
      this.setStatus("incompatible");
    });
    return () => {
      unsubscribe();
      this.setStatus("disconnected");
    };
  }

  private setStatus(status: RemoteTransportStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
