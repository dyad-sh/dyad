import { describe, expect, it, vi } from "vitest";
import { createFakeClock } from "./testing";
import { PendingReceiptLedger } from "./pending_receipt_ledger";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createLedger(
  overrides: Partial<
    ConstructorParameters<typeof PendingReceiptLedger<string>>[0]
  > = {},
) {
  const clock = createFakeClock();
  return {
    clock,
    ledger: new PendingReceiptLedger<string>({
      clock,
      maxPendingEntries: 2,
      maxSettledEntries: 2,
      settledRetentionMs: 10,
      disposal: { kind: "resolve", value: () => "disposed" },
      ...overrides,
    }),
  };
}

describe("PendingReceiptLedger", () => {
  it("reserves synchronously before running a reentrant async factory", async () => {
    const { ledger } = createLedger();
    let duplicate;
    const fresh = ledger.claim({
      scope: "window",
      messageId: "message",
      fingerprint: "digest",
      start: () => {
        duplicate = ledger.claim({
          scope: "window",
          messageId: "message",
          fingerprint: "digest",
          start: () => "wrong",
        });
        return "result";
      },
    });

    expect(fresh.kind).toBe("fresh");
    expect(duplicate).toMatchObject({ kind: "duplicate", state: "pending" });
    if (fresh.kind === "fresh")
      await expect(fresh.receipt).resolves.toBe("result");
  });

  it("coalesces duplicates and reports fingerprint conflicts", async () => {
    const gate = deferred<string>();
    const { ledger } = createLedger();
    const start = vi.fn(() => gate.promise);
    const first = ledger.claim({
      scope: "window",
      messageId: "message",
      fingerprint: "one",
      start,
    });
    const duplicate = ledger.claim({
      scope: "window",
      messageId: "message",
      fingerprint: "one",
      start,
    });
    const conflict = ledger.claim({
      scope: "window",
      messageId: "message",
      fingerprint: "two",
      start,
    });

    expect(duplicate.kind).toBe("duplicate");
    expect(conflict).toEqual({ kind: "conflict" });
    expect(start).toHaveBeenCalledOnce();
    gate.resolve("done");
    if (first.kind === "fresh")
      await expect(first.receipt).resolves.toBe("done");
  });

  it("rejects pending capacity without evicting pending entries", async () => {
    const gate = deferred<string>();
    const { ledger } = createLedger({ maxPendingEntries: 1 });
    const first = ledger.claim({
      scope: "scope",
      messageId: "one",
      fingerprint: "one",
      start: () => gate.promise,
    });
    expect(
      ledger.claim({
        scope: "scope",
        messageId: "two",
        fingerprint: "two",
        start: () => "wrong",
      }),
    ).toEqual({ kind: "capacity-rejected" });
    expect(
      ledger.claim({
        scope: "scope",
        messageId: "one",
        fingerprint: "one",
        start: () => "wrong",
      }).kind,
    ).toBe("duplicate");
    gate.resolve("done");
    if (first.kind === "fresh") await first.receipt;
  });

  it("starts retention at settlement and evicts only settled history", async () => {
    const gate = deferred<string>();
    const { ledger, clock } = createLedger({ maxSettledEntries: 1 });
    const pending = ledger.claim({
      scope: "scope",
      messageId: "pending",
      fingerprint: "pending",
      start: () => gate.promise,
    });
    clock.advanceBy(20);
    const settled = ledger.claim({
      scope: "scope",
      messageId: "settled",
      fingerprint: "settled",
      start: () => "settled",
    });
    if (settled.kind === "fresh") await settled.receipt;
    expect(
      ledger.claim({
        scope: "scope",
        messageId: "pending",
        fingerprint: "pending",
        start: () => "wrong",
      }).kind,
    ).toBe("duplicate");
    clock.advanceBy(9);
    expect(
      ledger.claim({
        scope: "scope",
        messageId: "settled",
        fingerprint: "settled",
        start: () => "wrong",
      }).kind,
    ).toBe("duplicate");
    clock.advanceBy(1);
    expect(
      ledger.claim({
        scope: "scope",
        messageId: "settled",
        fingerprint: "settled",
        start: () => "replacement",
      }).kind,
    ).toBe("fresh");
    gate.resolve("done");
    if (pending.kind === "fresh") await pending.receipt;
  });

  it("bounds settled history independently of pending capacity", async () => {
    const pendingGate = deferred<string>();
    const { ledger } = createLedger({
      maxPendingEntries: 2,
      maxSettledEntries: 1,
    });
    const pending = ledger.claim({
      scope: "scope",
      messageId: "pending",
      fingerprint: "pending",
      start: () => pendingGate.promise,
    });
    for (const messageId of ["oldest", "newest"]) {
      const claim = ledger.claim({
        scope: "scope",
        messageId,
        fingerprint: messageId,
        start: () => messageId,
      });
      if (claim.kind === "fresh") await claim.receipt;
    }
    expect(
      ledger.claim({
        scope: "scope",
        messageId: "oldest",
        fingerprint: "oldest",
        start: () => "replacement",
      }).kind,
    ).toBe("fresh");
    expect(
      ledger.claim({
        scope: "scope",
        messageId: "pending",
        fingerprint: "pending",
        start: () => "wrong",
      }).kind,
    ).toBe("duplicate");
    pendingGate.resolve("done");
    if (pending.kind === "fresh") await pending.receipt;
  });

  it("removes transient results after settlement and ignores stale continuations", async () => {
    const old = deferred<string>();
    const { ledger } = createLedger();
    const first = ledger.claim({
      scope: "scope",
      messageId: "message",
      fingerprint: "digest",
      start: () => old.promise,
      retention: () => "remove",
    });
    old.resolve("transient");
    if (first.kind === "fresh") await first.receipt;
    const replacement = ledger.claim({
      scope: "scope",
      messageId: "message",
      fingerprint: "digest",
      start: () => "replacement",
    });
    expect(replacement.kind).toBe("fresh");
    if (replacement.kind === "fresh") {
      await expect(replacement.receipt).resolves.toBe("replacement");
    }
  });

  it("settles unresolved claims with the explicit disposal policy", async () => {
    const { ledger } = createLedger();
    const claim = ledger.claim({
      scope: "scope",
      messageId: "message",
      fingerprint: "digest",
      start: () => new Promise<string>(() => undefined),
    });
    ledger.dispose();
    if (claim.kind === "fresh") {
      await expect(claim.receipt).resolves.toBe("disposed");
    }
    expect(
      ledger.claim({
        scope: "scope",
        messageId: "new",
        fingerprint: "new",
        start: () => "wrong",
      }),
    ).toEqual({ kind: "disposed" });
  });

  it("can reject unresolved claims with a typed disposal error", async () => {
    const disposalError = new Error("ledger disposed");
    const { ledger } = createLedger({
      disposal: { kind: "reject", error: () => disposalError },
    });
    const claim = ledger.claim({
      scope: "scope",
      messageId: "message",
      fingerprint: "digest",
      start: () => new Promise<string>(() => undefined),
    });
    ledger.dispose();
    if (claim.kind === "fresh") {
      await expect(claim.receipt).rejects.toBe(disposalError);
    }
  });

  it("refuses admission when the pruning clock disposes reentrantly", () => {
    const start = vi.fn(() => new Promise<string>(() => undefined));
    let ledger!: PendingReceiptLedger<string>;
    const now = vi.fn(() => {
      ledger.dispose();
      return 0;
    });
    ledger = new PendingReceiptLedger({
      clock: { now },
      maxPendingEntries: 1,
      maxSettledEntries: 1,
      settledRetentionMs: 10,
      disposal: { kind: "resolve", value: () => "disposed" },
    });

    expect(
      ledger.claim({
        scope: "scope",
        messageId: "message",
        fingerprint: "digest",
        start,
      }),
    ).toEqual({ kind: "disposed" });
    expect(start).not.toHaveBeenCalled();
    expect(ledger.hasReceipt("scope", "message")).toBe(false);
  });

  it("survives a settlement clock that disposes reentrantly", async () => {
    let ledger!: PendingReceiptLedger<string>;
    const now = vi.fn(() => {
      if (now.mock.calls.length === 2) ledger.dispose();
      return 0;
    });
    ledger = new PendingReceiptLedger({
      clock: { now },
      maxPendingEntries: 1,
      maxSettledEntries: 1,
      settledRetentionMs: 10,
      disposal: { kind: "resolve", value: () => "disposed" },
    });
    const claim = ledger.claim({
      scope: "scope",
      messageId: "message",
      fingerprint: "digest",
      start: () => "result",
    });
    if (claim.kind === "fresh") {
      await expect(claim.receipt).resolves.toBe("result");
    }
    expect(
      ledger.claim({
        scope: "scope",
        messageId: "new",
        fingerprint: "new",
        start: () => "wrong",
      }).kind,
    ).toBe("disposed");
  });
});
