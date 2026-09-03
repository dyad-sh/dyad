import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fsPromises from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import log from "electron-log";

import {
  E2E_TEST_SERVER_PORT_RANGE,
  E2E_TEST_SERVER_PORT_START,
  isReservedDyadPort,
} from "../../../shared/ports";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { trackE2eTestProcess } from "@/ipc/services/e2e_test_process_registry";
import {
  choosePackageManagerFromSignal,
  getPackageManagerSignal,
} from "@/ipc/utils/package_manager_selection";
import { forceKillProcessTree, killProcess } from "@/ipc/utils/process_manager";
import {
  getPackageManagerCommandEnv,
  getPnpmMinimumReleaseAgeSupport,
  PNPM_PM_ON_FAIL_IGNORE_ARG,
} from "@/ipc/utils/socket_firewall";

const logger = log.scope("e2e_test_runtime");
const SERVER_READY_TIMEOUT_MS = 120_000;
/**
 * Budget when the spawned command installs before it serves. A custom app's
 * install step runs inside the same shell command, so it spends the readiness
 * budget: `pip install -r requirements.txt`, `bundle install`, `go mod
 * download` or a cold `npm ci` routinely pass two minutes on a first run, and
 * charging them against the server's own budget would fail a run whose server
 * was about to come up. The normal preview imposes no deadline at all; this one
 * exists only so a truly stuck command cannot hang the run forever.
 */
const INSTALL_AND_SERVER_READY_TIMEOUT_MS = 900_000;
const SERVER_READY_POLL_MS = 250;
/**
 * How long a first answer has to keep standing before the run trusts it. The
 * probe proved the port was free on both loopbacks moments before the spawn, so
 * whatever answers is almost always the child — but a process that grabs the
 * port in between answers just as convincingly, and the child's own
 * `EADDRINUSE` arrives a beat later. Holding readiness open for this long lets
 * that contradiction surface, and the retry loop then picks a different port
 * instead of pointing Playwright at a stranger's server.
 */
const SERVER_READY_CONFIRM_MS = 1_000;
/**
 * Echoed by the shell between a custom app's install and start commands.
 *
 * Custom installs run inside the same spawned command as the server, and can
 * take minutes; until this appears the server has provably not been started, so
 * anything answering on the port is not it.
 */
export const INSTALL_COMPLETE_MARKER =
  "Dyad: install step finished, starting the test server";
/** Loopback addresses readiness accepts, in preference order. */
const READINESS_HOSTS = ["127.0.0.1", "[::1]"] as const;
/**
 * Directories a dev server serves at its URL root. Vite, Next, Astro, SvelteKit
 * and CRA all use `public`; Nuxt uses `.output/public` in production but
 * `public` in dev. First one that exists wins, and one is created when none do
 * — the workspace is a throwaway copy, so an extra file in it costs nothing.
 */
const SERVED_ROOT_DIRECTORIES = ["public", "static"] as const;

/**
 * Plant a run-scoped secret where the app's own server will serve it.
 *
 * This is the one piece of *positive* evidence readiness can get that the thing
 * answering on the port is the server we spawned: the file lives inside this
 * run's sandbox, which no other process on the machine is serving. A server
 * that doesn't serve static files at its root simply never returns it, and
 * readiness falls back to the circumstantial evidence it had before — so this
 * only ever adds certainty, never removes a way to become ready.
 *
 * Best-effort: a workspace that can't be written still runs.
 */
async function writeOwnershipNonce(
  workspacePath: string,
): Promise<{ nonce: string | null; servedPath: string }> {
  const nonce = randomUUID();
  const servedPath = `dyad-e2e-${nonce}.txt`;
  for (const directory of SERVED_ROOT_DIRECTORIES) {
    const root = path.join(workspacePath, directory);
    const exists = await fsPromises
      .stat(root)
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    if (!exists) continue;
    try {
      await fsPromises.writeFile(path.join(root, servedPath), nonce, "utf8");
      return { nonce, servedPath };
    } catch (error) {
      logger.warn(
        `Could not write the E2E ownership nonce to ${root}: ${error}`,
      );
      return { nonce: null, servedPath };
    }
  }
  try {
    const root = path.join(workspacePath, SERVED_ROOT_DIRECTORIES[0]);
    await fsPromises.mkdir(root, { recursive: true });
    await fsPromises.writeFile(path.join(root, servedPath), nonce, "utf8");
    return { nonce, servedPath };
  } catch (error) {
    logger.warn(`Could not create an E2E ownership nonce directory: ${error}`);
    return { nonce: null, servedPath };
  }
}

/**
 * How long the sandbox server gets to answer. A custom app's install step runs
 * inside the same shell command as its start command, so it spends this budget
 * too and needs a far larger one.
 */
export function e2eServerReadyTimeoutMs(app: {
  installCommand?: string | null;
  startCommand?: string | null;
}): number {
  return hasCustomE2eStartCommand(app)
    ? INSTALL_AND_SERVER_READY_TIMEOUT_MS
    : SERVER_READY_TIMEOUT_MS;
}

/**
 * The dev server can't have this port. Thrown instead of matched by regex on a
 * message, because the "exited before becoming ready" error embeds the last 8KB
 * of server output — an app whose dev script also starts a sidecar (Postgres,
 * Redis, a second worker) that logs about *its own* taken port would otherwise
 * be retried three times before the real error reached the user.
 */
class PortInUseError extends Error {
  constructor(
    message: string,
    /**
     * The port that turned out to be unusable. The retry loop excludes it from
     * the next allocation: `probePort` only binds `127.0.0.1`, so a listener on
     * `::1` (or one that appears between the probe and the spawn and stays)
     * leaves the probe succeeding on a port the dev server still cannot take.
     * Without this the rescan picks the same port every attempt and the run
     * fails with "couldn't get a free port" while the other 199 sit free.
     */
    readonly port: number,
  ) {
    super(message);
  }
}

/**
 * Whether some text reports that *this* port is taken. The port number is
 * required, for the same reason `PortInUseError` exists: a sidecar's clash on a
 * different port is not this server's problem. Covers Vite's `Port 1234 is in
 * use, trying another one...` (its default `strictPort: false`, which keeps the
 * process alive on a port Dyad isn't polling) and Node's `listen EADDRINUSE:
 * address already in use 127.0.0.1:1234`.
 */
function reportsPortInUse(text: string, port: number): boolean {
  return new RegExp(
    `port\\s+${port}\\s+is\\s+in\\s+use|(?:EADDRINUSE|address already in use)[^\\n]*[:\\s]${port}\\b`,
    "i",
  ).test(text);
}

export interface E2eTestRuntime {
  baseUrl: string;
  process: ChildProcess;
  /**
   * Stop the server tree. Resolves to whether it is CONFIRMED gone — false
   * means a descendant outlived SIGKILL's window and still holds the workspace
   * directory as its cwd, which the caller must not then delete.
   */
  stop(): Promise<boolean>;
}

/**
 * Ports handed out but whose server has not bound yet. The probe below binds
 * and immediately closes, so without this two runs starting within the same
 * second — tests for two different apps — would be handed the same port.
 */
const pendingE2eTestPorts = new Set<number>();

/**
 * Errors that mean the machine has no IPv6 loopback at all rather than that
 * something already holds the port. Treated as free: refusing every port on an
 * IPv4-only host would leave the allocator with nothing to hand out.
 */
const STACK_UNAVAILABLE_CODES = new Set([
  "EADDRNOTAVAIL",
  "EAFNOSUPPORT",
  "EINVAL",
  "ENOTSUP",
  "EPROTONOSUPPORT",
]);

/** Bind one loopback address. Resolves to the bound port, or null if taken. */
function bindProbe(
  port: number,
  host: string,
  treatStackUnavailableAsFree: boolean,
): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(null);
        return;
      }
      if (
        treatStackUnavailableAsFree &&
        STACK_UNAVAILABLE_CODES.has(error.code ?? "")
      ) {
        resolve(port);
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => resolve(null));
        return;
      }
      const bound = address.port;
      server.close((error) => (error ? reject(error) : resolve(bound)));
    });
  });
}

/**
 * Probe one port on both loopback stacks. Resolves to the bound port, or null
 * if it's unavailable.
 *
 * Both stacks, because `localhost` resolves to `::1` first on plenty of hosts:
 * a v4-only probe calls a port free that an `::1` listener already holds, the
 * dev server then can't take it, and the run burns a retry on a port that was
 * never usable. Checking both here is also what lets readiness trust that
 * nothing was serving on this port when the child was spawned.
 */
async function probePort(port: number): Promise<number | null> {
  const bound = await bindProbe(port, "127.0.0.1", false);
  if (bound === null) return null;
  return (await bindProbe(bound, "::1", true)) === null ? null : bound;
}

export async function allocateE2eTestPort(
  /**
   * Ports a caller has already tried and found unusable. `probePort` can only
   * answer for `127.0.0.1`, so a port it calls free may still be unbindable by
   * the dev server; without excluding those, a rescan hands back the same one.
   */
  excludePorts?: ReadonlySet<number>,
): Promise<number> {
  // Scan Dyad's reserved band first. Binding port 0 would let the OS pick from
  // the ephemeral range, which on Linux (32768–60999) overlaps the app, proxy
  // and proxy-fallback bands almost entirely — so a test server could hold
  // another app's deterministic port for the length of a run and make that app
  // fail to start with nothing to point at as the cause.
  for (let offset = 0; offset < E2E_TEST_SERVER_PORT_RANGE; offset += 1) {
    const port = E2E_TEST_SERVER_PORT_START + offset;
    if (pendingE2eTestPorts.has(port) || excludePorts?.has(port)) continue;
    // The band is above every *default* reserved range, but Dyad's own E2E
    // shards relocate those ranges: `DYAD_E2E_PORT_BLOCK_INDEX=9` puts a
    // block's proxy sub-range at 51550–52549, straight through this band. The
    // fallback loop below already asks; the band has to ask too.
    if (isReservedDyadPort(port)) continue;
    // Claimed BEFORE the probe is awaited, and released if it fails. Two
    // allocations racing would otherwise both pass the check above while
    // neither probe had resolved, and the bind inside `probePort` — which is
    // released between its two loopback attempts — is not a lock that holds
    // across them.
    pendingE2eTestPorts.add(port);
    try {
      if ((await probePort(port)) !== null) return port;
    } catch (error) {
      pendingE2eTestPorts.delete(port);
      throw error;
    }
    pendingE2eTestPorts.delete(port);
  }
  // Band exhausted (200 concurrent runs, or a foreign service squatting the
  // whole range): fall back to an OS-assigned port, rejecting any that lands in
  // a reserved band rather than giving up on running tests at all.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await probePort(0);
    if (
      port !== null &&
      !isReservedDyadPort(port) &&
      !pendingE2eTestPorts.has(port) &&
      !excludePorts?.has(port)
    ) {
      pendingE2eTestPorts.add(port);
      return port;
    }
  }
  // Precondition, like every other server-start failure here: the machine has
  // no free port to give, which is an environment problem the user acts on, not
  // a Dyad bug to record as a product exception.
  throw new DyadError(
    "Dyad couldn't find a free port for the isolated test server. Close some running servers and try again.",
    DyadErrorKind.Precondition,
  );
}

/** Hand a port back once its server has bound it (or failed to start). */
export function releaseE2eTestPort(port: number): void {
  pendingE2eTestPorts.delete(port);
}

/**
 * Whether the app supplies its own commands. Mirrors `getCommand` in
 * `app_runtime_service`: a command counts as custom only when BOTH the install
 * and the start command are set, so the sandbox and the normal preview never
 * disagree about which apps are Dyad-managed.
 */
export function hasCustomE2eStartCommand({
  installCommand,
  startCommand,
}: {
  installCommand?: string | null;
  startCommand?: string | null;
}): boolean {
  return Boolean(installCommand?.trim()) && Boolean(startCommand?.trim());
}

export async function buildE2eTestStartCommand({
  workspacePath,
  port,
  packageManager: packageManagerOverride,
  installCommand,
  startCommand,
}: {
  workspacePath: string;
  port: number;
  packageManager?: "npm" | "pnpm";
  installCommand?: string | null;
  startCommand?: string | null;
}): Promise<{ command: string; env: NodeJS.ProcessEnv }> {
  if (hasCustomE2eStartCommand({ installCommand, startCommand })) {
    // Run the user's commands verbatim — no `-- --port` appended, which would
    // break every custom server that doesn't accept that flag (a Python server,
    // a shell script, a CLI that spells it differently) under test only.
    // `{port}` is the explicit opt-in for pointing a custom server at the
    // run-scoped port; otherwise PORT is the only hint we can safely supply.
    //
    // Both commands, in the same `install && start` shape `getCommand` uses for
    // the preview. Running the start command alone would silently skip a step
    // the server may depend on — codegen, `prisma generate`, a build, a
    // non-npm dependency install — so the app would start under the preview and
    // fail only under test. The sandbox is a fresh snapshot, so there is nothing
    // else that would have performed it.
    //
    // Only the start half is grouped. `&&` binds left-to-right, so an ungrouped
    // `install && A || B` runs `B` when the *install* fails, and
    // `install && A; B` runs `B` unconditionally — silently re-associating any
    // start command that contains a shell operator. The install half is
    // deliberately left ungrouped, exactly as the preview runs it: a `(…)`
    // subshell would discard the shell state it sets up — a `cd`, an activated
    // virtualenv, an exported variable — so a command pair that works in the
    // preview would fail under test only.
    //
    // The marker between them is what readiness waits for. An install can run
    // for minutes before the server binds anything, and without a signal that
    // it finished, a stray listener that grabs the port in that window would be
    // accepted as the app under test.
    const trimmedStart = startCommand!.trim();
    const start = trimmedStart.includes("{port}")
      ? trimmedStart.replaceAll("{port}", String(port))
      : trimmedStart;
    return {
      command: `${installCommand!.trim()} && echo "${INSTALL_COMPLETE_MARKER}" && (${start})`,
      env: { ...process.env, PORT: String(port) },
    };
  }

  // Select the package manager the same way the normal preview does. Choosing
  // pnpm from the lockfile alone would break sandboxed runs on machines where
  // pnpm is missing or too old, even though the normal preview falls back to
  // npm there.
  const packageManager =
    packageManagerOverride ??
    choosePackageManagerFromSignal({
      signal: getPackageManagerSignal(workspacePath),
      pnpmAvailable: (await getPnpmMinimumReleaseAgeSupport()).available,
    });
  if (packageManager === "pnpm") {
    return {
      command: `pnpm ${PNPM_PM_ON_FAIL_IGNORE_ARG} run dev --port ${port}`,
      env: { ...getPackageManagerCommandEnv(), PORT: String(port) },
    };
  }
  return {
    command: `npm run dev -- --port ${port}`,
    env: { ...process.env, PORT: String(port) },
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Test run stopped."));
      return;
    }
    // `{ once: true }` only removes the listener when it FIRES. The readiness
    // poll calls this up to ~480 times per run, so without an explicit removal
    // on the normal path every poll leaves a listener (and its timer closure)
    // on the run's signal, and Node logs MaxListenersExceededWarning past 10.
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Test run stopped."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wait until the spawned server answers, and return the loopback URL it
 * answered on.
 *
 * Which address matters: a dev server told to bind `localhost` lands on `::1`
 * on plenty of hosts, and a v4-only poll would time out on a server that is
 * running perfectly well. Playwright is then pointed at whichever address
 * actually answered rather than at an assumed one.
 */
async function waitForReady({
  port,
  process: child,
  signal,
  outputTail,
  spawnError,
  portHint,
  timeoutMs,
  awaitInstallMarker,
  ownershipNonce,
  ownershipNonceFile,
}: {
  port: number;
  process: ChildProcess;
  signal?: AbortSignal;
  outputTail: () => string;
  spawnError: () => Error | undefined;
  portHint: string;
  timeoutMs: number;
  /** Whether the spawned command installs before it serves. */
  awaitInstallMarker: () => boolean;
  /** Run-scoped secret the sandbox serves, or null when it couldn't be written. */
  ownershipNonce: string | null;
  /** Path under the served root that returns it. */
  ownershipNonceFile: string;
}): Promise<string> {
  // Precondition throughout: a server that won't start or won't answer is a
  // user/environment problem (a broken start command, a port taken, a build
  // error), not a Dyad bug, and must not be reported as a product exception.
  // A port clash is the exception: the retry loop turns it into a fresh port,
  // and only a repeat failure reaches the user.
  const assertStillStarting = () => {
    if (signal?.aborted) throw new Error("Test run stopped.");
    const startError = spawnError();
    if (startError) {
      if (reportsPortInUse(startError.message, port)) {
        throw new PortInUseError(startError.message, port);
      }
      throw new DyadError(
        `Could not start the isolated test server: ${startError.message}`,
        DyadErrorKind.Precondition,
      );
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      if (reportsPortInUse(outputTail(), port)) {
        throw new PortInUseError(
          `The isolated test server exited because port ${port} was already in use.`,
          port,
        );
      }
      throw new DyadError(
        `The isolated test server exited before becoming ready.\n${outputTail()}`,
        DyadErrorKind.Precondition,
      );
    }
    if (reportsPortInUse(outputTail(), port)) {
      // Still running, just not here — Vite's default `strictPort: false` moves
      // to another port and says so. Without this the poll would sit on the
      // dead port for the whole budget and then report a timeout.
      throw new PortInUseError(
        `The isolated test server moved off port ${port} because it was already in use.`,
        port,
      );
    }
  };
  /**
   * Ask one address whether it is serving *this run's* workspace.
   *
   * `owned` is the only positive proof available here: the nonce file lives in
   * the sandbox's public directory, so a server that returns its contents is
   * serving a filesystem no other process on the machine has. A dev server that
   * doesn't serve static assets at the root (an API-only custom server) answers
   * `unknown` rather than `foreign` — its readiness then rests on the weaker
   * evidence below, which is what the whole port dance already gave us.
   */
  const probeAddress = async (
    candidateUrl: string,
  ): Promise<"owned" | "unknown" | "down"> => {
    try {
      // ANY HTTP response means something is bound and speaking HTTP, 5xx
      // included. Treating 5xx as "not ready" fails a server whose root route
      // happens to throw — an SSR error on `/`, an API-only server with a root
      // error handler, a page whose data isn't seeded — after the full
      // readiness budget, even though the specs target routes that work. Only a
      // transport failure means nothing is listening yet, and identifying the
      // responder is the nonce's job below, not the status code's.
      await fetch(candidateUrl, { signal: AbortSignal.timeout(1_000) });
    } catch {
      return "down"; // The server has not bound this address yet.
    }
    if (!ownershipNonce) return "unknown";
    try {
      const proof = await fetch(`${candidateUrl}/${ownershipNonceFile}`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (proof.ok && (await proof.text()).trim() === ownershipNonce) {
        return "owned";
      }
    } catch {
      // Fall through: not serving it is not evidence of anything.
    }
    return "unknown";
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertStillStarting();
    // Nothing the app serves can be the app until its install step has
    // finished. Skipping this check would let a process that took the port
    // during a multi-minute install pass for the server under test.
    let answered: string | null = null;
    if (!awaitInstallMarker()) {
      for (const host of READINESS_HOSTS) {
        const candidateUrl = `http://${host}:${port}`;
        const outcome = await probeAddress(candidateUrl);
        // Proved ours: return immediately, and prefer this address over one
        // that merely answered — with a foreign listener on the other loopback,
        // this is the only way to pick the child's.
        if (outcome === "owned") return candidateUrl;
        if (outcome === "unknown") answered ??= candidateUrl;
      }
    }
    if (answered) {
      // Unproven, so hold the answer open. `probePort` found both loopbacks
      // free just before the spawn, so a responder that isn't the child is a
      // narrow race — and the child announces it by failing to bind, which
      // `assertStillStarting` turns into a retry on a different port.
      const confirmUntil = Date.now() + SERVER_READY_CONFIRM_MS;
      while (Date.now() < confirmUntil) {
        await delay(SERVER_READY_POLL_MS, signal);
        assertStillStarting();
        // The proof can still arrive during the window — a dev server that is
        // mid-startup may answer `/` from memory before its static handler is
        // wired up.
        if (ownershipNonce && (await probeAddress(answered)) === "owned") {
          return answered;
        }
      }
      return answered;
    }
    await delay(SERVER_READY_POLL_MS, signal);
  }
  throw new DyadError(
    `The isolated test server did not become ready within ${Math.round(
      timeoutMs / 60_000,
    )} minutes.${portHint}\n${outputTail()}`,
    DyadErrorKind.Precondition,
  );
}

async function startE2eTestRuntimeOnce({
  workspacePath,
  packageManager,
  installCommand,
  startCommand,
  signal,
  onOutput,
  excludePorts,
}: {
  workspacePath: string;
  packageManager?: "npm" | "pnpm";
  installCommand?: string | null;
  startCommand?: string | null;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  excludePorts?: ReadonlySet<number>;
}): Promise<E2eTestRuntime> {
  if (signal?.aborted) throw new Error("Test run stopped.");
  const port = await allocateE2eTestPort(excludePorts);
  // Every exit from here on must hand the port back. Without this, anything
  // that throws before the try/catch below — a workspace read, the pnpm version
  // probe, `spawn` itself — permanently burns one of the 200 band ports, and
  // enough failures leave the process unable to allocate at all.
  let portReserved = true;
  const releasePort = () => {
    if (!portReserved) return;
    portReserved = false;
    releaseE2eTestPort(port);
  };
  try {
    return await startServerOnPort({
      port,
      workspacePath,
      packageManager,
      installCommand,
      startCommand,
      signal,
      onOutput,
      onBound: releasePort,
    });
  } finally {
    releasePort();
  }
}

async function startServerOnPort({
  port,
  workspacePath,
  packageManager,
  installCommand,
  startCommand,
  signal,
  onOutput,
  onBound,
}: {
  port: number;
  workspacePath: string;
  packageManager?: "npm" | "pnpm";
  installCommand?: string | null;
  startCommand?: string | null;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  onBound: () => void;
}): Promise<E2eTestRuntime> {
  const isCustom = hasCustomE2eStartCommand({ installCommand, startCommand });
  const { command, env } = await buildE2eTestStartCommand({
    workspacePath,
    port,
    packageManager,
    installCommand,
    startCommand,
  });
  // A verbatim custom command can only reach the run-scoped port through
  // `{port}` or PORT. If it ignores both it binds elsewhere and never answers
  // here, so name the fix instead of leaving a bare timeout.
  const portHint =
    isCustom && !startCommand!.includes("{port}")
      ? ` Your custom start command may be ignoring the PORT environment variable — add {port} to it so Dyad can tell it which port to use.`
      : "";
  const { nonce: ownershipNonce, servedPath: ownershipNonceFile } =
    await writeOwnershipNonce(workspacePath);
  const child = spawn(command, [], {
    cwd: workspacePath,
    env,
    shell: true,
    stdio: "pipe",
    detached: false,
  });
  const untrack = trackE2eTestProcess(child);

  let tail = "";
  // Sticky, and checked against the accumulated tail rather than the chunk: the
  // marker can arrive split across two reads, and the tail is truncated, so a
  // chatty server would otherwise push the announcement back out of view.
  let installComplete = !isCustom;
  const append = (data: unknown) => {
    const chunk = String(data);
    tail = `${tail}${chunk}`.slice(-8_000);
    if (!installComplete && tail.includes(INSTALL_COMPLETE_MARKER)) {
      installComplete = true;
    }
    onOutput?.(`[test server] ${chunk}`);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  let startError: Error | undefined;
  child.once("error", (error) => {
    startError = error;
    append(error.message);
  });

  let stopPromise: Promise<boolean> | undefined;
  const stop = () => {
    stopPromise ??= (async () => {
      let stopped = true;
      if (child.pid) {
        await killProcess(child);
        // Whether the tree is gone, judged on what a survivor would still be
        // holding rather than on the root's fate. `killProcess` usually ends
        // with the wrapper shell already exited, and a dev server that
        // daemonized or was reparented is then invisible to `tree-kill` and
        // emits no `close` — so the root's exit alone would report "confirmed"
        // for exactly the case that needs to say otherwise.
        const confirmStopped = async () => {
          await forceKillProcessTree(child);
          // Two independent facts, because neither alone is enough. The
          // wrapper shell outliving SIGKILL is a definite failure. And its
          // clean exit proves nothing about a descendant that daemonized or
          // was reparented — that survivor left the shell's tree, so
          // `forceKillProcessTree` can neither see nor signal it, yet it is
          // exactly what still holds the workspace as its cwd. Nothing can
          // bind the port while something is listening on it, on either stack,
          // so that is the observable tied to what the caller decides with.
          if (child.exitCode === null && child.signalCode === null) {
            return false;
          }
          return (await probePort(port)) !== null;
        };
        // `killProcess` resolves on its own 5s timeout with the tree still
        // alive, and the caller deletes the sandbox — this tree's cwd — the
        // moment `stop()` resolves. A survivor keeps serving the app under a
        // port a later run may allocate, and on Windows keeps the directory
        // locked so disposal fails. SIGTERM is the polite first ask; the
        // escalation above is the one that has to land before the directory
        // goes, and its verdict is returned rather than swallowed.
        stopped = await confirmStopped();
      }
      // `killProcess` also resolves on its own 5s timeout, with the tree still
      // alive. Untracking then would remove the one child `will-quit` still
      // needs to tree-kill — exactly the leak the registry exists to prevent —
      // and that survivor still holds the workspace cwd `dispose()` is about to
      // remove. Leave it registered; `trackE2eTestProcess`'s own exit/error
      // listeners drop it whenever it does die.
      //
      // A child with no pid never started, so there is nothing for quit to kill
      // and nothing that could later exit to drop it: untrack it here or it
      // sits in the registry for the life of the process.
      if (
        child.pid === undefined ||
        child.exitCode !== null ||
        child.signalCode !== null
      ) {
        untrack();
      }
      return stopped;
    })();
    return stopPromise;
  };
  const onAbort = () => void stop();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const baseUrl = await waitForReady({
      port,
      process: child,
      signal,
      outputTail: () => tail,
      spawnError: () => startError,
      portHint,
      timeoutMs: e2eServerReadyTimeoutMs({ installCommand, startCommand }),
      awaitInstallMarker: () => !installComplete,
      ownershipNonce,
      ownershipNonceFile,
    });
    // The server owns the port now, so a concurrent allocation only needs the
    // real bind check to see it is taken.
    onBound();
    logger.info(`Isolated E2E server ready on ${baseUrl}`);
    return {
      baseUrl,
      process: child,
      stop: async () => {
        signal?.removeEventListener("abort", onAbort);
        return stop();
      },
    };
  } catch (error) {
    signal?.removeEventListener("abort", onAbort);
    await stop();
    throw error;
  }
}

export async function startE2eTestRuntime(
  options: Omit<Parameters<typeof startE2eTestRuntimeOnce>[0], "excludePorts">,
): Promise<E2eTestRuntime> {
  let lastError: unknown;
  // `startE2eTestRuntimeOnce` hands its port back in a `finally`, so by the time
  // the failure arrives here the port is already back in the pool and the next
  // rescan starts from the same offset. Carry the ports that actually failed
  // across attempts, or a port that probes free but the server cannot bind —
  // an `::1`-only listener, or one that appears between probe and spawn and
  // stays — is picked all three times and the run reports "couldn't get a free
  // port" with 199 of the band still free.
  const failedPorts = new Set<number>();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await startE2eTestRuntimeOnce({
        ...options,
        excludePorts: failedPorts,
      });
    } catch (error) {
      lastError = error;
      if (!(error instanceof PortInUseError)) throw error;
      failedPorts.add(error.port);
      options.onOutput?.(
        "[test server] The selected port was taken; retrying with another port…\n",
      );
    }
  }
  // Same reasoning: three fresh ports all found taken means something else on
  // the machine holds them, not that Dyad malfunctioned. Left as-is when it is
  // already a classified DyadError (an abort, a Precondition from readiness).
  if (lastError instanceof PortInUseError) {
    throw new DyadError(
      `Dyad couldn't get a free port for the isolated test server: ${lastError.message}`,
      DyadErrorKind.Precondition,
    );
  }
  throw lastError;
}
