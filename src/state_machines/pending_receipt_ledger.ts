import type { Clock } from "./clock";

export type PendingReceiptSettlement<Value> =
  | { readonly status: "fulfilled"; readonly value: Value }
  | { readonly status: "rejected"; readonly error: unknown };

export type PendingReceiptDisposalPolicy<Value> =
  | {
      readonly kind: "resolve";
      readonly value: (identity: { scope: string; messageId: string }) => Value;
    }
  | {
      readonly kind: "reject";
      readonly error: (identity: {
        scope: string;
        messageId: string;
      }) => unknown;
    };

export interface PendingReceiptLedgerOptions<Value> {
  readonly clock: Pick<Clock, "now">;
  readonly maxPendingEntries: number;
  readonly maxSettledEntries: number;
  readonly settledRetentionMs: number;
  readonly disposal: PendingReceiptDisposalPolicy<Value>;
}

export type PendingReceiptClaim<Value> =
  | {
      readonly kind: "fresh";
      readonly receipt: Promise<Value>;
    }
  | {
      readonly kind: "duplicate";
      readonly receipt: Promise<Value>;
      readonly state: "pending" | "settled";
    }
  | { readonly kind: "conflict" }
  | { readonly kind: "capacity-rejected" }
  | { readonly kind: "disposed" };

interface Entry<Value> {
  readonly scope: string;
  readonly messageId: string;
  readonly fingerprint: string;
  readonly receipt: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (error: unknown) => void;
  state: "pending" | "settled";
  settledAt?: number;
  settlementSequence?: number;
}

/**
 * Process-local retry receipt ownership. Pending entries are reserved before
 * the admission factory runs and can never be evicted by capacity pressure.
 */
export class PendingReceiptLedger<Value> {
  private readonly scopes = new Map<string, Map<string, Entry<Value>>>();
  private pendingCount = 0;
  private settledCount = 0;
  private settlementSequence = 0;
  private disposed = false;

  constructor(private readonly options: PendingReceiptLedgerOptions<Value>) {
    if (
      !Number.isInteger(options.maxPendingEntries) ||
      options.maxPendingEntries < 0 ||
      !Number.isInteger(options.maxSettledEntries) ||
      options.maxSettledEntries < 0 ||
      !Number.isFinite(options.settledRetentionMs) ||
      options.settledRetentionMs < 0
    ) {
      throw new Error("Pending receipt ledger limits must be non-negative");
    }
  }

  claim(input: {
    readonly scope: string;
    readonly messageId: string;
    readonly fingerprint: string;
    readonly start: () => Value | PromiseLike<Value>;
    readonly retention?: (
      settlement: PendingReceiptSettlement<Value>,
    ) => "retain" | "remove";
  }): PendingReceiptClaim<Value> {
    if (this.disposed) return { kind: "disposed" };
    this.pruneExpired();
    if (this.disposed) return { kind: "disposed" };

    const entries = this.scopes.get(input.scope);
    const existing = entries?.get(input.messageId);
    if (existing) {
      if (existing.fingerprint !== input.fingerprint) {
        return { kind: "conflict" };
      }
      return {
        kind: "duplicate",
        receipt: existing.receipt,
        state: existing.state,
      };
    }
    if (this.pendingCount >= this.options.maxPendingEntries) {
      return { kind: "capacity-rejected" };
    }

    let resolve!: (value: Value) => void;
    let reject!: (error: unknown) => void;
    const receipt = new Promise<Value>((resolveReceipt, rejectReceipt) => {
      resolve = resolveReceipt;
      reject = rejectReceipt;
    });
    const entry: Entry<Value> = {
      scope: input.scope,
      messageId: input.messageId,
      fingerprint: input.fingerprint,
      receipt,
      resolve,
      reject,
      state: "pending",
    };
    const scopeEntries = entries ?? new Map<string, Entry<Value>>();
    if (!entries) this.scopes.set(input.scope, scopeEntries);
    scopeEntries.set(input.messageId, entry);
    this.pendingCount += 1;

    let started: Value | PromiseLike<Value>;
    try {
      started = input.start();
    } catch (error) {
      this.settle(input.scope, input.messageId, entry, input.retention, {
        status: "rejected",
        error,
      });
      return { kind: "fresh", receipt };
    }
    void Promise.resolve(started).then(
      (value) =>
        this.settle(input.scope, input.messageId, entry, input.retention, {
          status: "fulfilled",
          value,
        }),
      (error) =>
        this.settle(input.scope, input.messageId, entry, input.retention, {
          status: "rejected",
          error,
        }),
    );
    return { kind: "fresh", receipt };
  }

  hasReceipt(scope: string, messageId: string): boolean {
    return this.scopes.get(scope)?.has(messageId) === true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const entries = [...this.scopes.values()].flatMap((scope) => [
      ...scope.values(),
    ]);
    this.scopes.clear();
    this.pendingCount = 0;
    this.settledCount = 0;
    for (const entry of entries) {
      if (entry.state !== "pending") continue;
      entry.state = "settled";
      try {
        if (this.options.disposal.kind === "resolve") {
          entry.resolve(this.options.disposal.value(entry));
        } else {
          entry.reject(this.options.disposal.error(entry));
        }
      } catch (error) {
        entry.reject(error);
      }
    }
  }

  private settle(
    scope: string,
    messageId: string,
    entry: Entry<Value>,
    retention:
      | ((settlement: PendingReceiptSettlement<Value>) => "retain" | "remove")
      | undefined,
    settlement: PendingReceiptSettlement<Value>,
  ): void {
    if (entry.state !== "pending") return;
    entry.state = "settled";
    this.pendingCount -= 1;
    if (settlement.status === "fulfilled") {
      entry.resolve(settlement.value);
    } else {
      entry.reject(settlement.error);
    }
    let remove = false;
    try {
      remove = retention?.(settlement) === "remove";
    } catch {
      remove = true;
    }
    if (
      this.disposed ||
      remove ||
      this.scopes.get(scope)?.get(messageId) !== entry
    ) {
      this.deleteIfCurrent(scope, messageId, entry);
      return;
    }

    let settledAt: number;
    try {
      settledAt = this.options.clock.now();
    } catch {
      this.deleteIfCurrent(scope, messageId, entry);
      return;
    }
    if (this.disposed || this.scopes.get(scope)?.get(messageId) !== entry) {
      this.deleteIfCurrent(scope, messageId, entry);
      return;
    }
    entry.settledAt = settledAt;
    entry.settlementSequence = this.settlementSequence++;
    this.settledCount += 1;
    this.compactSettled();
  }

  private pruneExpired(): void {
    let now: number;
    try {
      now = this.options.clock.now();
    } catch {
      return;
    }
    for (const [scope, entries] of this.scopes) {
      for (const [messageId, entry] of entries) {
        if (
          entry.state === "settled" &&
          entry.settledAt !== undefined &&
          now - entry.settledAt >= this.options.settledRetentionMs
        ) {
          this.deleteIfCurrent(scope, messageId, entry);
        }
      }
    }
  }

  private compactSettled(): void {
    while (this.settledCount > this.options.maxSettledEntries) {
      let oldest:
        | { scope: string; messageId: string; entry: Entry<Value> }
        | undefined;
      for (const [scope, entries] of this.scopes) {
        for (const [messageId, entry] of entries) {
          if (
            entry.state !== "settled" ||
            entry.settlementSequence === undefined
          ) {
            continue;
          }
          if (
            !oldest ||
            entry.settlementSequence <
              (oldest.entry.settlementSequence ?? Number.MAX_SAFE_INTEGER)
          ) {
            oldest = { scope, messageId, entry };
          }
        }
      }
      if (!oldest) return;
      this.deleteIfCurrent(oldest.scope, oldest.messageId, oldest.entry);
    }
  }

  private deleteIfCurrent(
    scope: string,
    messageId: string,
    entry: Entry<Value>,
  ): void {
    const entries = this.scopes.get(scope);
    if (entries?.get(messageId) !== entry) return;
    entries.delete(messageId);
    if (entries.size === 0) this.scopes.delete(scope);
    if (entry.state === "settled" && entry.settledAt !== undefined) {
      this.settledCount -= 1;
    }
  }
}
