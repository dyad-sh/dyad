/**
 * Pure, dependency-free helpers for the Neon → Vercel sync. Kept separate from
 * `vercel_neon_sync.ts` (which pulls in the DB, settings, and SDK clients) so
 * they can be unit-tested in isolation.
 */

export type VercelEnvTarget = "production" | "preview" | "development";

/**
 * Env vars are written ONLY to the production Vercel environment. We
 * deliberately don't target preview/development: the synced DATABASE_URL is
 * usually the production branch, and exposing it to non-prod environments
 * (e.g. via a local `vercel env pull`) makes it easy to accidentally mutate the
 * production DB. Local development doesn't pull from Vercel, and Dyad apps
 * rarely use Vercel preview deployments, so production-only is the safer
 * default.
 */
export const VERCEL_ENV_TARGETS: VercelEnvTarget[] = ["production"];

export interface VercelEnvVar {
  key: string;
  value: string;
  type: "encrypted";
  target: VercelEnvTarget[];
}

/** The resolved Neon branch values that feed the Vercel env payload. */
export interface NeonBranchEnvValues {
  databaseUrl: string;
  neonAuthBaseUrl?: string;
  neonAuthCookieSecret?: string;
  isNextJs: boolean;
}

/**
 * Builds the Vercel env-var payload from resolved Neon branch values.
 * Always includes DATABASE_URL (POSTGRES_URL is intentionally NOT pushed to
 * Vercel); adds NEON_AUTH_BASE_URL when auth is active; adds
 * NEON_AUTH_COOKIE_SECRET only for Next.js apps (its only consumer).
 */
export function buildVercelEnvPayload(
  vars: NeonBranchEnvValues,
  { target }: { target: readonly VercelEnvTarget[] },
): VercelEnvVar[] {
  const targetArr = [...target];
  const payload: VercelEnvVar[] = [
    {
      key: "DATABASE_URL",
      value: vars.databaseUrl,
      type: "encrypted",
      target: targetArr,
    },
  ];

  if (vars.neonAuthBaseUrl) {
    payload.push({
      key: "NEON_AUTH_BASE_URL",
      value: vars.neonAuthBaseUrl,
      type: "encrypted",
      target: targetArr,
    });

    if (vars.isNextJs && vars.neonAuthCookieSecret) {
      payload.push({
        key: "NEON_AUTH_COOKIE_SECRET",
        value: vars.neonAuthCookieSecret,
        type: "encrypted",
        target: targetArr,
      });
    }
  }

  return payload;
}

/**
 * Normalizes a domain or URL to a canonical origin `https://<host>` for
 * comparison. Strips scheme/path/query/fragment, lowercases the host. Returns
 * null for empty or wildcard (`*`) values (which can't be redirect URIs).
 */
export function canonicalOrigin(value: string): string | null {
  if (!value) return null;
  let host = value.trim();
  if (!host) return null;
  // Strip scheme (http://, https://, etc.).
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  // Strip path, query, and fragment (keeps only the host[:port]).
  host = host.split(/[/?#]/)[0];
  host = host.toLowerCase();
  if (!host || host.includes("*")) return null;
  return `https://${host}`;
}

/**
 * Diffs Vercel domains against the existing Neon trusted-domain allowlist and
 * returns the canonical origins that need to be added (deduped, missing only).
 */
export function reconcileTrustedDomains(
  existingNeonDomains: string[],
  desiredVercelHosts: string[],
): string[] {
  const existing = new Set<string>();
  for (const d of existingNeonDomains) {
    const origin = canonicalOrigin(d);
    if (origin) existing.add(origin);
  }

  const toAdd: string[] = [];
  const seen = new Set<string>();
  for (const host of desiredVercelHosts) {
    const origin = canonicalOrigin(host);
    if (!origin || existing.has(origin) || seen.has(origin)) continue;
    seen.add(origin);
    toAdd.push(origin);
  }
  return toAdd;
}
