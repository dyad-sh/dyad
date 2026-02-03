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

export function formatRelativeTime(date: Date, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diffMs = date.getTime() - Date.now();
  const absDiffMs = Math.abs(diffMs);

  if (absDiffMs < 1000 * 60 * 60) {
    // Less than 1 hour — show minutes
    const diffMinutes = Math.round(diffMs / (1000 * 60));
    return rtf.format(diffMinutes, "minute");
  }
  if (absDiffMs < 1000 * 60 * 60 * 24) {
    // Less than 1 day — show hours
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    return rtf.format(diffHours, "hour");
  }
  // Otherwise show days
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return rtf.format(diffDays, "day");
}
