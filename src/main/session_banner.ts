// Single-line markers delimiting each run of the app in the log file. The log
// is appended across launches, so without these it's ambiguous where one
// session ends and the next begins. Grep for "===== Dyad " to find them all.
//
// Lines written by the running process carry its pid, because a second instance
// (a deep link, or a duplicate launch) writes into the same log before quitting.
// Without the pid its lines look like they belong to the live session.

const MARKER = "=====";

export interface StartBannerInfo {
  pid: number;
  version: string;
  platform: string;
  arch: string;
  electron: string;
  node: string;
}

export function formatStartBanner({
  pid,
  version,
  platform,
  arch,
  electron,
  node,
}: StartBannerInfo): string {
  return `${MARKER} Dyad started | pid ${pid} | ${version} | ${platform} ${arch} | electron ${electron} | node ${node} ${MARKER}`;
}

export function formatExitBanner(
  pid: number,
  reason: string,
  uptimeMs?: number,
): string {
  const uptime =
    uptimeMs === undefined ? "" : ` | uptime ${formatUptime(uptimeMs)}`;
  return `${MARKER} Dyad exiting | pid ${pid} | ${reason}${uptime} ${MARKER}`;
}

// Not a session boundary: these errors are caught and logged, and the app keeps
// running. A crash that really ends the session writes nothing — the next
// launch reports it via formatPreviousSessionBanner.
export function formatErrorBanner(
  pid: number,
  kind: string,
  uptimeMs: number,
): string {
  return `${MARKER} Dyad main-process error | pid ${pid} | ${kind} | uptime ${formatUptime(uptimeMs)} ${MARKER}`;
}

// lastSeenAt is the crashed session's final performance sample. It lags the
// crash by up to one heartbeat, so the uptime is approximate and always low.
export function formatPreviousSessionBanner(
  startedAt: number | undefined,
  lastSeenAt?: number,
): string {
  const started =
    startedAt === undefined
      ? "start time unknown"
      : `started ${formatTimestamp(startedAt)}`;
  return `${MARKER} Dyad previous session ended unexpectedly | ${started}${formatPreviousUptime(startedAt, lastSeenAt)} ${MARKER}`;
}

function formatPreviousUptime(
  startedAt: number | undefined,
  lastSeenAt: number | undefined,
): string {
  if (startedAt === undefined || lastSeenAt === undefined) {
    return "";
  }
  // A sample older than the session means it never took one, so it died early.
  // How early depends on how long startup took, so don't name a number.
  if (lastSeenAt <= startedAt) {
    return " | uptime unknown (ended before its first sample)";
  }
  return ` | ran ~${formatUptime(lastSeenAt - startedAt)}`;
}

// Matches electron-log's own line prefix format so the printed time can be
// compared directly against surrounding log lines. Local time, like theirs.
// Exported, like formatUptime, only so the tests can table-test it directly.
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

// Compact by design: this goes in a log column, not a sentence — "7h56m", not
// "7 hours". formatDuration in ipc/utils/pty_command_runner is the prose
// variant for user-facing text; they are deliberately separate.
export function formatUptime(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) {
    return "unknown";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d${hours}h${minutes}m`;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}
