import { normalizeCoolifyDomain } from "./domain";

/**
 * Whether the app will be served over TLS.
 *
 * Three sources, in the order they settle the question:
 *
 * A typed domain decides on its own — it is what the next deploy sends.
 *
 * Otherwise, an application that already exists has its address fixed: Coolify
 * generated the fqdn once at creation, and a redeploy without a domain sends no
 * `domains`, so nothing regenerates it. Changing the server's wildcard later
 * does not move an app that is already on one.
 *
 * Only when no application exists yet does the wildcard predict anything: that
 * is what Coolify's generateUrl builds from, falling back to an sslip address
 * that is always plain HTTP. A server that reported no wildcard, and one that
 * reported nothing at all, are both handled here as "not https" — the answer is
 * the same, and warning is the safe direction for a question we cannot settle.
 */
export function coolifyServedOverHttps({
  domain,
  deployedUrl,
  wildcardDomain,
}: {
  /** What the user typed. */
  domain: string;
  /** Where this app already is, but only if it is on the server now selected. */
  deployedUrl: string | null;
  /** The selected server's wildcard domain, if it reported one. */
  wildcardDomain: string | null | undefined;
}): boolean {
  const typed = normalizeCoolifyDomain(domain);
  if (typed) return typed.toLowerCase().startsWith("https:");

  if (deployedUrl) return deployedUrl.toLowerCase().startsWith("https:");

  // Matched on an explicit scheme rather than normalized: Coolify reads the
  // scheme off the wildcard as stored and does not supply a missing one.
  return Boolean(wildcardDomain?.trim().toLowerCase().startsWith("https://"));
}

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
