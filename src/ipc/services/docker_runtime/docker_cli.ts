import {
  runBufferedProcess,
  type BufferedProcessResult,
} from "@/ipc/utils/buffered_process";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export const DOCKER_UNAVAILABLE_MESSAGE =
  "Docker is required but not available. Please install Docker Desktop and ensure it's running.";

const DOCKER_COMMAND_TIMEOUT_MS = 60_000;

/**
 * Runs a short Docker CLI management command (inspect, rm, volume, build).
 * Never used for app code: guest commands go through `guest_command.ts`.
 */
export async function runDockerCli(
  args: string[],
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onOutput?: (chunk: string) => void;
    maxOutputBytes?: number;
  } = {},
): Promise<BufferedProcessResult> {
  return runBufferedProcess({
    command: "docker",
    args,
    cwd: process.cwd(),
    shell: false,
    timeoutMs: options.timeoutMs ?? DOCKER_COMMAND_TIMEOUT_MS,
    signal: options.signal,
    maxOutputBytes: options.maxOutputBytes,
    onStdout: options.onOutput
      ? (chunk) => options.onOutput!(chunk)
      : undefined,
    onStderr: options.onOutput
      ? (chunk) => options.onOutput!(chunk)
      : undefined,
  });
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    const result = await runDockerCli(
      ["version", "--format", "{{.Server.Version}}"],
      {
        timeoutMs: 15_000,
      },
    );
    return result.code === 0;
  } catch {
    return false;
  }
}

export async function assertDockerAvailable(): Promise<void> {
  if (!(await isDockerAvailable())) {
    throw new DyadError(DOCKER_UNAVAILABLE_MESSAGE, DyadErrorKind.Precondition);
  }
}

/** Best-effort forced removal; resolves even when the container is gone. */
export async function forceRemoveContainer(name: string): Promise<void> {
  try {
    await runDockerCli(["rm", "-f", name], { timeoutMs: 30_000 });
  } catch {
    // Already gone, or Docker stopped; nothing left to clean up.
  }
}
