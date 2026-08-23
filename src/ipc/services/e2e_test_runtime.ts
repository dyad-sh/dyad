import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import log from "electron-log";

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

export async function allocateE2eTestPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Could not allocate a test port.")),
        );
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
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
    // Run the user's command verbatim, exactly as the normal preview does.
    // Appending `-- --port` would break every custom server that doesn't accept
    // that flag (a Python server, a shell script, a CLI that spells it
    // differently) under test only. `{port}` is the explicit opt-in for
    // pointing a custom server at the run-scoped port; otherwise PORT is the
    // only hint we can safely supply.
    const trimmed = startCommand!.trim();
    const command = trimmed.includes("{port}")
      ? trimmed.replaceAll("{port}", String(port))
      : trimmed;
    return { command, env: { ...process.env, PORT: String(port) } };
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
    const startError = spawnError();
    if (startError) {
      throw new Error(
        `Could not start the isolated test server: ${startError.message}`,
      );
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `The isolated test server exited before becoming ready.\n${outputTail()}`,
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
  throw new Error(
    `The isolated test server did not become ready within 2 minutes.${portHint}\n${outputTail()}`,
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
      untrack();
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
      if (!/EADDRINUSE|address already in use/i.test(message)) throw error;
      options.onOutput?.(
        "[test server] The selected port was taken; retrying with another port…\n",
      );
    }
  }
  throw lastError;
}
