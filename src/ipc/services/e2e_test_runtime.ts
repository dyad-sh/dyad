import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import log from "electron-log";

import { killProcess } from "@/ipc/utils/process_manager";
import {
  getPackageManagerCommandEnv,
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

export function buildE2eTestStartCommand({
  workspacePath,
  port,
  startCommand,
}: {
  workspacePath: string;
  port: number;
  startCommand?: string | null;
}): { command: string; env: NodeJS.ProcessEnv } {
  if (startCommand?.trim()) {
    const command = startCommand.includes("{port}")
      ? startCommand.replaceAll("{port}", String(port))
      : `${startCommand.trim()} -- --port ${port}`;
    return { command, env: { ...process.env, PORT: String(port) } };
  }

  if (fs.existsSync(path.join(workspacePath, "pnpm-lock.yaml"))) {
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
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Test run stopped."));
      },
      { once: true },
    );
  });
}

async function waitForReady({
  baseUrl,
  process: child,
  signal,
  outputTail,
  spawnError,
}: {
  baseUrl: string;
  process: ChildProcess;
  signal?: AbortSignal;
  outputTail: () => string;
  spawnError: () => Error | undefined;
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
    `The isolated test server did not become ready within 2 minutes.\n${outputTail()}`,
  );
}

async function startE2eTestRuntimeOnce({
  workspacePath,
  startCommand,
  signal,
  onOutput,
}: {
  workspacePath: string;
  startCommand?: string | null;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}): Promise<E2eTestRuntime> {
  if (signal?.aborted) throw new Error("Test run stopped.");
  const port = await allocateE2eTestPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const { command, env } = buildE2eTestStartCommand({
    workspacePath,
    port,
    startCommand,
  });
  const child = spawn(command, [], {
    cwd: workspacePath,
    env,
    shell: true,
    stdio: "pipe",
    detached: false,
  });

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
