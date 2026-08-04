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
  hasDomain,
  hasNeon,
  hasSupabase,
}: {
  hasDomain: boolean;
  hasNeon: boolean;
  hasSupabase: boolean;
}): CoolifyInsecureWarning {
  if (hasDomain) return "none";
  if (hasNeon) return "breaks";
  if (hasSupabase) return "credentials-in-clear";
  // An app with no database has no sign-in to protect.
  return "none";
}
