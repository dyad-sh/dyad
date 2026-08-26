import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { sleep } from "./sleep";
import { plainUrlFor } from "./https_setup";
import { SshError } from "@/ipc/utils/ssh_client";
import type { SshSession } from "@/ipc/utils/ssh_client";
import { runTinker } from "./tinker";
import type { AdminCredentials } from "./admin_credentials";
import { isShellSafe } from "./admin_credentials";

/**
 * Installing Coolify on a bare server.
 *
 * The installer is fetched on the server and fed to a shell there, with the
 * admin account's details in the environment. Coolify seeds that account itself
 * on first start, which is what saves the user a trip to the dashboard.
 */

/** Coolify's own published installer. */
const INSTALLER_URL = "https://cdn.coollabs.io/coolify/install.sh";

/** Coolify asks for 2GB; below it the install completes and then falls over. */
const MINIMUM_MEMORY_MB = 1900;

export interface Preflight {
  ready: boolean;
  /** Present when ready is false, phrased for the user. */
  reason?: string;
  alreadyInstalled: boolean;
  /**
   * Whether the probe actually settled the Coolify question.
   *
   * False means the evidence was unusable, not that the server is empty —
   * docker wedged, or nothing read back at all. The two are the same
   * `alreadyInstalled: false` and must not be treated alike: one of them is
   * what stands between a user and installing over an instance that is
   * already there, or dropping the only copy of a live admin password.
   */
  installedKnown: boolean;
  memoryMb: number | null;
}

/**
 * How long a question may take before it is not worth waiting for.
 *
 * Each of these is short and has an honest answer in seconds. A server whose
 * docker has wedged answers none of them at all, and unbounded the step simply
 * never ends — the user has to work out that nothing is happening and stop it
 * themselves. The installer stays unbounded: it genuinely runs for minutes
 * with nothing to say.
 */
const PROBE_TIMEOUT_MS = 30_000;
/** Longer, because the seeder writes to Coolify's own database. */
const SEEDER_TIMEOUT_MS = 60_000;

/**
 * Looks at the server before touching it.
 *
 * Checked first because the install takes minutes and every one of these is
 * something the user can act on immediately — and because installing over an
 * existing Coolify would be far worse than declining to.
 */

export async function preflight(
  session: SshSession,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Preflight> {
  const probe = await session.run(
    // One round trip rather than several: each answer is a labelled line, so a
    // missing one is distinguishable from an empty one.
    [
      "echo \"mem=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null)\"",
      // Whether Coolify is actually there, rather than whether a directory
      // with its name is. A failed install leaves the directory behind, and
      // treating that as an install refuses the retry that would fix it.
      `echo "container=$(docker ps -a --filter name=^coolify$ --format '{{.Names}}' 2>/dev/null | head -1)"`,
      // Whether the answer above means anything. A docker that is installed
      // but not running answers nothing at all, which reads the same as a
      // machine with no Coolify on it.
      `echo "dockerok=$(if docker info >/dev/null 2>&1; then echo yes; elif command -v docker >/dev/null 2>&1; then echo no; else echo absent; fi)"`,
      // A cloud server runs its own updates on first boot and holds the
      // package lock while it does. Coolify's installer needs that lock to
      // install Docker, fails when it cannot get it, and leaves the server
      // half-set-up — so this is worth a second of checking beforehand.
      // Asked of the lock rather than of process names: the updater runs as
      // python3 with its own name only in the command line, so no name match
      // finds it. fuser is not everywhere, so a name check still backs it up.
      `echo "busy=$(fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock >/dev/null 2>&1 || pgrep -x 'apt|apt-get|dpkg' >/dev/null 2>&1 && echo yes || echo no)"`,
    ].join("; "),
    { signal, timeoutMs: PROBE_TIMEOUT_MS },
  );

  const read = (key: string): string | null => {
    const match = new RegExp(`^${key}=(.*)$`, "m").exec(probe.stdout);
    return match ? match[1].trim() : null;
  };

  // Every answer below is read out of one round trip, so an empty transcript
  // is not a server with nothing on it — it is a question that never got
  // asked. Answering it as "ready, no Coolify here" is the one wrong answer
  // that matters: it is what stands between the user and installing over an
  // instance that is already there.
  if (read("mem") === null && read("busy") === null) {
    return {
      ready: false,
      alreadyInstalled: false,
      installedKnown: false,
      memoryMb: null,
      reason:
        "Dyad could not read anything back from this server. It answered the " +
        "connection but not the question — check it and try again.",
    };
  }

  // Docker is there but will not answer, so what it said about Coolify is
  // not evidence. Installing over an instance that is merely stopped is the
  // outcome worth refusing.
  if (read("dockerok") === "no") {
    return {
      ready: false,
      alreadyInstalled: false,
      installedKnown: false,
      memoryMb: null,
      reason:
        "Docker is installed on this server but not responding, so Dyad " +
        "cannot tell whether Coolify is already on it. Start Docker and try " +
        "again.",
    };
  }

  const memoryRaw = read("mem");
  const memoryMb =
    memoryRaw && /^\d+$/.test(memoryRaw) ? Number(memoryRaw) : null;
  const alreadyInstalled = Boolean(read("container"));

  if (read("busy") === "yes") {
    return {
      ready: false,
      alreadyInstalled,
      installedKnown: true,
      memoryMb,
      reason:
        "This server is still finishing its own first-boot setup, which holds " +
        "the package manager Coolify's installer needs. Wait a minute and " +
        "check again.",
    };
  }
  if (alreadyInstalled) {
    return {
      ready: false,
      alreadyInstalled,
      installedKnown: true,
      memoryMb,
      reason:
        "This server already has Coolify on it. Connect to it with an API token " +
        "instead of installing again.",
    };
  }
  if (memoryMb !== null && memoryMb < MINIMUM_MEMORY_MB) {
    return {
      ready: false,
      alreadyInstalled,
      installedKnown: true,
      memoryMb,
      reason:
        `This server has ${memoryMb}MB of memory and Coolify needs about 2GB. ` +
        `Installing would finish and then fail to run.`,
    };
  }
  return { ready: true, alreadyInstalled, installedKnown: true, memoryMb };
}

/**
 * The command that installs Coolify with its admin account seeded.
 *
 * Values are single-quoted and anything that could end that quoting is refused
 * rather than escaped — these run as root on somebody else's machine, and a
 * near-miss there is a command injection.
 *
 * The installer itself is piped to a shell, which is Coolify's documented way
 * of running it.
 */
export function buildInstallScript(credentials: AdminCredentials): string {
  for (const [label, value] of Object.entries(credentials)) {
    if (!isShellSafe(value)) {
      throw new DyadError(
        `The ${label} contains a character that cannot be sent safely.`,
        DyadErrorKind.Validation,
      );
    }
  }
  return (
    [
      // Without it the pipeline reports what the last command did, and a curl
      // that downloaded nothing still ends in a bash that exits 0 — so a
      // failed download would read as a finished install.
      "set -o pipefail",
      `export ROOT_USERNAME='${credentials.username}'`,
      `export ROOT_USER_EMAIL='${credentials.email}'`,
      `export ROOT_USER_PASSWORD='${credentials.password}'`,
      'curl -fsSL "$1" | bash',
    ].join("\n") + "\n"
  );
}

/**
 * The command the script above is fed to.
 *
 * The address is an argument and the credentials are not: a command line is
 * readable by every user on the machine through `ps`, while stdin is not. The
 * installer's address is public, and having it there says what a long-running
 * root command is doing.
 */
export function buildInstallCommand(): string {
  return `bash -s -- ${INSTALLER_URL}`;
}

export async function installCoolify(
  session: SshSession,
  credentials: AdminCredentials,
  {
    onOutput,
    signal,
  }: { onOutput?: (chunk: string) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const result = await session.run(buildInstallCommand(), {
    input: buildInstallScript(credentials),
    onOutput,
    signal,
  });
  if (result.code !== 0) {
    // The installer's own last words, rather than only its exit code. Its
    // most common failure on a new cloud server is losing a race for the
    // package lock against the server's own first-boot updates, and that is
    // only visible in what it printed.
    const tail = `${result.stdout}\n${result.stderr}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-3)
      .join(" ");
    throw new DyadError(
      `Installing Coolify failed (exit ${result.code}).` +
        (tail ? ` The server said: ${tail}` : ""),
      DyadErrorKind.External,
    );
  }
}

/**
 * Where the dashboard answers.
 *
 * The same address the setup stores and shows the user, from one definition:
 * two copies meant a change to the port could move only half of them.
 */

/**
 * Waits for the dashboard to answer.
 *
 * The installer returns before Coolify is listening, so this is what stands
 * between finishing the install and using it. Any answer counts — a redirect to
 * the login page is the dashboard working, not a failure.
 */
export async function waitForDashboard(
  host: string,
  {
    timeoutMs = 5 * 60 * 1000,
    intervalMs = 5_000,
    signal,
    now = () => Date.now(),
    fetchImpl = fetch,
  }: {
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
    now?: () => number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<boolean> {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (signal?.aborted) {
      throw new DyadError("Cancelled.", DyadErrorKind.UserCancelled);
    }
    try {
      const res = await fetchImpl(plainUrlFor(host), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
      if (res.status > 0) return true;
    } catch {
      // Not listening yet, which is the expected state for the first minute.
    }
    await sleep(intervalMs, signal);
  }
  return false;
}

/**
 * Whether Coolify has the account yet.
 *
 * A question about right now, not a verdict: the account is created by a
 * startup service, and the dashboard starts answering before that service has
 * run. Asked once, immediately, this says "no" about a server that is merely
 * still starting.
 *
 * WORKAROUND: nothing exposes whether the first account exists, so this asks
 * the model.
 *
 * TODO: replace if Coolify gains a way to ask about, or create, the first user.
 */
export async function isAdminSeeded(
  session: SshSession,
  email: string,
  { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<boolean> {
  try {
    const output = await runTinker(
      session,
      `echo \\App\\Models\\User::where('email', getenv('DYAD_ADMIN_EMAIL'))->exists() ? 'yes' : 'no';`,
      { env: { DYAD_ADMIN_EMAIL: email }, signal, timeoutMs },
    );
    return output.trim() === "yes";
  } catch (error) {
    // A container still starting cannot answer at all. That is not the same as
    // answering no, and treating it as one is how a healthy server gets
    // reported as a rejected email address.
    const kind = (error as { kind?: string }).kind;
    if (kind === "user_cancelled") throw error;
    // A connection that has died is not a container still starting: waiting
    // longer cannot help, and swallowing it reports a lost link as Coolify
    // refusing the address. A bound we imposed ourselves is the opposite —
    // the link is fine and the question is worth asking again, which is the
    // whole reason the caller is polling.
    if (error instanceof SshError && error.failure !== "command-timeout") {
      throw error;
    }
    return false;
  }
}

/**
 * Runs Coolify's own seeder and returns what it said.
 *
 * Used only after waiting has not produced an account. It is both the repair —
 * if the startup service somehow did not run, this runs it — and the
 * diagnosis, because the seeder names the reason it refuses rather than
 * leaving us to guess at one.
 *
 * WORKAROUND: an internal seeder is the only thing that creates the first
 * user, so it is invoked by name.
 *
 * TODO: replace if Coolify gains a supported way to create the first account.
 */
export async function runAdminSeeder(
  session: SshSession,
  { signal }: { signal?: AbortSignal } = {},
): Promise<string> {
  const result = await session.run(
    "docker exec -i coolify php artisan db:seed --class=RootUserSeeder --no-ansi --force",
    { signal, timeoutMs: SEEDER_TIMEOUT_MS },
  );
  return `${result.stdout}\n${result.stderr}`.trim();
}

export interface AdminSeedOutcome {
  seeded: boolean;
  /** The seeder's own words, when it had something to say about refusing. */
  reason?: string;
}

/**
 * Waits for the admin account, repairing and diagnosing if it never appears.
 *
 * The account arrives a little after the dashboard does, so this polls rather
 * than deciding on the first answer. If waiting is not enough it runs the
 * seeder directly: that fixes the case where the startup service did not run,
 * and where the address is genuinely refused it produces the reason instead of
 * an accusation invented here.
 */
export async function waitForAdminSeeded(
  session: SshSession,
  email: string,
  {
    timeoutMs = 90_000,
    intervalMs = 5_000,
    attemptTimeoutMs = 20_000,
    signal,
    now = () => Date.now(),
  }: {
    timeoutMs?: number;
    intervalMs?: number;
    /** One question, bounded — the loop's deadline cannot bound it. */
    attemptTimeoutMs?: number;
    signal?: AbortSignal;
    now?: () => number;
  } = {},
): Promise<AdminSeedOutcome> {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    // Each attempt is bounded, not only the loop: asking goes over SSH, and a
    // wedged docker daemon answers nothing at all, so an unbounded attempt
    // outlasts the deadline it is supposed to be inside. Bounded in the
    // command rather than raced beside it, so giving up on the answer also
    // stops the question.
    const answered = await isAdminSeeded(session, email, {
      signal,
      timeoutMs: attemptTimeoutMs,
    });
    if (answered) return { seeded: true };
    await sleep(intervalMs, signal);
  }

  let output = "";
  try {
    output = await runAdminSeeder(session, { signal });
  } catch {
    // Cancelling stops this the way it stops everything else, and that is not
    // a server that would not seed. It has to stay a cancellation, or the run
    // ends by telling the user to go and sign in to an install they stopped.
    if (signal?.aborted) {
      throw new DyadError("Cancelled.", DyadErrorKind.UserCancelled);
    }
    // Anything else leaves the install standing. Coolify is on the server, and
    // a seeder that timed out or died says nothing either way about whether
    // the account exists — so it is asked below rather than assumed, and what
    // comes back is a server to sign in to by hand rather than a failed run.
    // Ending here instead would take the password down with it.
  }
  // Asked once more, bounded like every other question. A bound that is hit
  // reads as "no account yet" rather than as a failure — isAdminSeeded already
  // answers that way — so the seeder's own words, which say why it refused,
  // are what gets reported below.
  if (
    await isAdminSeeded(session, email, { signal, timeoutMs: attemptTimeoutMs })
  ) {
    return { seeded: true };
  }

  // Coolify prints its complaint as "ERROR  Invalid Root User Environment
  // Variables" followed by the field it objected to. Handing that back beats
  // naming a cause we only assumed.
  const complaint = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("→") || /invalid|error/i.test(line))
    .join(" ")
    .trim();
  return { seeded: false, reason: complaint || undefined };
}
