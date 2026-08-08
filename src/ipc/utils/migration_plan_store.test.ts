import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLAN_TTL_MS,
  __resetForTests,
  deletePreview,
  peekPreview,
  storePreview,
} from "./migration_plan_store";

const target = (
  overrides: Partial<{
    projectId: string;
    prodBranchId: string;
    prodUpdatedAt: string;
  }> = {},
) => ({
  projectId: "proj-1",
  prodBranchId: "br-prod",
  prodUpdatedAt: "2026-04-01T00:00:00Z",
  ...overrides,
});

beforeEach(() => {
  __resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("migration_plan_store", () => {
  it("stores statements and returns a UUID-shaped id", () => {
    const id = storePreview(42, ["CREATE TABLE x (id int)"], target());
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("peekPreview returns the plan without removing it (retry-safe)", () => {
    const t = target({ prodBranchId: "br-prod-5" });
    const id = storePreview(5, ["DROP TABLE x"], t);

    expect(peekPreview(id)).toEqual({
      appId: 5,
      statements: ["DROP TABLE x"],
      target: t,
    });
    expect(peekPreview(id)).toEqual({
      appId: 5,
      statements: ["DROP TABLE x"],
      target: t,
    });

    deletePreview(id);
    expect(peekPreview(id)).toBeNull();
  });

  it("peekPreview returns null and evicts past TTL", () => {
    vi.useFakeTimers();
    const id = storePreview(8, ["SELECT 1"], target());

    vi.advanceTimersByTime(PLAN_TTL_MS + 1);

    expect(peekPreview(id)).toBeNull();
    // Confirm the expired entry was evicted.
    expect(peekPreview(id)).toBeNull();
  });

  it("storing a new plan for the same appId evicts the prior plan", () => {
    const oldId = storePreview(99, ["SELECT 'old'"], target());
    const newTarget = target({ prodUpdatedAt: "2026-04-02T00:00:00Z" });
    const newId = storePreview(99, ["SELECT 'new'"], newTarget);

    expect(oldId).not.toBe(newId);
    expect(peekPreview(oldId)).toBeNull();
    expect(peekPreview(newId)).toEqual({
      appId: 99,
      statements: ["SELECT 'new'"],
      target: newTarget,
    });
  });

  it("peekPreview with unknown id returns null", () => {
    expect(peekPreview("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("plans are isolated per appId", () => {
    const targetA = target({ projectId: "proj-a" });
    const targetB = target({ projectId: "proj-b" });
    const idA = storePreview(1, ["SELECT 'a'"], targetA);
    const idB = storePreview(2, ["SELECT 'b'"], targetB);

    expect(peekPreview(idA)).toEqual({
      appId: 1,
      statements: ["SELECT 'a'"],
      target: targetA,
    });
    expect(peekPreview(idB)).toEqual({
      appId: 2,
      statements: ["SELECT 'b'"],
      target: targetB,
    });
  });

  it("deletePreview removes the plan", () => {
    const id = storePreview(11, ["TRUNCATE x"], target());

    deletePreview(id);

    expect(peekPreview(id)).toBeNull();
  });

  it("deletePreview is a no-op for unknown ids", () => {
    expect(() =>
      deletePreview("00000000-0000-0000-0000-000000000000"),
    ).not.toThrow();
  });
});
