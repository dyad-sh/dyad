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
});
