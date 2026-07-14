import { describe, expect, it } from "vitest";
import type { TestResult } from "@/ipc/types/tests";
import {
  normalizeFailureSignature,
  stripDynamic,
} from "./test_failure_signature";

describe("stripDynamic", () => {
  it("removes durations, ports, hex ids, and timestamps", () => {
    const a = stripDynamic(
      "timeout of 5000ms at http://localhost:52344 run 9f8a1c2b3d4e at 2026-07-09T12:00:00Z",
    );
    const b = stripDynamic(
      "timeout of 3000ms at http://localhost:41022 run 0011aabbccdd at 2026-07-10T09:30:15Z",
    );
    expect(a).toBe(b);
  });

  it("strips ANSI color codes", () => {
    expect(stripDynamic("[31mError[0m: boom")).toBe("Error: boom");
  });

  it("normalizes generated UUIDs (short middle segments included)", () => {
    const a = stripDynamic("row 123e4567-e89b-12d3-a456-426614174000 missing");
    const b = stripDynamic("row 9b2fa0ee-1c2d-4e3f-8a4b-5c6d7e8f9a0b missing");
    expect(a).toBe(b);
    expect(a).toContain("<uuid>");
  });
});

describe("normalizeFailureSignature", () => {
  const failing = (title: string, error: string): TestResult => ({
    file: "tests/a.spec.ts",
    status: "failed",
    tests: [{ title, status: "failed", error }],
  });

  it("is stable across runs that differ only in dynamic values", () => {
    const run1 = [
      failing("logs in", "expected visible, waited 5000ms on :3000"),
    ];
    const run2 = [
      failing("logs in", "expected visible, waited 8000ms on :4100"),
    ];
    expect(normalizeFailureSignature(run1)).toBe(
      normalizeFailureSignature(run2),
    );
  });

  it("changes when a different test fails", () => {
    const run1 = [failing("logs in", "boom")];
    const run2 = [failing("signs up", "boom")];
    expect(normalizeFailureSignature(run1)).not.toBe(
      normalizeFailureSignature(run2),
    );
  });

  it("is order-independent", () => {
    const a: TestResult = {
      file: "tests/a.spec.ts",
      status: "failed",
      tests: [
        { title: "t1", status: "failed", error: "e1" },
        { title: "t2", status: "failed", error: "e2" },
      ],
    };
    const b: TestResult = {
      file: "tests/a.spec.ts",
      status: "failed",
      tests: [
        { title: "t2", status: "failed", error: "e2" },
        { title: "t1", status: "failed", error: "e1" },
      ],
    };
    expect(normalizeFailureSignature([a])).toBe(normalizeFailureSignature([b]));
  });

  it("ignores passing tests", () => {
    const result: TestResult = {
      file: "tests/a.spec.ts",
      status: "failed",
      tests: [
        { title: "passes", status: "passed" },
        { title: "fails", status: "failed", error: "boom" },
      ],
    };
    expect(normalizeFailureSignature([result])).toContain("fails");
    expect(normalizeFailureSignature([result])).not.toContain("passes");
  });
});
