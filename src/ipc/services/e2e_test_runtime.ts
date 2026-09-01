import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
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
import { killProcess } from "@/ipc/utils/process_manager";
import {
  getPackageManagerCommandEnv,
  getPnpmMinimumReleaseAgeSupport,
  PNPM_PM_ON_FAIL_IGNORE_ARG,
} from "@/ipc/utils/socket_firewall";

const logger = log.scope("e2e_test_runtime");
/**
 * Budget for a Dyad-managed app's own dev server. Deliberately generous: the
 * sandbox omits `.next`/`.vite`/`.svelte-kit` (the dev server rebuilds from
 * source), so every sandboxed run is a COLD compile, and on a large app on a
 * slow machine that routinely passes two minutes. The normal preview imposes no
 * deadline at all, so a tight cap here would fail runs that were merely slow.
 * This exists only so a truly stuck server cannot hang the run forever.
 */
const SERVER_READY_TIMEOUT_MS = 300_000;
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
/** How many ports a run tries before reporting that it couldn't get one. */
const PORT_START_ATTEMPTS = 3;

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
class PortInUseError extends Error {}

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
  stop(): Promise<void>;
}

/**
 * Ports handed out but whose server has not bound yet. The probe below binds
 * and immediately closes, so without this two runs starting within the same
 * second — tests for two different apps — would be handed the same port.
 */
const pendingE2eTestPorts = new Set<number>();

/** Probe one port. Resolves to the bound port, or null if it's unavailable. */
function probePort(port: number): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(null);
        return;
      }
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => {
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

export async function allocateE2eTestPort(
  /**
   * Ports this caller already lost a server on. `probePort` binds 127.0.0.1 and
   * closes immediately, so it cannot see every conflict that kills a real
   * server — an IPv6-only listener on the same port, or a process that binds
   * moments after the probe. Without an exclusion, a retry re-picks the port
   * that just failed.
   */
  excludedPorts: ReadonlySet<number> = new Set(),
): Promise<number> {
  // Scan Dyad's reserved band first. Binding port 0 would let the OS pick from
  // the ephemeral range, which on Linux (32768–60999) overlaps the app, proxy
  // and proxy-fallback bands almost entirely — so a test server could hold
  // another app's deterministic port for the length of a run and make that app
  // fail to start with nothing to point at as the cause.
  for (let offset = 0; offset < E2E_TEST_SERVER_PORT_RANGE; offset += 1) {
    const port = E2E_TEST_SERVER_PORT_START + offset;
    if (excludedPorts.has(port)) continue;
    if (pendingE2eTestPorts.has(port)) continue;
    // The band is above every *default* reserved range, but Dyad's own E2E
    // shards relocate those ranges: `DYAD_E2E_PORT_BLOCK_INDEX=9` puts a
    // block's proxy sub-range at 51550–52549, straight through this band. The
    // fallback loop below already asks; the band has to ask too.
    if (isReservedDyadPort(port)) continue;
    if ((await probePort(port)) !== null) {
      // Re-checked AFTER the await, not only before it. The probe binds and
      // closes, so a concurrent allocation suspended on the same port probes it
      // successfully too — and two runs for two different apps are not
      // serialized by the per-app operation coordinator. Only the allocation
      // that reaches this synchronous check-and-add first keeps the port; the
      // fallback loop below has always re-checked this way.
      if (pendingE2eTestPorts.has(port)) continue;
      pendingE2eTestPorts.add(port);
      return port;
    }
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
      !excludedPorts.has(port)
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
  installCommand,
  startCommand,
}: {
  workspacePath: string;
  port: number;
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
    // fail only under test. The sandbox is a fresh copy, so there is nothing
    // else that would have performed it.
    //
    // Each half is grouped. `&&` binds left-to-right, so an ungrouped
    // `install && A || B` runs `B` when the *install* fails, and
    // `install && A; B` runs `B` unconditionally — silently re-associating any
    // start command that contains a shell operator. `getDefaultCommand` groups
    // its own `install && dev` pair the same way.
    const trimmedStart = startCommand!.trim();
    const start = trimmedStart.includes("{port}")
      ? trimmedStart.replaceAll("{port}", String(port))
      : trimmedStart;
    return {
      command: `(${installCommand!.trim()}) && (${start})`,
      env: { ...process.env, PORT: String(port) },
    };
  }

  // Select the package manager the same way the normal preview does. Choosing
  // pnpm from the lockfile alone would break sandboxed runs on machines where
  // pnpm is missing or too old, even though the normal preview falls back to
  // npm there.
  const pnpmSupport = await getPnpmMinimumReleaseAgeSupport();
  const packageManager = choosePackageManagerFromSignal({
    signal: getPackageManagerSignal(workspacePath),
    pnpmAvailable: pnpmSupport.available,
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
 * Poll until the server answers, and report WHICH loopback address it answered
 * on.
 *
 * Both families are tried. Vite and Next bind the *hostname* `localhost`, and
 * on Node 17+ (verbatim DNS ordering — the default on Windows, and anywhere the
 * resolver returns `::1` first) that is an IPv6-only listener. `probePort` binds
 * 127.0.0.1 only, so allocation succeeds, the server comes up healthy on
 * `[::1]:port`, and a v4-only poll would get ECONNREFUSED until the whole
 * readiness budget expired — on a server that was serving the entire time. The
 * winner becomes Playwright's `baseURL`, so the tests reach the same address
 * the poll proved was answering.
 */
async function waitForReady({
  candidateUrls,
  port,
  process: child,
  signal,
  outputTail,
  spawnError,
  portHint,
  timeoutMs,
}: {
  candidateUrls: readonly string[];
  port: number;
  process: ChildProcess;
  signal?: AbortSignal;
  outputTail: () => string;
  spawnError: () => Error | undefined;
  portHint: string;
  timeoutMs: number;
}): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Test run stopped.");
    // Precondition throughout: a server that won't start or won't answer is a
    // user/environment problem (a broken start command, a port taken, a build
    // error), not a Dyad bug, and must not be reported as a product exception.
    // A port clash is the exception: the retry loop turns it into a fresh port,
    // and only a repeat failure reaches the user.
    const startError = spawnError();
    if (startError) {
      if (reportsPortInUse(startError.message, port)) {
        throw new PortInUseError(startError.message);
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
      );
    }
    for (const candidate of candidateUrls) {
      try {
        // ANY response means the server is listening, 5xx included. Requiring a
        // non-error status would refuse to start a run whose root route throws
        // in dev — an SSR app with one broken page — and then fail the whole
        // run on the readiness budget, including the specs that never visit
        // `/`. Tests against an app with a broken page are the case this
        // feature exists for, so the per-test failures have to reach the
        // report instead.
        const response = await fetch(candidate, {
          signal: AbortSignal.timeout(1_000),
        });
        // Drop the body. An unread `Response.body` keeps undici's socket — and
        // the dev server's connection — open for the rest of the run, and Node
        // warns about it.
        await response.body?.cancel();
        return candidate;
      } catch {
        // Not listening on this address yet.
      }
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

export interface StartE2eTestRuntimeOptions {
  workspacePath: string;
  installCommand?: string | null;
  startCommand?: string | null;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}

async function startE2eTestRuntimeOnce({
  workspacePath,
  installCommand,
  startCommand,
  signal,
  onOutput,
  excludedPorts,
}: StartE2eTestRuntimeOptions & {
  /** Mutated on failure so the next attempt cannot re-pick this port. */
  excludedPorts: Set<number>;
}): Promise<E2eTestRuntime> {
  if (signal?.aborted) throw new Error("Test run stopped.");
  const port = await allocateE2eTestPort(excludedPorts);
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
      installCommand,
      startCommand,
      signal,
      onOutput,
      onBound: releasePort,
    });
  } catch (error) {
    // Burn this port for the rest of the retry loop. `releasePort` below hands
    // it straight back to `allocateE2eTestPort`, which would re-probe it, find
    // it bindable on 127.0.0.1, and hand it back — so without this every
    // attempt lands on the same port and the retry is a no-op.
    excludedPorts.add(port);
    throw error;
  } finally {
    releasePort();
  }
}

async function startServerOnPort({
  port,
  workspacePath,
  installCommand,
  startCommand,
  signal,
  onOutput,
  onBound,
}: {
  port: number;
  workspacePath: string;
  installCommand?: string | null;
  startCommand?: string | null;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  onBound: () => void;
}): Promise<E2eTestRuntime> {
  // IPv4 first — it is what a dev server binding `0.0.0.0` or `127.0.0.1`
  // answers on, and the overwhelmingly common case — with the IPv6 loopback
  // behind it for servers that bind the `localhost` hostname on a box whose
  // resolver puts `::1` first. `waitForReady` returns whichever answered.
  const candidateUrls = [`http://127.0.0.1:${port}`, `http://[::1]:${port}`];
  const isCustom = hasCustomE2eStartCommand({ installCommand, startCommand });
  const { command, env } = await buildE2eTestStartCommand({
    workspacePath,
    port,
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
  const child = spawn(command, [], {
    cwd: workspacePath,
    env,
    shell: true,
    stdio: "pipe",
    detached: false,
  });
  const untrack = trackE2eTestProcess(child);

  let tail = "";
  const append = (data: unknown) => {
    const chunk = String(data);
    tail = `${tail}${chunk}`.slice(-8_000);
    onOutput?.(`[test server] ${chunk}`);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  let startError: Error | undefined;
  child.once("error", (error) => {
    startError = error;
    append(error.message);
  });

  let stopPromise: Promise<void> | undefined;
  const stop = () => {
    stopPromise ??= (async () => {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        await killProcess(child);
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
    })();
    return stopPromise;
  };
  const onAbort = () => void stop();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const baseUrl = await waitForReady({
      candidateUrls,
      port,
      process: child,
      signal,
      outputTail: () => tail,
      spawnError: () => startError,
      portHint,
      timeoutMs: e2eServerReadyTimeoutMs({ installCommand, startCommand }),
    });
    // The server owns the port now, so a concurrent allocation only needs the
    // real bind check to see it is taken.
    onBound();
    logger.info(`Isolated E2E server ready at ${baseUrl}`);
    return {
      baseUrl,
      process: child,
      stop: async () => {
        signal?.removeEventListener("abort", onAbort);
        await stop();
      },
    };
  } catch (error) {
    signal?.removeEventListener("abort", onAbort);
    await stop();
    throw error;
  }
}

export async function startE2eTestRuntime(
  options: StartE2eTestRuntimeOptions,
): Promise<E2eTestRuntime> {
  let lastError: unknown;
  // Shared across the three attempts, so each retry picks a port none of the
  // earlier ones already failed on.
  const excludedPorts = new Set<number>();
  for (let attempt = 0; attempt < PORT_START_ATTEMPTS; attempt += 1) {
    try {
      return await startE2eTestRuntimeOnce({ ...options, excludedPorts });
    } catch (error) {
      lastError = error;
      if (!(error instanceof PortInUseError)) throw error;
      // Only when a retry actually follows. On the last attempt the loop exits
      // straight into the failure below, and promising a retry that never comes
      // is the last thing the user reads before the run gives up.
      if (attempt < PORT_START_ATTEMPTS - 1) {
        options.onOutput?.(
          "[test server] The selected port was taken; retrying with another port…\n",
        );
      }
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
