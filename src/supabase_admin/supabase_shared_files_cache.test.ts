import { describe, expect, it } from "vitest";
import { SupabaseSharedFilesCache } from "./supabase_shared_files_cache";

function value(signature: string, byteSize: number) {
  return { signature, byteSize, files: [signature] };
}

describe("SupabaseSharedFilesCache", () => {
  it("evicts least-recently-used entries to stay within its byte budget", () => {
    const cache = new SupabaseSharedFilesCache<string>({
      maxBytes: 12,
      maxEntries: 3,
      ttlMs: 1_000,
    });

    cache.set("a", value("a1", 5));
    cache.set("b", value("b1", 5));
    expect(cache.get("a", "a1")).toBeDefined();
    cache.set("c", value("c1", 5));

    expect(cache.get("a", "a1")).toBeDefined();
    expect(cache.get("b", "b1")).toBeUndefined();
    expect(cache.get("c", "c1")).toBeDefined();
    expect(cache.getStats()).toMatchObject({ entries: 2, totalBytes: 10 });
  });

  it("invalidates cached buffers when the source signature changes", () => {
    const cache = new SupabaseSharedFilesCache<string>({
      maxBytes: 100,
      maxEntries: 3,
      ttlMs: 1_000,
    });
    cache.set("source", value("old", 40));

    expect(cache.get("source", "new")).toBeUndefined();
    expect(cache.getStats()).toEqual({
      entries: 0,
      totalBytes: 0,
      keys: [],
    });
  });

  it("expires entries and does not retain values larger than the cache", () => {
    let now = 0;
    const cache = new SupabaseSharedFilesCache<string>({
      maxBytes: 10,
      maxEntries: 2,
      ttlMs: 100,
      now: () => now,
    });

    const oversized = value("large", 11);
    expect(cache.set("large", oversized)).toBe(oversized);
    expect(cache.getStats().entries).toBe(0);

    cache.set("small", value("small", 5));
    now = 101;
    expect(cache.get("small", "small")).toBeUndefined();
    expect(cache.getStats().totalBytes).toBe(0);
  });
});
