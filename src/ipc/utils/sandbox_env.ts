/**
 * The one place that decides what counts as a database credential, shared by
 * every isolation barrier a sandboxed test run puts up.
 *
 * Two channels have to be closed together, because an app reads whichever one
 * answers first:
 *
 * - the workspace's `.env.local`, which provider isolation rewrites; and
 * - the environment Dyad itself was launched with, which every child inherits.
 *
 * The second is the one that bites: `dotenv` does not overwrite a variable that
 * is already set, so a `DATABASE_URL` exported in the shell that started Dyad
 * silently wins over the isolated value written into the sandbox. Stripping the
 * inherited copy is what makes the sandbox's own file authoritative — it is not
 * only a Supabase concern, and a Neon branch run needs it just as much.
 */

/**
 * Deliberately broad and substring-matching. A miss here means live credentials
 * reach a sandboxed child, while a false positive costs one variable the app
 * can restore in its own `.env.local` — so the asymmetry runs one way.
 */
export const DATABASE_ENV_PATTERN =
  /(DATABASE_URL|DIRECT_URL|POSTGRES|SUPABASE|NEON|^PG(HOST|PORT|USER|PASSWORD|DATABASE)$)/i;

export function isDatabaseEnvKey(key: string): boolean {
  return DATABASE_ENV_PATTERN.test(key);
}

/**
 * `env` with every inherited database credential removed.
 *
 * Applied to the base environment of all three sandbox children — the
 * dependency install, the sandbox dev server, and the Playwright runner — so a
 * lifecycle script, a server route, or a spec that reads `process.env` directly
 * sees only what the sandbox chose to give it. Isolated credentials are layered
 * back on top by the caller that owns them.
 */
export function withoutInheritedDatabaseEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !isDatabaseEnvKey(key)),
  );
}
