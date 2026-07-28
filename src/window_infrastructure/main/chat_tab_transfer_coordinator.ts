import type {
  ChatTabTransferPayload,
  WindowSessionId,
} from "@/window_infrastructure/types";
import type { WindowRegistry } from "./window_registry";

interface PendingTransfer {
  payload: ChatTabTransferPayload;
  sourceWindowSessionId: WindowSessionId;
  destinationWindowSessionId?: WindowSessionId;
  expiresAt: number;
}

export class ChatTabTransferCoordinator {
  private readonly pending = new Map<string, PendingTransfer>();

  constructor(
    private readonly windows: WindowRegistry,
    private readonly now: () => number = Date.now,
    private readonly lifetimeMs = 60_000,
  ) {}

  begin(
    transferId: string,
    sourceWindowSessionId: WindowSessionId,
    payload: ChatTabTransferPayload,
  ): string {
    this.sweep();
    for (const [transferId, transfer] of this.pending) {
      if (
        transfer.sourceWindowSessionId === sourceWindowSessionId &&
        transfer.payload.tabInstanceId === payload.tabInstanceId
      ) {
        this.pending.delete(transferId);
      }
    }
    this.pending.set(transferId, {
      payload,
      sourceWindowSessionId,
      expiresAt: this.now() + this.lifetimeMs,
    });
    return transferId;
  }

  adopt(
    destinationWindowSessionId: WindowSessionId,
    transferId: string,
  ): ChatTabTransferPayload {
    this.sweep();
    const transfer = this.require(transferId);
    if (transfer.sourceWindowSessionId === destinationWindowSessionId) {
      throw new Error("A tab transfer destination must be another window");
    }
    if (
      transfer.destinationWindowSessionId &&
      transfer.destinationWindowSessionId !== destinationWindowSessionId
    ) {
      throw new Error("This tab transfer is already being adopted");
    }
    transfer.destinationWindowSessionId = destinationWindowSessionId;
    return transfer.payload;
  }

  reject(destinationWindowSessionId: WindowSessionId, transferId: string) {
    const transfer = this.pending.get(transferId);
    if (transfer?.destinationWindowSessionId === destinationWindowSessionId) {
      transfer.destinationWindowSessionId = undefined;
    }
  }

  acknowledge(
    destinationWindowSessionId: WindowSessionId,
    transferId: string,
  ): void {
    this.sweep();
    const transfer = this.require(transferId);
    if (transfer.destinationWindowSessionId !== destinationWindowSessionId) {
      throw new Error("Only the adopting window can acknowledge this transfer");
    }
    this.windows
      .endpointForSession(transfer.sourceWindowSessionId)
      ?.send("window:chat-tab-transfer-remove-source", {
        transferId,
        tabInstanceId: transfer.payload.tabInstanceId,
        chatId: transfer.payload.chatId,
      });
    this.pending.delete(transferId);
  }

  private require(transferId: string): PendingTransfer {
    const transfer = this.pending.get(transferId);
    if (!transfer) throw new Error("Tab transfer is missing or expired");
    return transfer;
  }

  private sweep(): void {
    const now = this.now();
    for (const [transferId, transfer] of this.pending) {
      if (transfer.expiresAt <= now) this.pending.delete(transferId);
    }
  }
}
