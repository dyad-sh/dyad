export const TEMP_PREVIEW_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export function getEffectiveTempPreviewExpiry(
  expiresAt: string | null,
  lastPublishedAt: string,
): string | null {
  if (expiresAt !== null && Number.isFinite(Date.parse(expiresAt))) {
    return expiresAt;
  }

  const lastPublishedAtMs = Date.parse(lastPublishedAt);
  if (!Number.isFinite(lastPublishedAtMs)) return null;
  return new Date(lastPublishedAtMs + TEMP_PREVIEW_LIFETIME_MS).toISOString();
}

export function isTempPreviewExpired(
  expiresAt: string | null,
  lastPublishedAt: string,
  now = Date.now(),
): boolean {
  const effectiveExpiry = getEffectiveTempPreviewExpiry(
    expiresAt,
    lastPublishedAt,
  );
  if (effectiveExpiry === null) return false;
  return Date.parse(effectiveExpiry) <= now;
}
