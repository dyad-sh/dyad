import { normalizeCoolifyDomain } from "./domain";

export type CoolifyServedScheme = "secure" | "insecure" | "unknown";

/**
 * Whether the app will be served over TLS.
 *
 * Four sources, in the order they settle the question:
 *
 * A typed domain decides on its own — it is what the next deploy sends.
 *
 * Otherwise, an application that already exists has its address fixed: Coolify
 * generated the fqdn once at creation, and a redeploy without a domain sends no
 * `domains`, so nothing regenerates it. Changing the server's wildcard later
 * does not move an app that is already on one.
 *
 * Otherwise, an application that deployed without Coolify naming an address is
 * one whose address exists but cannot be seen from here, so nothing is claimed
 * about it — the wildcard would describe a new application rather than this one.
 *
 * Only when no application exists yet does the wildcard predict anything: that
 * is what Coolify's generateUrl builds from, falling back to an sslip address
 * that is always plain HTTP. A server that reported no wildcard, and one that
 * reported nothing at all, are both read as plain here — the answer is the
 * same, and warning is the safe direction for a question we cannot settle.
 */
export function coolifyServedOverHttps({
  domain,
  deployedUrl,
  wildcardDomain,
  hasAddresslessDeploy = false,
}: {
  /** What the user typed. */
  domain: string;
  /** Where this app already is, but only if it is on the server now selected. */
  deployedUrl: string | null;
  /** The selected server's wildcard domain, if it reported one. */
  wildcardDomain: string | null | undefined;
  /**
   * A deploy succeeded and Coolify named no address for it. The application
   * exists and its address is fixed, so the wildcard describes what a new one
   * would get rather than what this one has.
   */
  hasAddresslessDeploy?: boolean;
}): CoolifyServedScheme {
  const typed = normalizeCoolifyDomain(domain);
  if (typed) {
    return typed.toLowerCase().startsWith("https:") ? "secure" : "insecure";
  }

  if (deployedUrl) {
    return deployedUrl.toLowerCase().startsWith("https:")
      ? "secure"
      : "insecure";
  }

  // Nothing to answer from, so nothing is claimed — the same reasoning the
  // DNS pre-check applies when it has no address to compare against.
  if (hasAddresslessDeploy) return "unknown";

  // Matched on an explicit scheme rather than normalized: Coolify reads the
  // scheme off the wildcard as stored and does not supply a missing one.
  return wildcardDomain?.trim().toLowerCase().startsWith("https://")
    ? "secure"
    : "insecure";
}

export type CoolifyInsecureWarning =
  | "none"
  | "credentials-in-clear"
  | "breaks"
  | "unverified";

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
  served,
  hasNeon,
  hasSupabase,
}: {
  /** What the app will be served over, where that can be established. */
  served: CoolifyServedScheme;
  hasNeon: boolean;
  hasSupabase: boolean;
}): CoolifyInsecureWarning {
  // Keyed on the scheme, not on whether a domain was typed: an explicit
  // http:// domain is accepted and served without TLS, which is the same
  // insecure context as the generated address.
  if (served === "secure") return "none";
  // An app with no database has no sign-in to protect, so an address we
  // cannot establish costs it nothing either.
  if (!hasNeon && !hasSupabase) return "none";
  // Saying "this will not work" would be a guess, and a guess that is wrong
  // teaches people to close the box. Saying nothing hides the one case where
  // both this panel and the deploy log report a success that reached nothing.
  if (served === "unknown") return "unverified";
  if (hasNeon) return "breaks";
  return "credentials-in-clear";
}
