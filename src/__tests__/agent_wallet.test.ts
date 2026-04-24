/**
 * Unit tests for the Agent Wallet & Policy engine's pure helpers.
 */

import { describe, it, expect } from "vitest";

import { __test__ } from "@/lib/agent_wallet";

const { matchPattern, sha256Hex, canonicalIntentPayload, bigOf } = __test__;

describe("Wallet — capability glob matcher", () => {
  it("matches exact strings", () => {
    expect(matchPattern("a2a.invoke", "a2a.invoke")).toBe(true);
    expect(matchPattern("a2a.invoke", "a2a.read")).toBe(false);
  });

  it("matches the wildcard *", () => {
    expect(matchPattern("anything.at.all", "*")).toBe(true);
    expect(matchPattern("", "*")).toBe(true);
  });

  it("matches namespace globs like a2a.*", () => {
    expect(matchPattern("a2a.invoke", "a2a.*")).toBe(true);
    expect(matchPattern("a2a.read", "a2a.*")).toBe(true);
    expect(matchPattern("os.intent", "a2a.*")).toBe(false);
  });

  it("ignores capability suffix after ':' when pattern uses a wildcard", () => {
    expect(matchPattern("fs.read:./projects/**", "fs.*")).toBe(true);
    expect(matchPattern("fs.read:./projects/**", "fs.read*")).toBe(true);
  });
});

describe("Wallet — sha256Hex", () => {
  it("is deterministic and hex", () => {
    const a = sha256Hex("hello");
    const b = sha256Hex("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Wallet — canonicalIntentPayload", () => {
  it("is stable for the same inputs", () => {
    const intent = {
      id: "intent-1",
      query: "ship it",
      scope: "system",
      matchedCommandId: "a2a.invoke",
      inputJson: { x: 1 },
      requestedBy: "did:key:abc",
      createdAt: new Date("2026-04-23T20:00:00Z"),
      // unused fields by canonicalIntentPayload (still part of OsIntentRow):
      status: "pending" as const,
      dispatchedTarget: null,
      resultJson: null,
      errorMessage: null,
      activityId: null,
      dispatchedAt: null,
      completedAt: null,
    };
    // @ts-expect-error — canonicalIntentPayload only reads a subset
    const a = canonicalIntentPayload(intent);
    // @ts-expect-error — same call
    const b = canonicalIntentPayload(intent);
    expect(a).toBe(b);
    expect(a).toContain("intent-1");
    expect(a).toContain("ship it");
  });
});

describe("Wallet — bigOf", () => {
  it("returns 0n for null/undefined/empty", () => {
    expect(bigOf(null)).toBe(0n);
    expect(bigOf(undefined)).toBe(0n);
    expect(bigOf("")).toBe(0n);
  });

  it("parses decimal strings", () => {
    expect(bigOf("42")).toBe(42n);
    expect(bigOf("999999999999999999")).toBe(999999999999999999n);
  });
});
