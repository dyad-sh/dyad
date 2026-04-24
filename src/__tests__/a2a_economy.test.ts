/**
 * Unit tests for the A2A economy engine's pure helpers.
 *
 * Covers the highest-risk code without needing to mock the full
 * Electron + SQLite + SSI + Celestia stack:
 *   - BigInt amount math (decimal-string)
 *   - Contract state machine (allowed transitions)
 *   - Deterministic receipt hashing
 */

import { describe, it, expect } from "vitest";

// We import only the named `__test__` bag, which is intentionally exported
// from the engine for this purpose. This avoids triggering the engine's
// db / electron-log side imports at module-load time? Note: the engine
// re-exports electron-log, drizzle, etc., so simply importing the file
// runs those side-effect-free imports. They are safe under happy-dom.
import { __test__ } from "@/lib/a2a_economy";

const {
  ALLOWED_TRANSITIONS,
  addAmount,
  subAmount,
  gtAmount,
  gteAmount,
  sha256Hex,
  assertTransition,
} = __test__;

describe("A2A — amount math (BigInt over decimal strings)", () => {
  it("adds without precision loss for very large values", () => {
    expect(addAmount("999999999999999999", "1")).toBe("1000000000000000000");
  });

  it("subtracts and may go negative (caller's responsibility)", () => {
    expect(subAmount("10", "3")).toBe("7");
    expect(subAmount("0", "5")).toBe("-5");
  });

  it("compares correctly with gt / gte", () => {
    expect(gtAmount("10", "5")).toBe(true);
    expect(gtAmount("5", "5")).toBe(false);
    expect(gteAmount("5", "5")).toBe(true);
    expect(gteAmount("4", "5")).toBe(false);
  });

  it("treats zero correctly", () => {
    expect(addAmount("0", "0")).toBe("0");
    expect(gtAmount("0", "0")).toBe(false);
    expect(gteAmount("0", "0")).toBe(true);
  });
});

describe("A2A — contract state machine", () => {
  it("declares the canonical happy path", () => {
    const happy = [
      "ACCEPTED",
      "ESCROWED",
      "IN_PROGRESS",
      "DELIVERED",
      "VERIFIED",
      "SETTLED",
      "CLOSED",
    ] as const;
    for (let i = 0; i < happy.length - 1; i++) {
      expect(ALLOWED_TRANSITIONS[happy[i]]).toContain(happy[i + 1]);
    }
  });

  it("permits the failure paths", () => {
    expect(ALLOWED_TRANSITIONS.IN_PROGRESS).toContain("FAILED");
    expect(ALLOWED_TRANSITIONS.IN_PROGRESS).toContain("DISPUTED");
    expect(ALLOWED_TRANSITIONS.FAILED).toContain("REFUNDED");
    expect(ALLOWED_TRANSITIONS.DISPUTED).toEqual(
      expect.arrayContaining(["SETTLED", "REFUNDED"]),
    );
    expect(ALLOWED_TRANSITIONS.REFUNDED).toContain("CLOSED");
  });

  it("CLOSED is terminal", () => {
    expect(ALLOWED_TRANSITIONS.CLOSED).toEqual([]);
  });

  it("VERIFIED can only become SETTLED (no skipping the ledger flip)", () => {
    expect(ALLOWED_TRANSITIONS.VERIFIED).toEqual(["SETTLED"]);
  });

  it("blocks illegal transitions via assertTransition", () => {
    expect(() => assertTransition("ACCEPTED", "VERIFIED")).toThrow(
      /Invalid contract transition/,
    );
    expect(() => assertTransition("CLOSED", "ACCEPTED")).toThrow();
    expect(() => assertTransition("SETTLED", "REFUNDED")).toThrow();
  });

  it("allows legal transitions silently", () => {
    expect(() => assertTransition("ACCEPTED", "ESCROWED")).not.toThrow();
    expect(() => assertTransition("ESCROWED", "IN_PROGRESS")).not.toThrow();
    expect(() => assertTransition("IN_PROGRESS", "DELIVERED")).not.toThrow();
    expect(() => assertTransition("DELIVERED", "VERIFIED")).not.toThrow();
    expect(() => assertTransition("VERIFIED", "SETTLED")).not.toThrow();
    expect(() => assertTransition("SETTLED", "CLOSED")).not.toThrow();
  });

  it("ESCROWED can refund directly (caller pulls out before work starts)", () => {
    expect(ALLOWED_TRANSITIONS.ESCROWED).toContain("REFUNDED");
  });
});

describe("A2A — receipt hashing", () => {
  it("is deterministic for identical inputs", () => {
    const a = sha256Hex(JSON.stringify({ a: 1, b: "x" }));
    const b = sha256Hex(JSON.stringify({ a: 1, b: "x" }));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is sensitive to any change", () => {
    const a = sha256Hex(JSON.stringify({ a: 1 }));
    const b = sha256Hex(JSON.stringify({ a: 2 }));
    expect(a).not.toBe(b);
  });

  it("works on Buffer input", () => {
    const buf = Buffer.from("hello", "utf-8");
    expect(sha256Hex(buf)).toBe(sha256Hex("hello"));
  });
});
