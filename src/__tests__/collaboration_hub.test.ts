/**
 * Unit tests for the Collaboration Hub IPC handlers' pure validation +
 * transition logic.
 *
 * The actual handlers touch SQLite/Electron, so we restrict these tests to the
 * `__test__` bag exported from the handler module, which contains the pure
 * helpers that do runtime validation and lifecycle gating. This keeps tests
 * fast and lets us prove the trickiest new logic (transition graph, enum
 * guards) without standing up the full stack.
 */

import { describe, it, expect } from "vitest";

import { __test__ } from "@/ipc/handlers/collaboration_hub_handlers";

const {
  CHANNEL_VISIBILITIES,
  MESSAGE_KINDS,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_TRANSITIONS,
  assertOneOf,
  isAllowedTaskTransition,
} = __test__;

describe("Collab Hub — enum sets stay in sync with the schema", () => {
  it("channel visibilities", () => {
    expect(CHANNEL_VISIBILITIES).toEqual(["public", "private"]);
  });

  it("message kinds", () => {
    expect(MESSAGE_KINDS).toEqual(["chat", "handoff", "result", "system", "mention"]);
  });

  it("task statuses", () => {
    expect(TASK_STATUSES).toEqual([
      "pending",
      "accepted",
      "in_progress",
      "done",
      "rejected",
      "cancelled",
    ]);
  });

  it("task priorities", () => {
    expect(TASK_PRIORITIES).toEqual(["low", "normal", "high", "urgent"]);
  });
});

describe("Collab Hub — assertOneOf runtime validator", () => {
  it("accepts a value present in the allow-list", () => {
    expect(() => assertOneOf("public", CHANNEL_VISIBILITIES, "visibility")).not.toThrow();
    expect(() => assertOneOf("urgent", TASK_PRIORITIES, "priority")).not.toThrow();
    expect(() => assertOneOf("handoff", MESSAGE_KINDS, "kind")).not.toThrow();
  });

  it("rejects a value not in the allow-list with a descriptive error", () => {
    expect(() => assertOneOf("rainbow", CHANNEL_VISIBILITIES, "visibility")).toThrow(
      /invalid visibility.*expected one of public, private/,
    );
  });

  it("rejects non-string values (e.g., null, number, object)", () => {
    expect(() => assertOneOf(null, TASK_STATUSES, "status")).toThrow(/invalid status/);
    expect(() => assertOneOf(42, TASK_STATUSES, "status")).toThrow(/invalid status/);
    expect(() => assertOneOf({ status: "done" }, TASK_STATUSES, "status")).toThrow(
      /invalid status/,
    );
  });
});

describe("Collab Hub — task transition graph", () => {
  it("pending → {accepted, rejected, cancelled} are allowed", () => {
    expect(isAllowedTaskTransition("pending", "accepted")).toBe(true);
    expect(isAllowedTaskTransition("pending", "rejected")).toBe(true);
    expect(isAllowedTaskTransition("pending", "cancelled")).toBe(true);
  });

  it("pending → in_progress / done are NOT allowed (must accept first)", () => {
    expect(isAllowedTaskTransition("pending", "in_progress")).toBe(false);
    expect(isAllowedTaskTransition("pending", "done")).toBe(false);
  });

  it("accepted → {in_progress, done, rejected, cancelled} are allowed", () => {
    expect(isAllowedTaskTransition("accepted", "in_progress")).toBe(true);
    expect(isAllowedTaskTransition("accepted", "done")).toBe(true);
    expect(isAllowedTaskTransition("accepted", "rejected")).toBe(true);
    expect(isAllowedTaskTransition("accepted", "cancelled")).toBe(true);
  });

  it("accepted → pending is NOT allowed (no rewinds)", () => {
    expect(isAllowedTaskTransition("accepted", "pending")).toBe(false);
  });

  it("in_progress → {done, rejected, cancelled} are allowed", () => {
    expect(isAllowedTaskTransition("in_progress", "done")).toBe(true);
    expect(isAllowedTaskTransition("in_progress", "rejected")).toBe(true);
    expect(isAllowedTaskTransition("in_progress", "cancelled")).toBe(true);
  });

  it("in_progress → {pending, accepted} are NOT allowed", () => {
    expect(isAllowedTaskTransition("in_progress", "pending")).toBe(false);
    expect(isAllowedTaskTransition("in_progress", "accepted")).toBe(false);
  });

  it("terminal states (done / rejected / cancelled) cannot transition to anything else", () => {
    const terminals = ["done", "rejected", "cancelled"] as const;
    for (const from of terminals) {
      for (const to of TASK_STATUSES) {
        if (to === from) continue; // no-op is always allowed
        expect(
          isAllowedTaskTransition(from, to),
          `expected ${from} → ${to} to be forbidden`,
        ).toBe(false);
      }
      // Each terminal state has an empty allow-list in the table.
      expect(TASK_TRANSITIONS[from]).toEqual([]);
    }
  });

  it("same-status transitions are allowed (no-op for re-emitting output)", () => {
    for (const s of TASK_STATUSES) {
      expect(isAllowedTaskTransition(s, s), `same-status ${s}→${s} should be allowed`).toBe(
        true,
      );
    }
  });
});
