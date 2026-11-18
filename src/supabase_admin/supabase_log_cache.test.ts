import { describe, expect, it, vi } from "vitest";
import {
  COVERAGE_TTL_MS,
  PROVISIONAL_REUSE_MS,
  SupabaseLogCache,
  planFetchRanges,
  subtractRanges,
  type SupabaseLogPageFetcher,
  type SupabaseLogRow,
  type SupabaseLogScope,
} from "./supabase_log_cache";
import {
  SUPABASE_LOG_RECENT_OVERLAP_MS,
  SUPABASE_LOGS_MAX_WINDOW_MS,
} from "@/shared/supabase_edge_logs";

const MINUTE = 60_000;
// 2026-11-18T12:00:00Z, minute aligned.
const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);

const scope: SupabaseLogScope = {
  organizationSlug: "org-1",
  projectRef: "proj-1",
  source: "function_logs",
};

function row(id: string, timestamp: number, message = `msg ${id}`) {
  return {
    id,
    timestamp,
    event_message: message,
    level: "info",
  } satisfies SupabaseLogRow;
}

/**
 * Fake provider: returns rows inside [start, end), newest first, capped at
 * `limit`, the way the analytics endpoint does for minute-aligned bounds.
 */
function fakeProvider(initialRows: SupabaseLogRow[] = []) {
  const rows = [...initialRows];
  const calls: { start: number; end: number; projectRef: string }[] = [];
  const fetchPage = vi.fn<SupabaseLogPageFetcher>(
    async ({ scope: requestScope, start, end, limit }) => {
      calls.push({ start, end, projectRef: requestScope.projectRef });
      return rows
        .filter(
          (entry) =>
            entry.id.startsWith(`${requestScope.projectRef}:`) &&
            entry.timestamp >= start &&
            entry.timestamp < end,
        )
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    },
  );
  return { rows, calls, fetchPage };
}

function clock(start: number) {
  const state = { now: start };
  return { state, now: () => state.now };
}

describe("SupabaseLogCache", () => {
  it("fetches a window once, then answers from the cache", async () => {
    const provider = fakeProvider([
      row("proj-1:a", T0 + 1 * MINUTE),
      row("proj-1:b", T0 + 2 * MINUTE),
    ]);
    const time = clock(T0 + 10 * MINUTE);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: time.now,
    });

    const first = await cache.query({
      scope,
      start: T0,
      end: T0 + 5 * MINUTE,
    });
    expect(first.logs.map((entry) => entry.id)).toEqual([
      "proj-1:a",
      "proj-1:b",
    ]);
    expect(first.missingRanges).toEqual([]);
    expect(provider.fetchPage).toHaveBeenCalledTimes(1);

    // Settled range: reused well after the provisional window.
    time.state.now += 60_000;
    const second = await cache.query({
      scope,
      start: T0 + 30_000,
      end: T0 + 4 * MINUTE,
    });
    expect(second.logs.map((entry) => entry.id)).toEqual([
      "proj-1:a",
      "proj-1:b",
    ]);
    expect(second.providerRequests).toBe(0);
    expect(provider.fetchPage).toHaveBeenCalledTimes(1);
  });

  it("caches successful empty ranges", async () => {
    const provider = fakeProvider();
    const time = clock(T0 + 30 * MINUTE);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: time.now,
    });
    const first = await cache.query({ scope, start: T0, end: T0 + MINUTE });
    expect(first).toMatchObject({
      logs: [],
      missingRanges: [],
      error: null,
      truncated: false,
    });
    await cache.query({ scope, start: T0, end: T0 + MINUTE });
    expect(provider.fetchPage).toHaveBeenCalledTimes(1);
  });

  it("widens fetches to whole minutes and filters to the exact window", async () => {
    const provider = fakeProvider([
      row("proj-1:before", T0 + 10_000),
      row("proj-1:inside", T0 + 45_000),
      row("proj-1:boundary-end", T0 + 3 * MINUTE + 15_000),
      row("proj-1:after", T0 + 3 * MINUTE + 50_000),
    ]);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: () => T0 + 30 * MINUTE,
    });

    const result = await cache.query({
      scope,
      start: T0 + 30_000,
      end: T0 + 3 * MINUTE + 15_001,
    });

    expect(provider.calls).toEqual([
      { start: T0, end: T0 + 4 * MINUTE, projectRef: "proj-1" },
    ]);
    expect(result.logs.map((entry) => entry.id)).toEqual([
      "proj-1:inside",
      "proj-1:boundary-end",
    ]);
    // The widened fetch covers the rest of those minutes too.
    const widened = await cache.query({
      scope,
      start: T0,
      end: T0 + 4 * MINUTE,
    });
    expect(widened.providerRequests).toBe(0);
    expect(widened.logs).toHaveLength(4);
  });

  it("fetches only the missing part when a read extends into older history", async () => {
    const provider = fakeProvider([
      row("proj-1:old", T0 - 50 * MINUTE),
      row("proj-1:recent", T0 + MINUTE),
    ]);
    const time = clock(T0 + 30 * MINUTE);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: time.now,
    });
    await cache.query({ scope, start: T0, end: T0 + 10 * MINUTE });
    provider.calls.length = 0;

    const wider = await cache.query({
      scope,
      start: T0 - 60 * MINUTE,
      end: T0 + 10 * MINUTE,
    });

    expect(provider.calls).toEqual([
      { start: T0 - 60 * MINUTE, end: T0, projectRef: "proj-1" },
    ]);
    expect(wider.logs.map((entry) => entry.id)).toEqual([
      "proj-1:old",
      "proj-1:recent",
    ]);
  });

  it("shares one in-flight request between overlapping concurrent readers", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const provider = fakeProvider([row("proj-1:a", T0 + MINUTE)]);
    const fetchPage = vi.fn<SupabaseLogPageFetcher>(async (request) => {
      await gate;
      return provider.fetchPage(request);
    });
    const cache = new SupabaseLogCache({
      fetchPage,
      now: () => T0 + 30 * MINUTE,
    });

    const first = cache.query({ scope, start: T0, end: T0 + 10 * MINUTE });
    const second = cache.query({
      scope,
      start: T0 + MINUTE,
      end: T0 + 5 * MINUTE,
    });
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(a.logs.map((entry) => entry.id)).toEqual(["proj-1:a"]);
    expect(b.logs.map((entry) => entry.id)).toEqual(["proj-1:a"]);
    expect(b.providerRequests).toBe(0);
  });

  it("keeps a shared fetch alive until every reader cancels", async () => {
    const signals: AbortSignal[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const cache = new SupabaseLogCache({
      fetchPage: async ({ signal }) => {
        signals.push(signal);
        await gate;
        return [row("proj-1:a", T0 + MINUTE)];
      },
      now: () => T0 + 30 * MINUTE,
    });

    const cancelFirst = new AbortController();
    const first = cache.query({
      scope,
      start: T0,
      end: T0 + 10 * MINUTE,
      signal: cancelFirst.signal,
    });
    const second = cache.query({ scope, start: T0, end: T0 + 10 * MINUTE });
    cancelFirst.abort();
    await expect(first).rejects.toThrow();
    expect(signals[0].aborted).toBe(false);
    release();
    expect((await second).logs).toHaveLength(1);

    // A lone reader that cancels aborts the provider request.
    const lone = new AbortController();
    let sawAbort = false;
    const blocked = new SupabaseLogCache({
      fetchPage: ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            reject(signal.reason);
          });
        }),
      now: () => T0 + 30 * MINUTE,
    });
    const pending = blocked.query({
      scope,
      start: T0,
      end: T0 + MINUTE,
      signal: lone.signal,
    });
    lone.abort();
    await expect(pending).rejects.toThrow();
    expect(sawAbort).toBe(true);
  });

  it("refetches the provisional tail to pick up delayed arrivals", async () => {
    const now = T0 + 10 * MINUTE;
    const time = clock(now);
    const provider = fakeProvider([row("proj-1:early", T0 + MINUTE)]);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: time.now,
    });
    await cache.query({ scope, start: T0, end: now });

    // An event stamped 30s before the first read becomes visible later.
    provider.rows.push(row("proj-1:late", now - 30_000));

    // Within the reuse window the provisional tail is still served as-is.
    time.state.now = now + PROVISIONAL_REUSE_MS - 1;
    const reused = await cache.query({ scope, start: T0, end: now });
    expect(reused.providerRequests).toBe(0);
    expect(reused.logs.map((entry) => entry.id)).toEqual(["proj-1:early"]);

    time.state.now = now + 5_000;
    provider.calls.length = 0;
    const later = await cache.query({ scope, start: T0, end: time.state.now });
    expect(later.logs.map((entry) => entry.id)).toEqual([
      "proj-1:early",
      "proj-1:late",
    ]);
    // Only the provisional overlap and the new time are fetched again,
    // widened to whole minutes; settled history is not.
    expect(provider.calls).toEqual([
      {
        start: now - SUPABASE_LOG_RECENT_OVERLAP_MS,
        end: now + MINUTE,
        projectRef: "proj-1",
      },
    ]);
  });

  it("deduplicates by provider log id and keeps distinct identical events", async () => {
    const provider = fakeProvider([
      row("proj-1:a", T0 + MINUTE, "same message"),
      row("proj-1:b", T0 + MINUTE, "same message"),
    ]);
    const time = clock(T0 + 3 * MINUTE);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: time.now,
    });
    await cache.query({ scope, start: T0, end: T0 + 3 * MINUTE });
    time.state.now += 10_000;
    // The overlapping refetch returns both rows again.
    const result = await cache.query({
      scope,
      start: T0,
      end: time.state.now,
    });
    expect(provider.fetchPage).toHaveBeenCalledTimes(2);
    expect(result.logs.map((entry) => entry.id)).toEqual([
      "proj-1:a",
      "proj-1:b",
    ]);
  });

  it("pages backwards newest first when a page is capped", async () => {
    const rows = [0, 1, 2, 3, 4, 5].map((minute) =>
      row(`proj-1:${minute}`, T0 + minute * MINUTE + 1_000),
    );
    const provider = fakeProvider(rows);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: () => T0 + 30 * MINUTE,
      pageSize: 2,
      // Each page re-reads its oldest row's minute, so six rows spread over
      // six minutes need six pages before a short page proves completeness.
      maxPagesPerRange: 6,
    });

    const result = await cache.query({
      scope,
      start: T0,
      end: T0 + 10 * MINUTE,
    });

    expect(result.logs.map((entry) => entry.id)).toEqual(
      rows.map((entry) => entry.id),
    );
    expect(result.missingRanges).toEqual([]);
    expect(result.truncated).toBe(false);
    // First page holds the newest rows; later pages move the end backwards.
    expect(provider.calls[0]).toMatchObject({
      start: T0,
      end: T0 + 10 * MINUTE,
    });
    expect(provider.calls[1].end).toBeLessThan(provider.calls[0].end);
  });

  it("reports truncation instead of treating a capped response as complete", async () => {
    // Five rows in one minute, two rows per page: paging cannot progress.
    const rows = [1, 2, 3, 4, 5].map((second) =>
      row(`proj-1:${second}`, T0 + second * 1_000),
    );
    const provider = fakeProvider(rows);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: () => T0 + 30 * MINUTE,
      pageSize: 2,
    });

    const result = await cache.query({ scope, start: T0, end: T0 + MINUTE });

    expect(result.truncated).toBe(true);
    expect(result.error).toBeNull();
    // The two newest rows are known complete; everything older is missing.
    expect(result.logs.map((entry) => entry.id)).toEqual([
      "proj-1:4",
      "proj-1:5",
    ]);
    expect(result.missingRanges).toEqual([{ start: T0, end: T0 + 4_000 + 1 }]);

    // The incomplete part is fetched again rather than served as complete.
    provider.calls.length = 0;
    await cache.query({ scope, start: T0, end: T0 + MINUTE });
    expect(provider.calls).toHaveLength(1);
  });

  it("reports provider failures without caching them as coverage", async () => {
    let fail = true;
    const provider = fakeProvider([row("proj-1:a", T0 + MINUTE)]);
    const cache = new SupabaseLogCache({
      fetchPage: async (request) => {
        if (fail) throw new Error("Supabase is down");
        return provider.fetchPage(request);
      },
      now: () => T0 + 30 * MINUTE,
    });

    const failed = await cache.query({
      scope,
      start: T0,
      end: T0 + MINUTE * 5,
    });
    expect(failed.logs).toEqual([]);
    expect(failed.error).toBeInstanceOf(Error);
    expect(failed.missingRanges).toEqual([{ start: T0, end: T0 + 5 * MINUTE }]);

    fail = false;
    const recovered = await cache.query({
      scope,
      start: T0,
      end: T0 + 5 * MINUTE,
    });
    expect(recovered.error).toBeNull();
    expect(recovered.logs.map((entry) => entry.id)).toEqual(["proj-1:a"]);
  });

  it("times out a stalled provider request", async () => {
    const cache = new SupabaseLogCache({
      fetchPage: () => new Promise(() => {}),
      now: () => T0 + 30 * MINUTE,
      rangeFetchDeadlineMs: 20,
    });
    const result = await cache.query({ scope, start: T0, end: T0 + MINUTE });
    expect(result.missingRanges).toHaveLength(1);
    expect(String(result.error)).toContain("did not return logs");
  });

  it("expires coverage together with its rows", async () => {
    const provider = fakeProvider([row("proj-1:a", T0 + MINUTE)]);
    const time = clock(T0 + 10 * MINUTE);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: time.now,
    });
    await cache.query({ scope, start: T0, end: T0 + 5 * MINUTE });
    expect(cache.stats().logs).toBe(1);

    time.state.now += COVERAGE_TTL_MS + 1;
    provider.rows.length = 0;
    // A different window triggers expiry without refetching the old one.
    await cache.query({
      scope,
      start: time.state.now - MINUTE,
      end: time.state.now,
    });
    expect(cache.stats().logs).toBe(0);
    const refetched = await cache.query({
      scope,
      start: T0,
      end: T0 + 5 * MINUTE,
    });
    expect(refetched.providerRequests).toBe(1);
    expect(refetched.logs).toEqual([]);
  });

  it("isolates projects and organizations", async () => {
    const provider = fakeProvider([
      row("proj-1:a", T0 + MINUTE),
      row("proj-2:b", T0 + MINUTE),
    ]);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: () => T0 + 30 * MINUTE,
    });
    const one = await cache.query({ scope, start: T0, end: T0 + 5 * MINUTE });
    const two = await cache.query({
      scope: { ...scope, projectRef: "proj-2" },
      start: T0,
      end: T0 + 5 * MINUTE,
    });
    const otherOrg = await cache.query({
      scope: { ...scope, organizationSlug: "org-2" },
      start: T0,
      end: T0 + 5 * MINUTE,
    });
    expect(one.logs.map((entry) => entry.id)).toEqual(["proj-1:a"]);
    expect(two.logs.map((entry) => entry.id)).toEqual(["proj-2:b"]);
    // Same project under another account context is fetched separately.
    expect(otherOrg.providerRequests).toBe(1);
    expect(provider.fetchPage).toHaveBeenCalledTimes(3);

    cache.clear((candidate) => candidate.organizationSlug === "org-2");
    expect(cache.stats().scopes).toBe(2);
  });

  it("evicts least recently used scopes and bounds rows per scope", async () => {
    const provider = fakeProvider([
      ...Array.from({ length: 6 }, (_, index) =>
        row(`proj-1:${index}`, T0 + index * MINUTE),
      ),
      row("proj-2:a", T0 + MINUTE),
      row("proj-3:a", T0 + MINUTE),
    ]);
    const time = clock(T0 + 30 * MINUTE);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: time.now,
      maxScopes: 2,
      maxLogsPerScope: 4,
    });

    const wide = await cache.query({ scope, start: T0, end: T0 + 10 * MINUTE });
    // The caller still gets everything it read; the cache keeps the newest.
    expect(wide.logs).toHaveLength(6);
    expect(cache.stats().logs).toBe(4);

    // Trimmed rows took their coverage with them, so they are refetched.
    provider.calls.length = 0;
    const oldest = await cache.query({ scope, start: T0, end: T0 + MINUTE });
    expect(provider.calls).toHaveLength(1);
    expect(oldest.logs.map((entry) => entry.id)).toEqual(["proj-1:0"]);

    await cache.query({
      scope: { ...scope, projectRef: "proj-2" },
      start: T0,
      end: T0 + 5 * MINUTE,
    });
    await cache.query({
      scope: { ...scope, projectRef: "proj-3" },
      start: T0,
      end: T0 + 5 * MINUTE,
    });
    expect(cache.stats().scopes).toBe(2);

    // proj-1 was least recently used, so it was evicted.
    provider.calls.length = 0;
    await cache.query({ scope, start: T0, end: T0 + MINUTE });
    expect(provider.calls).toHaveLength(1);
  });

  it("bounds total cached message size", async () => {
    const provider = fakeProvider(
      Array.from({ length: 5 }, (_, index) =>
        row(`proj-1:${index}`, T0 + index * MINUTE, "x".repeat(100)),
      ),
    );
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: () => T0 + 30 * MINUTE,
      maxTotalMessageChars: 250,
    });
    const result = await cache.query({
      scope,
      start: T0,
      end: T0 + 10 * MINUTE,
    });
    expect(result.logs).toHaveLength(5);
    expect(cache.stats().messageChars).toBeLessThanOrEqual(250);
    expect(cache.stats().logs).toBe(2);
  });
});

describe("range helpers", () => {
  it("subtracts covered ranges", () => {
    expect(
      subtractRanges(
        [{ start: 0, end: 100 }],
        [
          { start: 10, end: 20 },
          { start: 15, end: 30 },
          { start: 90, end: 120 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 10 },
      { start: 30, end: 90 },
    ]);
  });

  it("splits requests to fit the provider window after minute widening", () => {
    const start = T0 + 30_000;
    const ranges = planFetchRanges([
      { start, end: start + SUPABASE_LOGS_MAX_WINDOW_MS },
    ]);
    expect(ranges).toHaveLength(2);
    for (const range of ranges) {
      const alignedSpan =
        Math.ceil(range.end / MINUTE) * MINUTE -
        Math.floor(range.start / MINUTE) * MINUTE;
      expect(alignedSpan).toBeLessThanOrEqual(SUPABASE_LOGS_MAX_WINDOW_MS);
    }
    // Newest first.
    expect(ranges[0].start).toBeGreaterThan(ranges[1].start);
  });

  it("coalesces nearby gaps and caps the number of requests", () => {
    const gaps = Array.from({ length: 8 }, (_, index) => ({
      start: T0 + index * 20 * MINUTE,
      end: T0 + index * 20 * MINUTE + MINUTE,
    }));
    expect(planFetchRanges(gaps).length).toBeLessThanOrEqual(4);
    expect(
      planFetchRanges([
        { start: T0, end: T0 + MINUTE },
        { start: T0 + 2 * MINUTE, end: T0 + 3 * MINUTE },
      ]),
    ).toEqual([{ start: T0, end: T0 + 3 * MINUTE }]);
  });
});
