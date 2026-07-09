import { describe, expect, it } from "vitest";

import {
  evictionPlan,
  type IndexCacheEntryStats,
} from "../../../workers/code_explorer/eviction";

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

function entry(
  key: string,
  lastUsedAt: number,
  bytes: number,
): IndexCacheEntryStats {
  return { key, lastUsedAt, bytes };
}

describe("evictionPlan", () => {
  it("evicts nothing when under budget and under the count cap", () => {
    expect(
      evictionPlan({
        entries: [entry("a", 1, 200 * MB), entry("b", 2, 300 * MB)],
        usedHeapBytes: 1 * GB,
        budgetBytes: 2.5 * GB,
        maxEntries: 4,
      }),
    ).toEqual([]);
  });

  it("evicts nothing when the cache is empty, even over budget", () => {
    expect(
      evictionPlan({
        entries: [],
        usedHeapBytes: 3 * GB,
        budgetBytes: 2.5 * GB,
        maxEntries: 4,
      }),
    ).toEqual([]);
  });

  it("evicts least-recently-used entries until projected heap fits the budget", () => {
    expect(
      evictionPlan({
        entries: [
          entry("newest", 30, 1 * GB),
          entry("oldest", 10, 400 * MB),
          entry("middle", 20, 500 * MB),
        ],
        usedHeapBytes: 3.2 * GB,
        budgetBytes: 2.5 * GB,
        maxEntries: 4,
      }),
      // oldest alone (400MB) leaves 2.8GB > 2.5GB; middle brings it to 2.3GB.
    ).toEqual(["oldest", "middle"]);
  });

  it("evicts everything when even that cannot reach the budget", () => {
    expect(
      evictionPlan({
        entries: [entry("a", 1, 100 * MB), entry("b", 2, 100 * MB)],
        usedHeapBytes: 4 * GB,
        budgetBytes: 2.5 * GB,
        maxEntries: 4,
      }),
    ).toEqual(["a", "b"]);
  });

  it("enforces the count cap leaving room for the incoming index", () => {
    expect(
      evictionPlan({
        entries: [
          entry("d", 4, 1 * MB),
          entry("a", 1, 1 * MB),
          entry("c", 3, 1 * MB),
          entry("b", 2, 1 * MB),
        ],
        usedHeapBytes: 100 * MB,
        budgetBytes: 2.5 * GB,
        maxEntries: 4,
      }),
    ).toEqual(["a"]);
  });

  it("applies budget and count pressure together, LRU first", () => {
    expect(
      evictionPlan({
        entries: [
          entry("big-old", 1, 2 * GB),
          entry("small-mid", 2, 10 * MB),
          entry("small-new", 3, 10 * MB),
          entry("tiny-newest", 4, 1 * MB),
        ],
        usedHeapBytes: 3 * GB,
        budgetBytes: 2.5 * GB,
        maxEntries: 3,
      }),
      // big-old satisfies the budget, but three remaining entries + the
      // incoming index still exceed the count cap of 3, so small-mid goes too.
    ).toEqual(["big-old", "small-mid"]);
  });

  it("treats zero-byte entries as evictable for count pressure without heap progress", () => {
    expect(
      evictionPlan({
        entries: [
          entry("a", 1, 0),
          entry("b", 2, 0),
          entry("c", 3, 0),
          entry("d", 4, 0),
        ],
        usedHeapBytes: 50 * MB,
        budgetBytes: 2.5 * GB,
        maxEntries: 4,
      }),
    ).toEqual(["a"]);
  });
});
