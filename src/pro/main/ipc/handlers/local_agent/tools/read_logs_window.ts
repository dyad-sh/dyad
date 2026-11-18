import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  DEFAULT_LOG_READ_WINDOW_MS,
  SUPABASE_LOGS_MAX_WINDOW_MS,
} from "@/shared/supabase_edge_logs";

/** Widest window read_logs accepts: the Supabase logs endpoint's limit. */
export const READ_LOGS_MAX_WINDOW_MS = SUPABASE_LOGS_MAX_WINDOW_MS;
/**
 * An endTime this close to the future is treated as "now" so small clock
 * differences in the model's notion of the current time do not fail a call.
 */
export const READ_LOGS_FUTURE_TOLERANCE_MS = 60_000;

// ISO 8601 date-time with an explicit timezone (Z or a numeric offset).
const ISO_TIMESTAMP_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

export interface ReadLogsWindowArgs {
  startTime?: string;
  endTime?: string;
}

/** Inclusive window [start, end] in epoch milliseconds. */
export interface ReadLogsWindow {
  start: number;
  end: number;
  /** True when neither bound was supplied (the default recent window). */
  isDefault: boolean;
}

function parseTimestamp(value: string, name: "startTime" | "endTime"): number {
  const trimmed = value.trim();
  if (!ISO_TIMESTAMP_WITH_ZONE.test(trimmed)) {
    throw new DyadError(
      `${name} must be an ISO 8601 timestamp with an explicit timezone, such as "2026-01-15T14:30:00Z" or "2026-01-15T09:30:00-05:00". Received "${value}".`,
      DyadErrorKind.Validation,
    );
  }
  const parsed = Date.parse(trimmed);
  // Date.parse normalizes dates such as February 31. Check the calendar date
  // separately from the timezone, which may legitimately change the UTC day.
  const calendarDate = trimmed.slice(0, 10);
  const parsedCalendarDate = Date.parse(`${calendarDate}T00:00:00Z`);
  if (
    !Number.isFinite(parsed) ||
    !Number.isFinite(parsedCalendarDate) ||
    new Date(parsedCalendarDate).toISOString().slice(0, 10) !== calendarDate
  ) {
    throw new DyadError(
      `${name} is not a valid date: "${value}".`,
      DyadErrorKind.Validation,
    );
  }
  return parsed;
}

/**
 * Resolves the agent's optional bounds against one captured "now":
 * - neither: the DEFAULT_LOG_READ_WINDOW_MS before now
 * - startTime only: startTime to now
 * - endTime only: the DEFAULT_LOG_READ_WINDOW_MS before endTime
 * - both: exactly that range
 */
export function resolveReadLogsWindow(
  args: ReadLogsWindowArgs,
  now: number,
): ReadLogsWindow {
  const hasStart = args.startTime !== undefined && args.startTime !== "";
  const hasEnd = args.endTime !== undefined && args.endTime !== "";
  const nowIso = new Date(now).toISOString();

  let end = now;
  if (hasEnd) {
    end = parseTimestamp(args.endTime!, "endTime");
    if (end > now + READ_LOGS_FUTURE_TOLERANCE_MS) {
      throw new DyadError(
        `endTime ${new Date(end).toISOString()} is in the future. The current time is ${nowIso}; omit endTime to read up to now.`,
        DyadErrorKind.Validation,
      );
    }
    end = Math.min(end, now);
  }

  let start = end - DEFAULT_LOG_READ_WINDOW_MS;
  if (hasStart) {
    start = parseTimestamp(args.startTime!, "startTime");
    if (start > now) {
      throw new DyadError(
        `startTime ${new Date(start).toISOString()} is in the future. The current time is ${nowIso}.`,
        DyadErrorKind.Validation,
      );
    }
  }

  if (start >= end) {
    throw new DyadError(
      `startTime (${new Date(start).toISOString()}) must be before endTime (${new Date(end).toISOString()}).`,
      DyadErrorKind.Validation,
    );
  }
  if (end - start > READ_LOGS_MAX_WINDOW_MS) {
    throw new DyadError(
      `The requested window spans ${formatDuration(end - start)}, but read_logs can query at most 24 hours at a time. Narrow startTime/endTime, or make several calls for consecutive windows.`,
      DyadErrorKind.Validation,
    );
  }
  return { start, end, isDefault: !hasStart && !hasEnd };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (seconds || parts.length === 0) {
    parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  }
  return parts.join(" ");
}

/** Summary of the range actually queried, shown once the call completes. */
export function describeQueriedWindow(window: ReadLogsWindow): string {
  const range = `${new Date(window.start).toISOString()} to ${new Date(window.end).toISOString()}`;
  return window.isDefault
    ? `Time: last ${formatDuration(window.end - window.start)} (${range})`
    : `Time: ${range} (${formatDuration(window.end - window.start)})`;
}

/**
 * Summary while the call is still streaming, before "now" is captured.
 * Arguments may be partial, so unparseable bounds are shown verbatim.
 */
export function describeRequestedWindow(args: ReadLogsWindowArgs): string {
  const show = (value: string) => {
    const parsed = ISO_TIMESTAMP_WITH_ZONE.test(value.trim())
      ? Date.parse(value.trim())
      : Number.NaN;
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  };
  const defaultWindow = formatDuration(DEFAULT_LOG_READ_WINDOW_MS);
  if (args.startTime && args.endTime) {
    return `Time: ${show(args.startTime)} to ${show(args.endTime)}`;
  }
  if (args.startTime) return `Time: ${show(args.startTime)} to now`;
  if (args.endTime) {
    return `Time: ${defaultWindow} before ${show(args.endTime)}`;
  }
  return `Time: last ${defaultWindow}`;
}
