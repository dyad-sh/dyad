// Shared by the main-process Supabase log cache, the read_logs tool and the
// renderer's optional background polling. Keep this module free of side
// effects so the renderer can import it.

/**
 * The Supabase analytics logs endpoint rejects ranges longer than 24 hours
 * and rounds both bounds to the nearest minute.
 */
export const SUPABASE_LOGS_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SUPABASE_LOGS_ROUNDING_MS = 60 * 1000;

/** Rows requested per logs query. Pages are fetched newest first. */
export const SUPABASE_LOGS_PAGE_SIZE = 1000;

/**
 * Supabase ingests function logs asynchronously, so an event can become
 * queryable some time after its own timestamp. Coverage of the last
 * SUPABASE_LOG_RECENT_OVERLAP_MS before each fetch is provisional: later
 * reads and polls fetch that span again and merge late arrivals by log id.
 *
 * This bounds the cost of re-fetching, but it cannot guarantee recovery of
 * arbitrarily delayed events. Events that arrive after their range has been
 * fetched as settled may be missed until that coverage is evicted or
 * explicitly cleared and the range is read again.
 */
export const SUPABASE_LOG_RECENT_OVERLAP_MS = 2 * 60 * 1000;

/** Window read_logs queries when the agent supplies no time bounds. */
export const DEFAULT_LOG_READ_WINDOW_MS = 5 * 60 * 1000;

/** Interval between background polls while polling is enabled. */
export const EDGE_LOGS_POLL_INTERVAL_MS = 5_000;

/** Furthest back a background poll looks, including its first poll. */
export const EDGE_LOGS_POLL_MAX_LOOKBACK_MS = 10 * 60 * 1000;
