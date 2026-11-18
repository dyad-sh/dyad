import type { ConsoleEntry } from "@/ipc/types";
import {
  EDGE_LOGS_POLL_MAX_LOOKBACK_MS,
  SUPABASE_LOG_RECENT_OVERLAP_MS,
} from "@/shared/supabase_edge_logs";

/**
 * Per-app, per-project progress of background Edge Function log polling in
 * one renderer window. Each poll re-reads the recent overlap so late-arriving
 * logs are seen, and `seen` remembers ids inside that overlap so they are
 * appended to the preview console only once.
 */
export interface EdgeLogPollCursor {
  /** When the last successful poll was requested. */
  lastRequestedAt: number;
  /** Ids already delivered, with their timestamps, inside the next overlap. */
  seen: ReadonlyMap<string, number>;
}

export function edgeLogPollKey({
  appId,
  projectId,
  organizationSlug,
}: {
  appId: number;
  projectId: string;
  organizationSlug: string | null;
}): string {
  return JSON.stringify([appId, organizationSlug, projectId]);
}

/** Start of the window the next poll requests. */
export function getEdgeLogPollStart(
  cursor: EdgeLogPollCursor | undefined,
  requestedAt: number,
): number {
  const earliest = requestedAt - EDGE_LOGS_POLL_MAX_LOOKBACK_MS;
  if (!cursor) return earliest;
  return Math.max(
    earliest,
    cursor.lastRequestedAt - SUPABASE_LOG_RECENT_OVERLAP_MS,
  );
}

function entryKey(entry: ConsoleEntry): string {
  return entry.providerLogId ?? `${entry.timestamp}:${entry.message}`;
}

/**
 * Splits a poll's entries into those not yet delivered and the next cursor.
 * A replayed or out-of-order result (for example React Query serving cached
 * data on remount) delivers nothing new and never moves the cursor back.
 */
export function applyEdgeLogPollResult(
  cursor: EdgeLogPollCursor | undefined,
  entries: readonly ConsoleEntry[],
  requestedAt: number,
): { newEntries: ConsoleEntry[]; cursor: EdgeLogPollCursor } {
  const seen = new Map(cursor?.seen);
  const newEntries: ConsoleEntry[] = [];
  for (const entry of entries) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.set(key, entry.timestamp);
    newEntries.push(entry);
  }
  newEntries.sort((a, b) => a.timestamp - b.timestamp);

  const lastRequestedAt = Math.max(cursor?.lastRequestedAt ?? 0, requestedAt);
  // Only ids the next poll can return again need remembering.
  const nextStart = getEdgeLogPollStart(
    { lastRequestedAt, seen },
    lastRequestedAt,
  );
  for (const [key, timestamp] of seen) {
    if (timestamp < nextStart) seen.delete(key);
  }
  return { newEntries, cursor: { lastRequestedAt, seen } };
}
