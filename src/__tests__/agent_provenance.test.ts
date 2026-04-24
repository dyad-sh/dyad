/**
 * Unit tests for the Agent Provenance & Reputation engine's pure helpers.
 */

import { describe, it, expect } from "vitest";

import { __test__ } from "@/lib/agent_provenance";

const { sha256Hex, canonicalEvent, bigOf } = __test__;

describe("Provenance — sha256Hex", () => {
  it("is deterministic and matches the hex shape", () => {
    expect(sha256Hex("payload")).toBe(sha256Hex("payload"));
    expect(sha256Hex("payload")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});

describe("Provenance — canonicalEvent", () => {
  it("yields stable JSON for the same logical event", () => {
    const ts = new Date("2026-04-23T20:00:00Z");
    const a = canonicalEvent({
      kind: "a2a.contract.settled",
      principalDid: "did:key:abc",
      subjectRef: "contract-1",
      payload: { amount: "100", currency: "JOY" },
      createdAt: ts,
    });
    const b = canonicalEvent({
      kind: "a2a.contract.settled",
      principalDid: "did:key:abc",
      subjectRef: "contract-1",
      payload: { amount: "100", currency: "JOY" },
      createdAt: ts,
    });
    expect(a).toBe(b);
    expect(a).toContain("provenance.event.v1");
    expect(a).toContain("contract-1");
  });

  it("changes when any field changes", () => {
    const ts = new Date("2026-04-23T20:00:00Z");
    const base = {
      kind: "a2a.contract.settled" as const,
      principalDid: "did:key:abc",
      subjectRef: "contract-1",
      payload: { amount: "100" },
      createdAt: ts,
    };
    expect(canonicalEvent(base)).not.toBe(
      canonicalEvent({ ...base, principalDid: "did:key:xyz" }),
    );
    expect(canonicalEvent(base)).not.toBe(
      canonicalEvent({ ...base, payload: { amount: "101" } }),
    );
  });
});

describe("Provenance — bigOf", () => {
  it("handles null/undefined/empty as zero", () => {
    expect(bigOf(null)).toBe(0n);
    expect(bigOf(undefined)).toBe(0n);
    expect(bigOf("")).toBe(0n);
  });

  it("parses decimal strings", () => {
    expect(bigOf("12345678901234567890")).toBe(12345678901234567890n);
  });
});
