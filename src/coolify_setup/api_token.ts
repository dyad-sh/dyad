import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { COOLIFY_SCOPES_PHP_ARRAY } from "@/shared/coolify_scopes";
import { SshError } from "@/ipc/utils/ssh_client";
import type { SshSession } from "@/ipc/utils/ssh_client";
import { runTinker } from "./tinker";

/**
 * How long one of these questions may take.
 *
 * Each is a tinker one-liner against a Coolify that is already up, so the
 * honest answer arrives in seconds. Unbounded, a wedged docker leaves
 * "Setting up API access" on screen forever with nothing behind it.
 */
const TINKER_TIMEOUT_MS = 30_000;

/**
 * Turning Coolify's API on and creating a token for it, without the dashboard.
 *
 * Coolify ships with its API off and offers no way to change that or to create
 * a token except by hand in the browser. So both are done by driving Laravel
 * and Sanctum directly, which is not an interface anybody promised to keep.
 * Every workaround below is marked, and each says what would replace it.
 *
 * All of it is best-effort. When any part of it does not work the caller falls
 * back to asking the user for a token, which is the path Dyad has always had.
 */

/**
 * The last version this was checked against.
 *
 * Not a maximum. The path is attempted on anything at or above the version it
 * was written for and simply reports failure otherwise — refusing outright
 * would turn a working instance into a manual one for no reason, and the
 * fallback already covers being wrong.
 */
export const VERIFIED_AGAINST = "4.3.2";

/** Coolify's API was off by default when this was written. */
const MINIMUM_SUPPORTED = "4.0.0";

/**
 * Compares dotted versions numerically.
 *
 * String comparison puts 4.10.0 before 4.9.0, which would silently disable the
 * automated path on newer instances.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Reads the version of the Coolify that was just installed.
 *
 * Read rather than chosen: the installer resolves "latest" when it runs, so
 * there is no version to pin at install time and the only way to know what
 * landed is to ask it afterwards.
 *
 * WORKAROUND: the version endpoint needs the API, and whether the API can be
 * turned on is what this answers, so it reads the config value directly.
 *
 * TODO: replace if a fresh Coolify gains a way to state its version before its
 * API is reachable.
 */
export async function readCoolifyVersion(
  session: SshSession,
  { signal }: { signal?: AbortSignal } = {},
): Promise<string | null> {
  try {
    const output = await runTinker(
      session,
      `echo config('constants.coolify.version');`,
      { signal, timeoutMs: TINKER_TIMEOUT_MS },
    );
    return /^\d+\.\d+/.test(output.trim()) ? output.trim() : null;
  } catch (error) {
    // A cancelled setup is the user stopping, not an instance that cannot be
    // driven. Swallowing it here would report a version problem for something
    // they did on purpose, and carry on setting the server up.
    if ((error as { kind?: string }).kind === "user_cancelled") throw error;
    // A link that has died is not an instance whose version cannot be read.
    // Returning null here says the version is the problem, and the caller
    // tells the user their freshly installed Coolify is too old to drive —
    // for a question that never reached it. The same line isAdminSeeded
    // draws: a bound Dyad imposed is worth another look, a lost connection
    // is not.
    if (error instanceof SshError && error.failure !== "command-timeout") {
      throw error;
    }
    // An instance too old or too different to answer is one to set up by hand.
    return null;
  }
}

export function supportsAutomaticToken(version: string | null): boolean {
  if (!version) return false;
  return compareVersions(version, MINIMUM_SUPPORTED) >= 0;
}

/**
 * Turns the API on.
 *
 * WORKAROUND: Coolify has a migration named disable_api_by_default and no
 * setting, command or endpoint to reverse it, so this writes the model field
 * the dashboard's own toggle writes.
 *
 * TODO: replace with whatever Coolify offers if it ever gains a way to enable
 * the API at install time — an installer environment variable would be the
 * natural shape, and would make this function unnecessary rather than smaller.
 */
export async function enableApi(
  session: SshSession,
  { signal }: { signal?: AbortSignal } = {},
): Promise<void> {
  const output = await runTinker(
    session,
    [
      `$s = \\App\\Models\\InstanceSettings::get();`,
      `$s->is_api_enabled = true;`,
      `$s->save();`,
      `echo $s->is_api_enabled ? 'enabled' : 'still-disabled';`,
    ].join("\n"),
    { signal, timeoutMs: TINKER_TIMEOUT_MS },
  );
  if (output.trim() !== "enabled") {
    throw new DyadError(
      "Could not turn Coolify's API on automatically.",
      DyadErrorKind.External,
    );
  }
}

/**
 * Creates an API token for Dyad.
 *
 * WORKAROUND, in two parts.
 *
 * There is no artisan command that mints a token, so this calls Sanctum's
 * createToken directly. And Coolify overrides createToken to stamp the row with
 * `session('currentTeam')->id`; tinker has no session, so without seeding one
 * the insert fails on a not-null constraint against team_id. The session line
 * is doing real work, not defensive coding.
 *
 * TODO: replace both halves if Coolify gains a token-minting command or an
 * endpoint that does not need a browser session.
 */

export async function mintApiToken(
  session: SshSession,
  adminEmail: string,
  {
    signal,
    tokenName = "dyad",
  }: { signal?: AbortSignal; tokenName?: string } = {},
): Promise<string> {
  if (!/^[A-Za-z0-9 _-]{1,40}$/.test(tokenName)) {
    throw new DyadError(
      `Unsafe token name: ${tokenName}`,
      DyadErrorKind.Internal,
    );
  }
  const output = await runTinker(
    session,
    // One statement per line and no early returns: tinker evaluates what it is
    // fed as top-level code, where `return` is a parse error — and a script
    // that does not parse produces no output at all rather than the branch it
    // was meant to take.
    [
      `$u = \\App\\Models\\User::where('email', getenv('DYAD_ADMIN_EMAIL'))->first();`,
      `$team = $u ? $u->teams()->first() : null;`,
      // The session line is doing real work: Coolify's createToken override
      // reads the team from a session tinker does not otherwise have, and the
      // insert fails on team_id without it.
      `if ($team) { session(['currentTeam' => $team]); }`,
      `echo !$u ? 'no-user' : (!$team ? 'no-team' : $u->createToken('${tokenName}', ${COOLIFY_SCOPES_PHP_ARRAY}, null)->plainTextToken);`,
    ].join("\n"),
    {
      env: { DYAD_ADMIN_EMAIL: adminEmail },
      signal,
      timeoutMs: TINKER_TIMEOUT_MS,
    },
  );

  const token = output.trim();
  if (token === "no-user") {
    throw new DyadError(
      "Coolify has no account for this address, so no token could be created.",
      DyadErrorKind.Precondition,
    );
  }
  if (token === "no-team") {
    throw new DyadError(
      "Coolify's admin account has no team yet, so no token could be created.",
      DyadErrorKind.Precondition,
    );
  }
  // Sanctum's plain text token is `<id>|<40+ characters>`. Checking the shape
  // keeps a stray warning or a partial line from being stored as a credential
  // and failing much later, somewhere that cannot explain itself.
  if (!/^\d+\|[A-Za-z0-9]{40,}$/.test(token)) {
    throw new DyadError(
      "Coolify did not return a usable API token.",
      DyadErrorKind.External,
    );
  }
  return token;
}

export interface AutomaticAccess {
  token: string;
  version: string | null;
}

/**
 * Enables the API and mints a token, or reports that it could not.
 *
 * Returns null rather than throwing when the instance is one this cannot drive,
 * because that is not a failure — it is the ordinary case of an instance Dyad
 * did not install, and the caller asks for a token by hand instead.
 */
export async function tryAutomaticAccess(
  session: SshSession,
  adminEmail: string,
  {
    signal,
    onApiEnabled,
  }: { signal?: AbortSignal; onApiEnabled?: () => void } = {},
): Promise<AutomaticAccess | null> {
  const version = await readCoolifyVersion(session, { signal });
  if (!supportsAutomaticToken(version)) return null;
  await enableApi(session, { signal });
  // Said here rather than inferred from the token below, because minting is
  // its own step and can fail on its own — an account with no team, a link
  // that drops — long after this one has taken effect on the server.
  onApiEnabled?.();
  const token = await mintApiToken(session, adminEmail, { signal });
  return { token, version };
}
