/**
 * Normalises a user-entered domain into the full URL Coolify requires.
 *
 * Coolify validates this field as a URL and rejects a bare hostname, but a
 * bare hostname is what people type. Defaults to https so a real domain gets
 * a certificate; an explicit http:// is left alone.
 *
 * Returns null when the input is empty or cannot be parsed.
 */
export function normalizeCoolifyDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  const scheme = url.protocol.toLowerCase();
  if (scheme !== "https:" && scheme !== "http:") return null;
  if (!url.hostname) return null;

  return url.toString().replace(/\/$/, "");
}

/** The hostname alone, for a DNS lookup. */
export function coolifyDomainHostname(input: string): string | null {
  const normalized = normalizeCoolifyDomain(input);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname;
  } catch {
    return null;
  }
}
