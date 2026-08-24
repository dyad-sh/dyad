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
const SERVER_READY_TIMEOUT_MS = 120_000;
const SERVER_READY_POLL_MS = 250;

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

export async function allocateE2eTestPort(): Promise<number> {
  // Scan Dyad's reserved band first. Binding port 0 would let the OS pick from
  // the ephemeral range, which on Linux (32768–60999) overlaps the app, proxy
  // and proxy-fallback bands almost entirely — so a test server could hold
  // another app's deterministic port for the length of a run and make that app
  // fail to start with nothing to point at as the cause.
  for (let offset = 0; offset < E2E_TEST_SERVER_PORT_RANGE; offset += 1) {
    const port = E2E_TEST_SERVER_PORT_START + offset;
    if (pendingE2eTestPorts.has(port)) continue;
    if ((await probePort(port)) !== null) {
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
      !pendingE2eTestPorts.has(port)
    ) {
      pendingE2eTestPorts.add(port);
      return port;
    }
  }
  throw new Error("Could not allocate a test port.");
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
    const trimmedStart = startCommand!.trim();
    const start = trimmedStart.includes("{port}")
      ? trimmedStart.replaceAll("{port}", String(port))
      : trimmedStart;
    return {
      command: `${installCommand!.trim()} && ${start}`,
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
 * A dev server that found its port taken and quietly moved to another one.
 * Vite prints this and keeps running (its default is `strictPort: false`), so
 * without matching it the readiness poll would sit on the dead original port
 * for the full two minutes and then report a timeout, when a retry on a fresh
 * port is all that was needed. Matched against the process output rather than a
 * thrown error, because nothing throws in this case.
 */
const PORT_TAKEN_OUTPUT = /port\s+\d+\s+is\s+in\s+use|address already in use/i;
/** Errors and output that mean "try another port", for the retry loop below. */
const PORT_TAKEN_MESSAGE =
  /EADDRINUSE|address already in use|port \d+ is in use/i;

async function waitForReady({
  baseUrl,
  process: child,
  signal,
  outputTail,
  spawnError,
  portHint,
}: {
  baseUrl: string;
  process: ChildProcess;
  signal?: AbortSignal;
  outputTail: () => string;
  spawnError: () => Error | undefined;
  portHint: string;
}): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Test run stopped.");
    // Precondition throughout: a server that won't start or won't answer is a
    // user/environment problem (a broken start command, a port taken, a build
    // error), not a Dyad bug, and must not be reported as a product exception.
    const startError = spawnError();
    if (startError) {
      throw new DyadError(
        `Could not start the isolated test server: ${startError.message}`,
        DyadErrorKind.Precondition,
      );
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new DyadError(
        `The isolated test server exited before becoming ready.\n${outputTail()}`,
        DyadErrorKind.Precondition,
      );
    }
    if (PORT_TAKEN_OUTPUT.test(outputTail())) {
      // Not a Precondition: the retry loop turns this into a fresh port, and
      // only a repeat failure reaches the user.
      throw new Error(
        `The isolated test server reported its port was already in use.\n${outputTail()}`,
      );
    }
    try {
      const response = await fetch(baseUrl, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status < 500) return;
    } catch {
      // The server has not bound yet.
    }
    await delay(SERVER_READY_POLL_MS, signal);
  }
  throw new DyadError(
    `The isolated test server did not become ready within 2 minutes.${portHint}\n${outputTail()}`,
    DyadErrorKind.Precondition,
  );
}

async function startE2eTestRuntimeOnce({
  workspacePath,
  installCommand,
  startCommand,
  signal,
  onOutput,
}: {
  workspacePath: string;
  installCommand?: string | null;
  startCommand?: string | null;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}): Promise<E2eTestRuntime> {
  if (signal?.aborted) throw new Error("Test run stopped.");
  const port = await allocateE2eTestPort();
  const baseUrl = `http://127.0.0.1:${port}`;
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
    hasCustomE2eStartCommand({ installCommand, startCommand }) &&
    !startCommand!.includes("{port}")
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
      if (child.exitCode !== null || child.signalCode !== null) {
        untrack();
      }
    })();
    return stopPromise;
  };
  const onAbort = () => void stop();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await waitForReady({
      baseUrl,
      process: child,
      signal,
      outputTail: () => tail,
      spawnError: () => startError,
      portHint,
    });
    // The server owns the port now, so a concurrent allocation only needs the
    // real bind check to see it is taken.
    releaseE2eTestPort(port);
    logger.info(`Isolated E2E server ready on port ${port}`);
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
    releaseE2eTestPort(port);
    await stop();
    throw error;
  }
}

export async function startE2eTestRuntime(
  options: Parameters<typeof startE2eTestRuntimeOnce>[0],
): Promise<E2eTestRuntime> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await startE2eTestRuntimeOnce(options);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!PORT_TAKEN_MESSAGE.test(message)) throw error;
      options.onOutput?.(
        "[test server] The selected port was taken; retrying with another port…\n",
      );
    }
  }
  throw lastError;
}
