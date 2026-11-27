import { describe, expect, it } from "vitest";
import type { ConsoleEntry } from "@/ipc/types";
import {
  EDGE_LOGS_POLL_MAX_LOOKBACK_MS,
  SUPABASE_LOG_RECENT_OVERLAP_MS,
} from "@/shared/supabase_edge_logs";
import {
  applyEdgeLogPollResult,
  edgeLogPollKey,
  getEdgeLogPollStart,
  storeEdgeLogPollCursor,
  type EdgeLogPollCursor,
} from "./supabase_edge_log_poll";

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);

function entry(id: string, timestamp: number, message = "same"): ConsoleEntry {
  return {
    level: "info",
    type: "edge-function",
    message,
    timestamp,
    appId: 1,
    providerLogId: id,
  };
}

describe("edge log polling cursor", () => {
  it("looks back a bounded window on the first poll", () => {
    expect(getEdgeLogPollStart(undefined, NOW)).toBe(
      NOW - EDGE_LOGS_POLL_MAX_LOOKBACK_MS,
    );
  });

  it("re-reads the recent overlap and never looks back further than the cap", () => {
    expect(
      getEdgeLogPollStart(
        { lastRequestedAt: NOW, seen: new Map() },
        NOW + 5_000,
      ),
    ).toBe(NOW - SUPABASE_LOG_RECENT_OVERLAP_MS);
    expect(
      getEdgeLogPollStart(
        { lastRequestedAt: NOW - 60 * 60_000, seen: new Map() },
        NOW,
      ),
    ).toBe(NOW - EDGE_LOGS_POLL_MAX_LOOKBACK_MS);
  });

  it("delivers each log once across overlapping polls, including late arrivals", () => {
    const first = applyEdgeLogPollResult(
      undefined,
      [entry("a", NOW - 10_000), entry("b", NOW - 10_000)],
      NOW,
    );
    // Distinct events with identical timestamps and messages both deliver.
    expect(first.newEntries.map((e) => e.providerLogId)).toEqual(["a", "b"]);

    const second = applyEdgeLogPollResult(
      first.cursor,
      [
        entry("a", NOW - 10_000),
        entry("late", NOW - 20_000),
        entry("b", NOW - 10_000),
        entry("c", NOW + 2_000),
      ],
      NOW + 5_000,
    );
    expect(second.newEntries.map((e) => e.providerLogId)).toEqual([
      "late",
      "c",
    ]);
  });

  it("ignores a replayed result and does not move the cursor back", () => {
    const logs = [entry("old", NOW - 5 * 60_000), entry("a", NOW)];
    const first = applyEdgeLogPollResult(undefined, logs, NOW);
    expect(first.newEntries).toEqual(logs);
    expect(first.cursor.seen.has("old")).toBe(false);
    const same = applyEdgeLogPollResult(first.cursor, logs, NOW);
    expect(same.newEntries).toEqual([]);
    expect(same.cursor).toBe(first.cursor);
    const later = applyEdgeLogPollResult(
      first.cursor,
      [entry("b", NOW + 4_000)],
      NOW + 5_000,
    );
    const replay = applyEdgeLogPollResult(later.cursor, logs, NOW);
    expect(replay.newEntries).toEqual([]);
    expect(replay.cursor.lastRequestedAt).toBe(NOW + 5_000);
  });

  it("does not replay logs pruned between consecutive overlap windows", () => {
    const first = applyEdgeLogPollResult(undefined, [], NOW);
    const logs = [entry("late", NOW - SUPABASE_LOG_RECENT_OVERLAP_MS + 1)];
    const next = applyEdgeLogPollResult(first.cursor, logs, NOW + 5_000);
    expect(next.newEntries).toEqual(logs);
    expect(next.cursor.seen.size).toBe(0);
    expect(
      applyEdgeLogPollResult(next.cursor, logs, NOW + 5_000).newEntries,
    ).toEqual([]);
  });

  it("forgets ids the next poll cannot return", () => {
    const old = NOW - SUPABASE_LOG_RECENT_OVERLAP_MS - 1;
    const { cursor } = applyEdgeLogPollResult(
      undefined,
      [entry("old", old), entry("recent", NOW - 1_000)],
      NOW,
    );
    expect([...cursor.seen.keys()]).toEqual(["recent"]);
  });

  it("keys cursors by app, organization and project", () => {
    const key = edgeLogPollKey({
      appId: 1,
      projectId: "p",
      organizationSlug: null,
    });
    expect(key).not.toBe(
      edgeLogPollKey({ appId: 2, projectId: "p", organizationSlug: null }),
    );
    expect(key).not.toBe(
      edgeLogPollKey({ appId: 1, projectId: "p", organizationSlug: "o" }),
    );
    expect(key).not.toBe(
      edgeLogPollKey({ appId: 1, projectId: "other", organizationSlug: null }),
    );
  });

  it("delivers partial results while retaining gaps and their dedupe IDs", () => {
    const retryFrom = NOW - 8 * 60_000;
    const logs = [entry("available", NOW - 5 * 60_000)];
    const partial = applyEdgeLogPollResult(undefined, logs, NOW, retryFrom);
    expect(partial.newEntries).toEqual(logs);
    expect(getEdgeLogPollStart(partial.cursor, NOW + 5_000)).toBe(retryFrom);
    expect(partial.cursor.seen.has("available")).toBe(true);

    const recovered = applyEdgeLogPollResult(
      partial.cursor,
      [entry("recovered", NOW - 7 * 60_000), ...logs],
      NOW + 5_000,
    );
    expect(recovered.newEntries.map((log) => log.providerLogId)).toEqual([
      "recovered",
    ]);
    expect(getEdgeLogPollStart(recovered.cursor, NOW + 10_000)).toBe(
      NOW + 5_000 - SUPABASE_LOG_RECENT_OVERLAP_MS,
    );
    // Permanently truncated windows still respect the ten-minute lookback cap.
    expect(getEdgeLogPollStart(partial.cursor, NOW + 20 * 60_000)).toBe(
      NOW + 20 * 60_000 - EDGE_LOGS_POLL_MAX_LOOKBACK_MS,
    );
  });

  it("drops cursors that were not polled within the lookback", () => {
    const cursor = (lastRequestedAt: number): EdgeLogPollCursor => ({
      lastRequestedAt,
      seen: new Map([["id", lastRequestedAt]]),
    });
    const stale = cursor(
      NOW - EDGE_LOGS_POLL_MAX_LOOKBACK_MS - SUPABASE_LOG_RECENT_OVERLAP_MS - 1,
    );
    // A stale cursor starts the next poll at the lookback limit, exactly as
    // having no cursor does, so dropping it changes nothing.
    expect(getEdgeLogPollStart(stale, NOW)).toBe(
      getEdgeLogPollStart(undefined, NOW),
    );
    const recent = cursor(NOW - 60_000);
    const current = cursor(NOW);
    const next = storeEdgeLogPollCursor(
      { stale, recent, current: cursor(NOW - 5_000) },
      "current",
      current,
      NOW,
    );
    expect(Object.keys(next).sort()).toEqual(["current", "recent"]);
    expect(next.current).toBe(current);
    expect(next.recent).toBe(recent);
  });
});
