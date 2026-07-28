import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  ChatTabTransferPayload,
  WindowSessionId,
} from "@/window_infrastructure/types";
import type { WindowRegistry } from "./window_registry";

interface SourceRemovalReceipt {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingTransfer {
  payload: ChatTabTransferPayload;
  sourceWindowSessionId: WindowSessionId;
  destinationWindowSessionId?: WindowSessionId;
  expiresAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
  sourceRemoval?: SourceRemovalReceipt;
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

export class ChatTabTransferCoordinator {
  private readonly pending = new Map<string, PendingTransfer>();
  private readonly beginWaiters = new Map<string, Set<() => void>>();

  constructor(
    private readonly windows: WindowRegistry,
    private readonly now: () => number = Date.now,
    private readonly lifetimeMs = 60_000,
    private readonly beginWaitMs = 1_000,
    private readonly sourceReceiptWaitMs = 5_000,
    private readonly maxPendingTransfers = 100,
  ) {}

  begin(
    transferId: string,
    sourceWindowSessionId: WindowSessionId,
    payload: ChatTabTransferPayload,
  ): string {
    this.sweep();
    if (this.pending.has(transferId)) {
      throw new DyadError(
        "This tab transfer identifier is already in use",
        DyadErrorKind.Conflict,
      );
    }
    for (const [existingId, transfer] of this.pending) {
      if (
        transfer.sourceWindowSessionId === sourceWindowSessionId &&
        transfer.payload.tabInstanceId === payload.tabInstanceId
      ) {
        if (transfer.destinationWindowSessionId) {
          throw new DyadError(
            "This tab is already being transferred",
            DyadErrorKind.Conflict,
          );
        }
        this.deleteTransfer(existingId, transfer);
      }
    }
    if (this.pending.size >= this.maxPendingTransfers) {
      throw new DyadError(
        "Too many tab transfers are pending",
        DyadErrorKind.Precondition,
      );
    }
    const transfer: PendingTransfer = {
      payload,
      sourceWindowSessionId,
      expiresAt: this.now() + this.lifetimeMs,
    };
    this.pending.set(transferId, transfer);
    this.scheduleExpiry(transferId, transfer);
    for (const wake of this.beginWaiters.get(transferId) ?? []) wake();
    this.beginWaiters.delete(transferId);
    return transferId;
  }

  async adopt(
    destinationWindowSessionId: WindowSessionId,
    transferId: string,
  ): Promise<ChatTabTransferPayload> {
    this.sweep();
    if (!this.pending.has(transferId)) {
      await this.waitForBegin(transferId);
      this.sweep();
    }
    const transfer = this.require(transferId);
    if (transfer.sourceWindowSessionId === destinationWindowSessionId) {
      throw new DyadError(
        "A tab transfer destination must be another window",
        DyadErrorKind.Validation,
      );
    }
    if (
      transfer.destinationWindowSessionId &&
      transfer.destinationWindowSessionId !== destinationWindowSessionId
    ) {
      throw new DyadError(
        "This tab transfer is already being adopted",
        DyadErrorKind.Conflict,
      );
    }
    transfer.destinationWindowSessionId = destinationWindowSessionId;
    transfer.expiresAt = this.now() + this.lifetimeMs;
    this.scheduleClaimExpiry(transferId, transfer);
    return transfer.payload;
  }

  reject(destinationWindowSessionId: WindowSessionId, transferId: string) {
    const transfer = this.pending.get(transferId);
    if (transfer?.destinationWindowSessionId === destinationWindowSessionId) {
      transfer.sourceRemoval?.reject(
        new DyadError(
          "The destination rejected tab adoption",
          DyadErrorKind.UserCancelled,
        ),
      );
      this.clearSourceRemoval(transfer);
      transfer.destinationWindowSessionId = undefined;
      transfer.expiresAt = this.now() + this.lifetimeMs;
      this.scheduleExpiry(transferId, transfer);
    }
  }

  async acknowledge(
    destinationWindowSessionId: WindowSessionId,
    transferId: string,
  ): Promise<void> {
    const transfer = this.require(transferId);
    if (transfer.destinationWindowSessionId !== destinationWindowSessionId) {
      throw new DyadError(
        "Only the adopting window can acknowledge this transfer",
        DyadErrorKind.Precondition,
      );
    }
    if (transfer.sourceRemoval) return transfer.sourceRemoval.promise;

    const endpoint = this.windows.endpointForSession(
      transfer.sourceWindowSessionId,
    );
    if (!endpoint) {
      throw new DyadError(
        "The source window is no longer available",
        DyadErrorKind.Precondition,
      );
    }
    this.clearExpiry(transfer);

    let resolveReceipt!: () => void;
    let rejectReceipt!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveReceipt = resolve;
      rejectReceipt = reject;
    });
    const timeout = setTimeout(() => {
      if (transfer.sourceRemoval?.promise !== promise) return;
      this.clearSourceRemoval(transfer);
      transfer.destinationWindowSessionId = undefined;
      transfer.expiresAt = this.now() + this.lifetimeMs;
      this.scheduleExpiry(transferId, transfer);
      rejectReceipt(
        new DyadError(
          "The source window did not confirm tab removal",
          DyadErrorKind.Precondition,
        ),
      );
    }, this.sourceReceiptWaitMs);
    unrefTimer(timeout);
    transfer.sourceRemoval = {
      promise,
      resolve: resolveReceipt,
      reject: rejectReceipt,
      timeout,
    };

    try {
      endpoint.send("window:chat-tab-transfer-remove-source", {
        transferId,
        tabInstanceId: transfer.payload.tabInstanceId,
        chatId: transfer.payload.chatId,
      });
    } catch (error) {
      this.clearSourceRemoval(transfer);
      transfer.destinationWindowSessionId = undefined;
      transfer.expiresAt = this.now() + this.lifetimeMs;
      this.scheduleExpiry(transferId, transfer);
      throw new DyadError(
        "The source window could not remove the transferred tab",
        DyadErrorKind.Precondition,
        { cause: error },
      );
    }
    return promise;
  }

  confirmSourceRemoval(
    sourceWindowSessionId: WindowSessionId,
    input: {
      transferId: string;
      tabInstanceId: string;
      chatId: number;
    },
  ): void {
    const transfer = this.require(input.transferId);
    if (
      transfer.sourceWindowSessionId !== sourceWindowSessionId ||
      transfer.payload.tabInstanceId !== input.tabInstanceId ||
      transfer.payload.chatId !== input.chatId ||
      !transfer.sourceRemoval
    ) {
      throw new DyadError(
        "Tab removal confirmation does not match the pending transfer",
        DyadErrorKind.Conflict,
      );
    }
    const receipt = transfer.sourceRemoval;
    this.deleteTransfer(input.transferId, transfer);
    receipt.resolve();
  }

  private waitForBegin(transferId: string): Promise<void> {
    return new Promise((resolve) => {
      const waiters = this.beginWaiters.get(transferId) ?? new Set();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        waiters.delete(finish);
        if (waiters.size === 0) this.beginWaiters.delete(transferId);
        resolve();
      };
      waiters.add(finish);
      this.beginWaiters.set(transferId, waiters);
      const timeout = setTimeout(finish, this.beginWaitMs);
      unrefTimer(timeout);
    });
  }

  private require(transferId: string): PendingTransfer {
    const transfer = this.pending.get(transferId);
    if (!transfer) {
      throw new DyadError(
        "Tab transfer is missing or expired",
        DyadErrorKind.NotFound,
      );
    }
    return transfer;
  }

  private scheduleExpiry(transferId: string, transfer: PendingTransfer): void {
    this.clearExpiry(transfer);
    const delay = Math.max(0, transfer.expiresAt - this.now());
    transfer.expiryTimer = setTimeout(() => {
      if (transfer.destinationWindowSessionId || transfer.sourceRemoval) return;
      this.deleteTransfer(transferId, transfer);
    }, delay);
    unrefTimer(transfer.expiryTimer);
  }

  private scheduleClaimExpiry(
    transferId: string,
    transfer: PendingTransfer,
  ): void {
    this.clearExpiry(transfer);
    const delay = Math.max(0, transfer.expiresAt - this.now());
    transfer.expiryTimer = setTimeout(() => {
      if (transfer.sourceRemoval) return;
      this.deleteTransfer(transferId, transfer);
    }, delay);
    unrefTimer(transfer.expiryTimer);
  }

  private clearExpiry(transfer: PendingTransfer): void {
    if (transfer.expiryTimer) clearTimeout(transfer.expiryTimer);
    transfer.expiryTimer = undefined;
  }

  private clearSourceRemoval(transfer: PendingTransfer): void {
    if (transfer.sourceRemoval) clearTimeout(transfer.sourceRemoval.timeout);
    transfer.sourceRemoval = undefined;
  }

  private deleteTransfer(transferId: string, transfer: PendingTransfer): void {
    this.clearExpiry(transfer);
    this.clearSourceRemoval(transfer);
    this.pending.delete(transferId);
  }

  private sweep(): void {
    const now = this.now();
    for (const [transferId, transfer] of this.pending) {
      if (
        transfer.expiresAt <= now &&
        !transfer.destinationWindowSessionId &&
        !transfer.sourceRemoval
      ) {
        this.deleteTransfer(transferId, transfer);
      }
    }
  }
}
