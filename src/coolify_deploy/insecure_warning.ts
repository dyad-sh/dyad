export type CoolifyInsecureWarning = "none" | "credentials-in-clear" | "breaks";

/**
 * What to tell the user about deploying without a domain.
 *
 * Coolify generates a plain-HTTP address when no domain is set, and browsers
 * expose Web Crypto only in a secure context. Neon Auth's client calls
 * `crypto.randomUUID` while its module is still evaluating, so the app throws
 * before it mounts — a blank page rather than a degraded one. Supabase's client
 * checks for Web Crypto first and falls back, so it keeps working; what remains
 * there is the ordinary problem with auth over HTTP, which is that credentials
 * are readable in transit.
 */
export function coolifyInsecureWarning({
  isHttps,
  hasNeon,
  hasSupabase,
}: {
  /** Whether the app will actually be served over TLS. */
  isHttps: boolean;
  hasNeon: boolean;
  hasSupabase: boolean;
}): CoolifyInsecureWarning {
  // Keyed on the scheme, not on whether a domain was typed: an explicit
  // http:// domain is accepted and served without TLS, which is the same
  // insecure context as the generated address.
  if (isHttps) return "none";
  if (hasNeon) return "breaks";
  if (hasSupabase) return "credentials-in-clear";
  // An app with no database has no sign-in to protect.
  return "none";
}
