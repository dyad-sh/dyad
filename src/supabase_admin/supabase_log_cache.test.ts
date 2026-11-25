import { describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
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

/** A provider row visible only to one organization's credentials. */
type FakeRow = SupabaseLogRow & { organizationSlug?: string };

/**
 * Fake provider: returns rows inside [start, end), newest first, capped at
 * `limit`, the way the analytics endpoint does for minute-aligned bounds.
 * Rows belong to the project named by their id prefix and, unless tagged
 * otherwise, to the default scope's organization.
 */
function fakeProvider(initialRows: FakeRow[] = []) {
  const rows = [...initialRows];
  const calls: { start: number; end: number; projectRef: string }[] = [];
  const fetchPage = vi.fn<SupabaseLogPageFetcher>(
    async ({ scope: requestScope, start, end, limit }) => {
      calls.push({ start, end, projectRef: requestScope.projectRef });
      return rows
        .filter(
          (entry) =>
            entry.id.startsWith(`${requestScope.projectRef}:`) &&
            (entry.organizationSlug ?? scope.organizationSlug) ===
              requestScope.organizationSlug &&
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

    // Settled history remains reusable on later reads.
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

  it("keeps successful empty ranges cached across days", async () => {
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
    time.state.now += 24 * 60 * MINUTE;
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

  it("shares a recent in-flight fetch even when readers start at different times", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const provider = fakeProvider([row("proj-1:a", T0 + 9 * MINUTE)]);
    const time = clock(T0 + 10 * MINUTE);
    const fetchPage = vi.fn<SupabaseLogPageFetcher>(async (request) => {
      await gate;
      return provider.fetchPage(request);
    });
    const cache = new SupabaseLogCache({
      fetchPage,
      now: time.now,
    });

    const first = cache.query({ scope, start: T0, end: T0 + 10 * MINUTE });
    time.state.now += 5_000;
    const second = cache.query({
      scope,
      start: T0 + 8 * MINUTE,
      end: T0 + 10 * MINUTE,
    });
    time.state.now += 5_000;
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(a.logs.map((entry) => entry.id)).toEqual(["proj-1:a"]);
    expect(b.logs.map((entry) => entry.id)).toEqual(["proj-1:a"]);
    expect(b.providerRequests).toBe(0);
    expect(a.missingRanges).toEqual([]);
    expect(b.missingRanges).toEqual([]);
  });

  it("accepts newer concurrent coverage where minute-rounded fetches overlap", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const now = T0 + 10 * MINUTE;
    const provider = fakeProvider([row("proj-1:recent", now - 45_000)]);
    const fetchPage = vi.fn<SupabaseLogPageFetcher>(async (request) => {
      if (request.start === T0) await gate;
      return provider.fetchPage(request);
    });
    const cache = new SupabaseLogCache({ fetchPage, now: () => now });

    const first = cache.query({ scope, start: T0, end: now - 30_000 });
    // The logical windows are disjoint, but both fetches include the last
    // minute. Let the newer fetch finish before the older one.
    const second = await cache.query({
      scope,
      start: now - 20_000,
      end: now,
    });
    release();
    const result = await first;

    expect(result.logs.map((entry) => entry.id)).toEqual(["proj-1:recent"]);
    expect(result.missingRanges).toEqual([]);
    expect(second.missingRanges).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
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

  it.each([0, 1_000, 5_000])(
    "refetches the provisional tail on a new read after %i ms",
    async (elapsed) => {
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

      time.state.now += elapsed;
      provider.calls.length = 0;
      const later = await cache.query({ scope, start: T0, end: now });
      expect(later.providerRequests).toBe(1);
      expect(later.missingRanges).toEqual([]);
      expect(later.logs.map((entry) => entry.id)).toEqual([
        "proj-1:early",
        "proj-1:late",
      ]);
      // Only the provisional overlap is fetched again; settled history is not.
      expect(provider.calls).toEqual([
        {
          start: now - SUPABASE_LOG_RECENT_OVERLAP_MS,
          end: now,
          projectRef: "proj-1",
        },
      ]);
    },
  );

  it("refreshes provisional coverage before reusing it as settled history", async () => {
    const now = T0 + 10 * MINUTE;
    const time = clock(now);
    const provider = fakeProvider();
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: time.now,
    });
    await cache.query({ scope, start: T0, end: now });

    time.state.now += 3 * MINUTE;
    provider.rows.push(row("proj-1:late", now - 30_000));
    const refreshed = await cache.query({ scope, start: T0, end: now });
    expect(refreshed.providerRequests).toBe(1);
    expect(refreshed.missingRanges).toEqual([]);
    expect(refreshed.logs.map((entry) => entry.id)).toEqual(["proj-1:late"]);

    const settled = await cache.query({ scope, start: T0, end: now });
    expect(settled.providerRequests).toBe(0);
    expect(settled.logs).toEqual(refreshed.logs);
  });

  it("reports a failed recent refresh while retaining previously fetched logs", async () => {
    const now = T0 + 10 * MINUTE;
    const provider = fakeProvider([row("proj-1:recent", now - 30_000)]);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: () => now,
    });
    const first = await cache.query({ scope, start: T0, end: now });
    const error = new Error("Supabase is down");
    provider.fetchPage.mockRejectedValueOnce(error);

    const failed = await cache.query({ scope, start: T0, end: now });
    expect(failed.logs).toEqual(first.logs);
    expect(failed.error).toBe(error);
    expect(failed.missingRanges).toEqual([
      { start: now - SUPABASE_LOG_RECENT_OVERLAP_MS, end: now },
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

  it("retains settled coverage and its rows across days until cleared", async () => {
    const provider = fakeProvider([row("proj-1:a", T0 + MINUTE)]);
    const time = clock(T0 + 10 * MINUTE);
    const cache = new SupabaseLogCache({
      fetchPage: provider.fetchPage,
      now: time.now,
    });
    const first = await cache.query({ scope, start: T0, end: T0 + 5 * MINUTE });
    expect(cache.stats().logs).toBe(1);

    time.state.now += 24 * 60 * MINUTE;
    provider.rows.length = 0;
    // Fetching a new window must not discard previously cached history.
    await cache.query({
      scope,
      start: time.state.now - MINUTE,
      end: time.state.now,
    });
    expect(cache.stats().logs).toBe(1);
    const cached = await cache.query({
      scope,
      start: T0,
      end: T0 + 5 * MINUTE,
    });
    expect(cached.providerRequests).toBe(0);
    expect(cached.missingRanges).toEqual([]);
    expect(cached.logs).toEqual(first.logs);

    cache.clear();
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
      { ...row("proj-1:org-2", T0 + 2 * MINUTE), organizationSlug: "org-2" },
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
    // Same project under another account context is fetched separately and
    // never sees the first organization's rows.
    expect(otherOrg.providerRequests).toBe(1);
    expect(otherOrg.logs.map((entry) => entry.id)).toEqual(["proj-1:org-2"]);
    expect(provider.fetchPage).toHaveBeenCalledTimes(3);
    const oneAgain = await cache.query({
      scope,
      start: T0,
      end: T0 + 5 * MINUTE,
    });
    expect(oneAgain.providerRequests).toBe(0);
    expect(oneAgain.logs.map((entry) => entry.id)).toEqual(["proj-1:a"]);

    cache.clear((candidate) => candidate.organizationSlug === "org-2");
    expect(cache.stats().scopes).toBe(2);
  });

  it.each([false, true])(
    "cancels cleared scopes without delivering old results (response already resolved: %s)",
    async (resolveBeforeClear) => {
      const pending: {
        signal: AbortSignal;
        resolve: (rows: SupabaseLogRow[]) => void;
      }[] = [];
      const fetchPage = vi.fn<SupabaseLogPageFetcher>(
        ({ signal }) =>
          new Promise((resolve) => pending.push({ signal, resolve })),
      );
      fetchPage.mockResolvedValueOnce([row("cached", T0 + 1_000)]);
      const cache = new SupabaseLogCache({
        fetchPage,
        now: () => T0 + 30 * MINUTE,
      });
      await cache.query({ scope, start: T0, end: T0 + MINUTE });

      const request = { scope, start: T0, end: T0 + 3 * MINUTE };
      const first = cache.query(request);
      const second = cache.query(request);
      const other = cache.query({
        ...request,
        scope: { ...scope, organizationSlug: "other-org" },
      });
      expect(pending).toHaveLength(2);
      const readers = Promise.allSettled([first, second]);
      if (resolveBeforeClear)
        pending[0].resolve([row("stale", T0 + 2 * MINUTE)]);

      cache.clear(
        (candidate) => candidate.organizationSlug === scope.organizationSlug,
      );
      expect(pending[0].signal.aborted).toBe(true);
      expect(pending[1].signal.aborted).toBe(false);
      for (const result of await readers) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(result.reason).toMatchObject({
            kind: DyadErrorKind.UserCancelled,
          });
        }
      }
      // Clearing must not launch a retry with the disconnected credentials.
      expect(fetchPage).toHaveBeenCalledTimes(3);

      // A new scope with the same key must remain independent of the old fetch.
      fetchPage.mockResolvedValueOnce([row("fresh", T0 + 2 * MINUTE)]);
      const fresh = await cache.query(request);
      expect(fresh.logs.map((log) => log.id)).toEqual(["fresh"]);
      pending[0].resolve([row("stale", T0 + 2 * MINUTE)]);
      pending[1].resolve([row("other", T0 + 2 * MINUTE)]);
      expect((await other).logs.map((log) => log.id)).toEqual(["other"]);
      expect((await cache.query(request)).logs.map((log) => log.id)).toEqual([
        "fresh",
      ]);
      expect(cache.stats().logs).toBe(2);
    },
  );

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

  it("keeps a scope with fetches in flight cancellable instead of evicting it", async () => {
    const pending: {
      signal: AbortSignal;
      resolve: (rows: SupabaseLogRow[]) => void;
    }[] = [];
    const fetchPage = vi.fn<SupabaseLogPageFetcher>(
      ({ scope: requestScope, signal }) =>
        requestScope.organizationSlug === scope.organizationSlug
          ? new Promise((resolve) => pending.push({ signal, resolve }))
          : Promise.resolve([row("proj-1:other", T0 + 1_000)]),
    );
    const cache = new SupabaseLogCache({
      fetchPage,
      now: () => T0 + 30 * MINUTE,
      maxScopes: 1,
    });

    const busy = cache.query({ scope, start: T0, end: T0 + MINUTE });
    await cache.query({
      scope: { ...scope, organizationSlug: "org-2" },
      start: T0,
      end: T0 + MINUTE,
    });
    // Over the scope limit, but the busy scope stays reachable by clear().
    expect(cache.stats().scopes).toBe(2);
    cache.clear(
      (candidate) => candidate.organizationSlug === scope.organizationSlug,
    );
    expect(pending[0].signal.aborted).toBe(true);
    await expect(busy).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });

    // Once its read finishes, the limit applies to idle scopes again.
    const next = cache.query({ scope, start: T0, end: T0 + MINUTE });
    pending[1].resolve([row("proj-1:a", T0 + 1_000)]);
    expect((await next).logs.map((entry) => entry.id)).toEqual(["proj-1:a"]);
    expect(cache.stats().scopes).toBe(1);
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

  it("enforces bounds when a reader cancels after pages were cached", async () => {
    let olderPageRequested!: () => void;
    const olderPage = new Promise<void>((resolve) => {
      olderPageRequested = resolve;
    });
    const fetchPage = vi.fn<SupabaseLogPageFetcher>(
      async ({ scope: requestScope, end, signal }) => {
        if (requestScope.projectRef === "proj-2") {
          return [row("proj-2:a", T0 + 1_000, "y".repeat(100))];
        }
        if (end === T0 + 10 * MINUTE) {
          // A capped newest page, so the fetch pages backwards.
          return [
            row("proj-1:b", T0 + 9 * MINUTE, "x".repeat(100)),
            row("proj-1:a", T0 + 8 * MINUTE, "x".repeat(100)),
          ];
        }
        // The older page stalls until its only reader cancels.
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          olderPageRequested();
        });
      },
    );
    const cache = new SupabaseLogCache({
      fetchPage,
      now: () => T0 + 30 * MINUTE,
      pageSize: 2,
      maxTotalMessageChars: 150,
    });

    const cancel = new AbortController();
    const busy = cache.query({
      scope,
      start: T0,
      end: T0 + 10 * MINUTE,
      signal: cancel.signal,
    });
    await olderPage;
    // The busy scope cannot be evicted, so this read leaves its overflow to it.
    await cache.query({
      scope: { ...scope, projectRef: "proj-2" },
      start: T0,
      end: T0 + MINUTE,
    });
    expect(cache.stats().messageChars).toBe(300);

    cancel.abort();
    await expect(busy).rejects.toThrow();
    expect(cache.stats()).toEqual({ scopes: 1, logs: 1, messageChars: 100 });
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
