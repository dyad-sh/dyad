/**
 * Locale-aware formatting utilities using the browser's Intl API.
 * These are available in Electron's Chromium without additional libraries.
 */

export function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

const ONE_MINUTE_IN_MS = 1000 * 60;
const ONE_HOUR_IN_MS = ONE_MINUTE_IN_MS * 60;
const ONE_DAY_IN_MS = ONE_HOUR_IN_MS * 24;

export function formatRelativeTime(date: Date, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diffMs = date.getTime() - Date.now();
  const absDiffMs = Math.abs(diffMs);

  if (absDiffMs < ONE_HOUR_IN_MS) {
    // Less than 1 hour — show minutes
    const diffMinutes = Math.round(diffMs / ONE_MINUTE_IN_MS);
    return rtf.format(diffMinutes, "minute");
  }
  if (absDiffMs < ONE_DAY_IN_MS) {
    // Less than 1 day — show hours
    const diffHours = Math.round(diffMs / ONE_HOUR_IN_MS);
    return rtf.format(diffHours, "hour");
  }
  // Otherwise show days
  const diffDays = Math.round(diffMs / ONE_DAY_IN_MS);
  return rtf.format(diffDays, "day");
}
