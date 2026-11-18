/**
 * Bounded cache of Supabase provider logs shared by background polling and
 * the agent's read_logs tool.
 *
 * Entries are scoped by organization/account context, project (or branch)
 * ref and log source. Each scope keeps the raw log rows it has fetched,
 * deduplicated by the provider's log id, together with the time ranges it
 * fetched successfully ("coverage"), including ranges that returned nothing.
 * A query fetches only the parts of its window that coverage does not answer,
 * joins fetches already in flight for the same scope, and reads the rest from
 * the cache. Filters such as search terms or levels are never applied here, so
 * one filtered read cannot hide rows from a later one.
 *
 * Invariant: a scope only keeps rows whose timestamps lie inside its coverage.
 * Coverage that is evicted takes its rows with it, and rows trimmed
 * for memory take their coverage with them, so the cache never claims to know
 * a range it holds no rows for.
 *
 * Freshness: coverage within SUPABASE_LOG_RECENT_OVERLAP_MS of the moment it
 * was fetched is provisional because Supabase ingests logs asynchronously. It
 * is fetched again on every new read; concurrent readers can still share an
 * in-flight fetch. Coverage fetched or joined by a read answers that read,
 * including its provisional portion. Settled coverage has no time-based
 * expiration and is reused until evicted or explicitly cleared. See
 * SUPABASE_LOG_RECENT_OVERLAP_MS for why this cannot recover arbitrarily
 * delayed events.
 *
 * The provider rounds query bounds to minutes, so fetches are widened to
 * minute boundaries (never narrowed) and results are filtered to the exact
 * window on read. A capped page is never recorded as complete coverage: only
 * rows strictly newer than its oldest row are known to be complete, and older
 * rows are fetched by paging backwards a bounded number of times.
 */
import {
  SUPABASE_LOG_RECENT_OVERLAP_MS,
  SUPABASE_LOGS_MAX_WINDOW_MS,
  SUPABASE_LOGS_PAGE_SIZE,
  SUPABASE_LOGS_ROUNDING_MS,
} from "@/shared/supabase_edge_logs";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** Pages fetched backwards for one range before reporting truncation. */
export const MAX_PAGES_PER_RANGE = 5;
/** Provider requests one query may start in parallel. */
export const MAX_FETCH_RANGES_PER_QUERY = 4;
/** Gaps closer than this are fetched as one range. */
export const GAP_COALESCE_MS = 5 * 60 * 1000;
/** Deadline for fetching one range, including all of its pages. */
export const RANGE_FETCH_DEADLINE_MS = 60_000;
export const MAX_CACHED_SCOPES = 16;
export const MAX_LOGS_PER_SCOPE = 5_000;
export const MAX_TOTAL_CACHED_LOGS = 20_000;
/** Total message characters held across scopes (about 16 MB of UTF-16). */
export const MAX_TOTAL_CACHED_MESSAGE_CHARS = 8_000_000;
/** Longer messages are truncated before they are cached. */
export const MAX_CACHED_MESSAGE_CHARS = 16_000;
export const MAX_COVERAGE_INTERVALS_PER_SCOPE = 128;

const MESSAGE_TRUNCATION_SUFFIX = "\n... [truncated by Dyad]";

export type SupabaseLogSource = "function_logs";

export interface SupabaseLogScope {
  /** Organization slug, or null for legacy single-account credentials. */
  organizationSlug: string | null;
  /** Project ref, or the branch's project ref for a branch. */
  projectRef: string;
  source: SupabaseLogSource;
}

/** Half-open range [start, end) in epoch milliseconds. */
export interface TimeRange {
  start: number;
  end: number;
}

export interface SupabaseLogRow {
  id: string;
  timestamp: number;
  event_message: string;
  level: "info" | "warn" | "error";
}

export interface CachedSupabaseLog {
  id: string;
  timestamp: number;
  message: string;
  level: "info" | "warn" | "error";
}

export type SupabaseLogPageFetcher = (request: {
  scope: SupabaseLogScope;
  /** Minute-aligned bounds that enclose the range being fetched. */
  start: number;
  end: number;
  limit: number;
  signal: AbortSignal;
}) => Promise<readonly SupabaseLogRow[]>;

export interface SupabaseLogQueryResult {
  /** Rows inside the requested window, oldest first. */
  logs: CachedSupabaseLog[];
  /** Parts of the window without complete provider coverage. */
  missingRanges: TimeRange[];
  /** A page or request limit left part of the window incomplete. */
  truncated: boolean;
  /** Provider failure that left part of the window incomplete. */
  error: unknown;
  /** Provider pages this call requested itself. */
  providerRequests: number;
}

interface CoverageInterval extends TimeRange {
  fetchedAt: number;
  fetchId: number;
}

interface FetchOutcome {
  truncated: boolean;
  error: unknown;
  pages: number;
}

interface InFlightFetch {
  id: number;
  range: TimeRange;
  controller: AbortController;
  waiters: number;
  settled: boolean;
  promise: Promise<FetchOutcome>;
}

interface ScopeState {
  key: string;
  scope: SupabaseLogScope;
  logs: Map<string, CachedSupabaseLog>;
  coverage: CoverageInterval[];
  inFlight: Set<InFlightFetch>;
  messageChars: number;
}

export interface SupabaseLogCacheOptions {
  fetchPage: SupabaseLogPageFetcher;
  now?: () => number;
  pageSize?: number;
  maxPagesPerRange?: number;
  rangeFetchDeadlineMs?: number;
  maxScopes?: number;
  maxLogsPerScope?: number;
  maxTotalLogs?: number;
  maxTotalMessageChars?: number;
}

export class SupabaseLogCache {
  private readonly scopes = new Map<string, ScopeState>();
  private nextFetchId = 0;
  private readonly fetchPage: SupabaseLogPageFetcher;
  private readonly now: () => number;
  private readonly pageSize: number;
  private readonly maxPagesPerRange: number;
  private readonly rangeFetchDeadlineMs: number;
  private readonly maxScopes: number;
  private readonly maxLogsPerScope: number;
  private readonly maxTotalLogs: number;
  private readonly maxTotalMessageChars: number;

  constructor(options: SupabaseLogCacheOptions) {
    this.fetchPage = options.fetchPage;
    this.now = options.now ?? (() => Date.now());
    this.pageSize = options.pageSize ?? SUPABASE_LOGS_PAGE_SIZE;
    this.maxPagesPerRange = options.maxPagesPerRange ?? MAX_PAGES_PER_RANGE;
    this.rangeFetchDeadlineMs =
      options.rangeFetchDeadlineMs ?? RANGE_FETCH_DEADLINE_MS;
    this.maxScopes = options.maxScopes ?? MAX_CACHED_SCOPES;
    this.maxLogsPerScope = options.maxLogsPerScope ?? MAX_LOGS_PER_SCOPE;
    this.maxTotalLogs = options.maxTotalLogs ?? MAX_TOTAL_CACHED_LOGS;
    this.maxTotalMessageChars =
      options.maxTotalMessageChars ?? MAX_TOTAL_CACHED_MESSAGE_CHARS;
  }

  /**
   * Returns the rows in [start, end), fetching whatever the cache cannot
   * answer. Provider failures are reported in the result rather than thrown,
   * so callers keep whatever was available. Only caller cancellation throws.
   */
  async query({
    scope,
    start,
    end,
    signal,
  }: {
    scope: SupabaseLogScope;
    start: number;
    end: number;
    signal?: AbortSignal;
  }): Promise<SupabaseLogQueryResult> {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new DyadError(
        "A Supabase log query needs a start time before its end time.",
        DyadErrorKind.Validation,
      );
    }
    signal?.throwIfAborted();
    const state = this.touchScope(scope);

    const requested: TimeRange[] = [{ start, end }];
    const attempted: TimeRange[] = [];
    // Accept coverage fetched during this read, including newer overlapping
    // fetches from other readers. Older in-flight fetches can also be joined.
    const firstFetchId = this.nextFetchId;
    const joinedFetchIds = new Set<number>();
    let truncated = false;
    let error: unknown = null;
    let providerRequests = 0;

    // Round two only fetches ranges that a joined fetch failed to cover.
    for (let round = 0; round < 2; round++) {
      const gaps = subtractRanges(
        requested,
        this.usableCoverage(state, firstFetchId, joinedFetchIds),
      );
      if (gaps.length === 0) break;

      // A fetch every earlier reader abandoned is already being aborted.
      const joined = [...state.inFlight].filter(
        (fetch) =>
          !fetch.controller.signal.aborted &&
          gaps.some((gap) => rangesOverlap(gap, fetch.range)),
      );
      const ownGaps = subtractRanges(
        subtractRanges(
          gaps,
          joined.map((fetch) => fetch.range),
        ),
        attempted,
      );
      const started = planFetchRanges(ownGaps).map((range) =>
        this.startFetch(state, range),
      );
      attempted.push(...started.map((fetch) => fetch.range));
      if (joined.length === 0 && started.length === 0) break;

      for (const fetch of joined) joinedFetchIds.add(fetch.id);
      const outcomes = await Promise.all(
        [...joined, ...started].map((fetch) => this.join(fetch, signal)),
      );
      outcomes.forEach((outcome, index) => {
        if (index >= joined.length) providerRequests += outcome.pages;
        truncated ||= outcome.truncated;
        error ??= outcome.error;
      });
    }

    const missingRanges = subtractRanges(
      requested,
      this.usableCoverage(state, firstFetchId, joinedFetchIds),
    );
    const logs = [...state.logs.values()]
      .filter((entry) => entry.timestamp >= start && entry.timestamp < end)
      .sort(compareLogs);

    this.enforceBounds(state, { start, end });

    const incomplete = missingRanges.length > 0;
    return {
      logs,
      missingRanges,
      // Something left the window incomplete; if no fetch reported why, the
      // request limits did.
      truncated: incomplete && (truncated || error === null),
      error: incomplete ? error : null,
      providerRequests,
    };
  }

  /** Drops cached scopes, all of them or those matching `predicate`. */
  clear(predicate?: (scope: SupabaseLogScope) => boolean): void {
    for (const [key, state] of this.scopes) {
      if (!predicate || predicate(state.scope)) {
        this.scopes.delete(key);
      }
    }
  }

  /** Memory accounting, for tests and diagnostics. */
  stats(): { scopes: number; logs: number; messageChars: number } {
    let logs = 0;
    let messageChars = 0;
    for (const state of this.scopes.values()) {
      logs += state.logs.size;
      messageChars += state.messageChars;
    }
    return { scopes: this.scopes.size, logs, messageChars };
  }

  private touchScope(scope: SupabaseLogScope): ScopeState {
    const key = JSON.stringify([
      scope.organizationSlug,
      scope.projectRef,
      scope.source,
    ]);
    let state = this.scopes.get(key);
    if (state) {
      // Re-insert to mark it most recently used.
      this.scopes.delete(key);
    } else {
      state = {
        key,
        scope: { ...scope },
        logs: new Map(),
        coverage: [],
        inFlight: new Set(),
        messageChars: 0,
      };
    }
    this.scopes.set(key, state);
    return state;
  }

  private usableCoverage(
    state: ScopeState,
    firstFetchId: number,
    joinedFetchIds: ReadonlySet<number>,
  ): TimeRange[] {
    const usable: TimeRange[] = [];
    for (const interval of state.coverage) {
      if (
        interval.fetchId >= firstFetchId ||
        joinedFetchIds.has(interval.fetchId)
      ) {
        usable.push({ start: interval.start, end: interval.end });
        continue;
      }
      const settledEnd = Math.min(
        interval.end,
        interval.fetchedAt - SUPABASE_LOG_RECENT_OVERLAP_MS,
      );
      if (settledEnd > interval.start) {
        usable.push({ start: interval.start, end: settledEnd });
      }
    }
    return mergeRanges(usable);
  }

  private startFetch(state: ScopeState, range: TimeRange): InFlightFetch {
    const fetch: InFlightFetch = {
      id: this.nextFetchId++,
      range,
      controller: new AbortController(),
      waiters: 0,
      settled: false,
      promise: Promise.resolve({ truncated: false, error: null, pages: 0 }),
    };
    state.inFlight.add(fetch);
    fetch.promise = this.runFetch(
      state,
      range,
      fetch.controller.signal,
      fetch.id,
    ).then((outcome) => {
      fetch.settled = true;
      state.inFlight.delete(fetch);
      return outcome;
    });
    return fetch;
  }

  /**
   * Waits for a shared fetch on behalf of one caller. The fetch is aborted
   * only when every caller waiting on it has been cancelled.
   */
  private async join(
    fetch: InFlightFetch,
    signal: AbortSignal | undefined,
  ): Promise<FetchOutcome> {
    fetch.waiters++;
    try {
      return await raceAbort(fetch.promise, signal);
    } finally {
      fetch.waiters--;
      if (fetch.waiters === 0 && !fetch.settled) {
        fetch.controller.abort(
          new DOMException("Every reader cancelled the request", "AbortError"),
        );
      }
    }
  }

  /** Never rejects: failures are returned as the outcome's error. */
  private async runFetch(
    state: ScopeState,
    range: TimeRange,
    cancelSignal: AbortSignal,
    fetchId: number,
  ): Promise<FetchOutcome> {
    const issuedAt = this.now();
    const deadline = new AbortController();
    const timer = setTimeout(
      () =>
        deadline.abort(
          new DyadError(
            `Supabase did not return logs within ${Math.round(this.rangeFetchDeadlineMs / 1000)} seconds.`,
            DyadErrorKind.External,
          ),
        ),
      this.rangeFetchDeadlineMs,
    );
    const signal = AbortSignal.any([cancelSignal, deadline.signal]);
    const alignedStart = floorTo(range.start, SUPABASE_LOGS_ROUNDING_MS);
    let cursorEnd = ceilTo(range.end, SUPABASE_LOGS_ROUNDING_MS);
    let pages = 0;
    try {
      for (;;) {
        const rows = await raceAbort(
          this.fetchPage({
            scope: state.scope,
            start: alignedStart,
            end: cursorEnd,
            limit: this.pageSize,
            signal,
          }),
          signal,
        );
        pages++;
        this.insertLogs(state, rows);
        // Rows stamped after the request was issued may still be arriving;
        // the issue instant itself is included.
        const coveredEnd = Math.min(cursorEnd, issuedAt + 1);
        if (rows.length < this.pageSize) {
          this.addCoverage(state, {
            start: alignedStart,
            end: coveredEnd,
            fetchedAt: issuedAt,
            fetchId,
          });
          return { truncated: false, error: null, pages };
        }
        // Capped page: only rows strictly newer than its oldest are complete.
        let oldest = Number.POSITIVE_INFINITY;
        for (const row of rows) oldest = Math.min(oldest, row.timestamp);
        this.addCoverage(state, {
          start: oldest + 1,
          end: coveredEnd,
          fetchedAt: issuedAt,
          fetchId,
        });
        if (oldest < range.start) {
          return { truncated: false, error: null, pages };
        }
        // Bounds are whole minutes, so the next page re-reads the rest of the
        // oldest row's minute and relies on id dedupe.
        const nextEnd =
          floorTo(oldest, SUPABASE_LOGS_ROUNDING_MS) +
          SUPABASE_LOGS_ROUNDING_MS;
        if (nextEnd >= cursorEnd || pages >= this.maxPagesPerRange) {
          return { truncated: true, error: null, pages };
        }
        cursorEnd = nextEnd;
      }
    } catch (error) {
      return {
        truncated: false,
        error: deadline.signal.aborted ? deadline.signal.reason : error,
        pages,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private insertLogs(state: ScopeState, rows: readonly SupabaseLogRow[]) {
    for (const row of rows) {
      if (state.logs.has(row.id) || !Number.isFinite(row.timestamp)) continue;
      const message =
        row.event_message.length > MAX_CACHED_MESSAGE_CHARS
          ? row.event_message.slice(
              0,
              MAX_CACHED_MESSAGE_CHARS - MESSAGE_TRUNCATION_SUFFIX.length,
            ) + MESSAGE_TRUNCATION_SUFFIX
          : row.event_message;
      state.logs.set(row.id, {
        id: row.id,
        timestamp: row.timestamp,
        message,
        level: row.level,
      });
      state.messageChars += message.length;
    }
  }

  /**
   * Records a successful fetch. Where it overlaps existing coverage, the
   * more recently fetched interval wins.
   */
  private addCoverage(state: ScopeState, added: CoverageInterval): void {
    if (added.end <= added.start) return;
    let pieces: TimeRange[] = [{ start: added.start, end: added.end }];
    for (const interval of state.coverage) {
      if (interval.fetchId >= added.fetchId) {
        pieces = subtractRanges(pieces, [interval]);
      }
    }
    const next: CoverageInterval[] = [];
    for (const interval of state.coverage) {
      if (interval.fetchId >= added.fetchId) {
        next.push(interval);
        continue;
      }
      for (const remaining of subtractRanges([interval], pieces)) {
        next.push({ ...interval, ...remaining });
      }
    }
    for (const piece of pieces) {
      next.push({ ...added, ...piece });
    }
    next.sort((a, b) => a.start - b.start);
    // Keep different fetches distinct even when issued in the same millisecond.
    const merged: CoverageInterval[] = [];
    for (const interval of next) {
      const last = merged.at(-1);
      if (
        last &&
        last.end === interval.start &&
        last.fetchId === interval.fetchId
      ) {
        last.end = interval.end;
      } else {
        merged.push({ ...interval });
      }
    }
    state.coverage = compactCoverage(merged);
    // Compaction can drop intervals; keep the rows-within-coverage invariant.
    if (state.coverage.length < merged.length) {
      this.dropLogsOutsideCoverage(state);
    }
  }

  private dropLogsOutsideCoverage(state: ScopeState): void {
    for (const [id, entry] of state.logs) {
      if (!isCovered(state.coverage, entry.timestamp)) {
        state.logs.delete(id);
        state.messageChars -= entry.message.length;
      }
    }
  }

  /**
   * Keeps one scope and the whole cache within their bounds. Coverage that
   * does not touch the window just read is evicted first, oldest fetch
   * first; then the oldest rows. Scopes are evicted least recently used.
   */
  private enforceBounds(state: ScopeState, protectedRange: TimeRange): void {
    if (state.logs.size > this.maxLogsPerScope) {
      const evictable = state.coverage
        .filter((interval) => !rangesOverlap(interval, protectedRange))
        .sort((a, b) => a.fetchedAt - b.fetchedAt);
      const counts = countLogsPerInterval(state);
      let remaining = state.logs.size;
      const evicted = new Set<CoverageInterval>();
      for (const interval of evictable) {
        if (remaining <= this.maxLogsPerScope) break;
        evicted.add(interval);
        remaining -= counts.get(interval) ?? 0;
      }
      if (evicted.size > 0) {
        state.coverage = state.coverage.filter(
          (interval) => !evicted.has(interval),
        );
        this.dropLogsOutsideCoverage(state);
      }
      this.trimOldestLogs(state, this.maxLogsPerScope, Infinity);
    }

    for (;;) {
      const totals = this.stats();
      const overCount = totals.logs > this.maxTotalLogs;
      const overChars = totals.messageChars > this.maxTotalMessageChars;
      if (totals.scopes <= this.maxScopes && !overCount && !overChars) return;
      const lru = [...this.scopes.values()].find(
        (candidate) => candidate !== state,
      );
      if (lru) {
        this.scopes.delete(lru.key);
        continue;
      }
      // Only the scope just read remains, and it alone is over budget.
      this.trimOldestLogs(
        state,
        state.logs.size - Math.max(0, totals.logs - this.maxTotalLogs),
        state.messageChars -
          Math.max(0, totals.messageChars - this.maxTotalMessageChars),
      );
      return;
    }
  }

  /**
   * Drops the oldest rows until the scope holds at most `maxLogs` rows and
   * `maxChars` message characters, and cuts coverage at the same point.
   */
  private trimOldestLogs(
    state: ScopeState,
    maxLogs: number,
    maxChars: number,
  ): void {
    if (state.logs.size <= maxLogs && state.messageChars <= maxChars) return;
    const newestFirst = [...state.logs.values()].sort((a, b) =>
      compareLogs(b, a),
    );
    let keptCount = 0;
    let keptChars = 0;
    let threshold = Number.POSITIVE_INFINITY;
    for (const entry of newestFirst) {
      if (
        keptCount + 1 > maxLogs ||
        keptChars + entry.message.length > maxChars
      ) {
        // Rows sharing this timestamp go too, so coverage stays exact.
        threshold = entry.timestamp + 1;
        break;
      }
      keptCount++;
      keptChars += entry.message.length;
      threshold = entry.timestamp;
    }
    if (keptCount === state.logs.size) return;
    state.coverage = state.coverage
      .map((interval) => ({
        ...interval,
        start: Math.max(interval.start, threshold),
      }))
      .filter((interval) => interval.end > interval.start);
    this.dropLogsOutsideCoverage(state);
  }
}

function compareLogs(a: CachedSupabaseLog, b: CachedSupabaseLog): number {
  return a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function floorTo(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

function isCovered(coverage: readonly TimeRange[], timestamp: number): boolean {
  let low = 0;
  let high = coverage.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const interval = coverage[mid];
    if (timestamp < interval.start) high = mid - 1;
    else if (timestamp >= interval.end) low = mid + 1;
    else return true;
  }
  return false;
}

function countLogsPerInterval(
  state: ScopeState,
): Map<CoverageInterval, number> {
  const counts = new Map<CoverageInterval, number>();
  for (const entry of state.logs.values()) {
    const interval = state.coverage.find(
      (candidate) =>
        entry.timestamp >= candidate.start && entry.timestamp < candidate.end,
    );
    if (interval) counts.set(interval, (counts.get(interval) ?? 0) + 1);
  }
  return counts;
}

/** Sorted, disjoint union of the given ranges. */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .map((range) => ({ ...range }))
    .sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/** Parts of `ranges` not covered by `cuts`. */
export function subtractRanges(
  ranges: readonly TimeRange[],
  cuts: readonly TimeRange[],
): TimeRange[] {
  const mergedCuts = mergeRanges(cuts);
  const result: TimeRange[] = [];
  for (const range of mergeRanges(ranges)) {
    let cursor = range.start;
    for (const cut of mergedCuts) {
      if (cut.end <= cursor) continue;
      if (cut.start >= range.end) break;
      if (cut.start > cursor) result.push({ start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= range.end) break;
    }
    if (cursor < range.end) result.push({ start: cursor, end: range.end });
  }
  return result;
}

/**
 * Turns gaps into provider requests: nearby gaps are fetched together, each
 * request fits the provider's window after minute alignment, and at most
 * MAX_FETCH_RANGES_PER_QUERY requests start at once (the closest gaps are
 * merged until they fit; re-reading a covered stretch costs only dedupe).
 * Newest ranges come first.
 */
export function planFetchRanges(gaps: readonly TimeRange[]): TimeRange[] {
  const ranges: TimeRange[] = [];
  for (const gap of mergeRanges(gaps)) {
    const last = ranges.at(-1);
    if (last && gap.start - last.end < GAP_COALESCE_MS) {
      last.end = gap.end;
    } else {
      ranges.push({ ...gap });
    }
  }
  // Widening each bound to a minute adds at most two minutes.
  const maxChunk = SUPABASE_LOGS_MAX_WINDOW_MS - 2 * SUPABASE_LOGS_ROUNDING_MS;
  let chunks: TimeRange[] = [];
  for (const range of ranges) {
    for (let start = range.start; start < range.end; start += maxChunk) {
      chunks.push({ start, end: Math.min(range.end, start + maxChunk) });
    }
  }
  while (chunks.length > MAX_FETCH_RANGES_PER_QUERY) {
    let closest = 0;
    for (let index = 1; index < chunks.length - 1; index++) {
      if (
        chunks[index + 1].start - chunks[index].end <
        chunks[closest + 1].start - chunks[closest].end
      ) {
        closest = index;
      }
    }
    const merged = {
      start: chunks[closest].start,
      end: chunks[closest + 1].end,
    };
    if (merged.end - merged.start > maxChunk) {
      // Merging would exceed the provider window; drop the oldest instead.
      // The caller reports it as a missing range.
      chunks = chunks.slice(1);
      continue;
    }
    chunks.splice(closest, 2, merged);
  }
  return chunks.reverse();
}

/**
 * Bounds the number of coverage intervals. Touching intervals are merged
 * under the earlier fetch time, which only ever makes coverage look older
 * (and so refetched sooner); if that is not enough the oldest fetches are
 * dropped.
 */
function compactCoverage(coverage: CoverageInterval[]): CoverageInterval[] {
  let result = coverage;
  while (result.length > MAX_COVERAGE_INTERVALS_PER_SCOPE) {
    const index = result.findIndex(
      (interval, i) =>
        i + 1 < result.length && interval.end === result[i + 1].start,
    );
    if (index === -1) {
      const oldest = result.reduce((a, b) =>
        b.fetchedAt < a.fetchedAt ? b : a,
      );
      result = result.filter((interval) => interval !== oldest);
      continue;
    }
    const merged: CoverageInterval = {
      start: result[index].start,
      end: result[index + 1].end,
      fetchedAt: Math.min(result[index].fetchedAt, result[index + 1].fetchedAt),
      fetchId: Math.min(result[index].fetchId, result[index + 1].fetchId),
    };
    result = [...result.slice(0, index), merged, ...result.slice(index + 2)];
  }
  return result;
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
