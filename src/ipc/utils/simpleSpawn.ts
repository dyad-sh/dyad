import log from "electron-log/main";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  BufferedProcessSpawnError,
  DEFAULT_BUFFERED_PROCESS_TIMEOUT_MS,
  runBufferedProcess,
} from "./buffered_process";
import { getPackageManagerCommandEnv } from "./socket_firewall";

const logger = log.scope("simpleSpawn");

export async function simpleSpawn({
  command,
  cwd,
  successMessage,
  errorPrefix,
  env,
  signal,
  timeoutMs = DEFAULT_BUFFERED_PROCESS_TIMEOUT_MS,
}: {
  command: string;
  cwd: string;
  successMessage: string;
  errorPrefix: string;
  // Defaults to getPackageManagerCommandEnv() so Dyad-managed commands see
  // the managed pnpm and the Corepack project-spec disable without every
  // call site having to remember to pass it.
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<void> {
  const spawnEnv = env ?? getPackageManagerCommandEnv();
  logger.info(`Running: ${command}`);

  let result;
  try {
    result = await runBufferedProcess({
      command,
      cwd,
      env: spawnEnv,
      signal,
      timeoutMs,
      // The output is only needed for failures. On success, release the
      // bounded byte buffers without decoding them into additional strings.
      captureOutputOnSuccess: false,
      onStdout: (output) => logger.info(output),
      onStderr: (output) => logger.error(output),
    });
  } catch (error) {
    if (error instanceof BufferedProcessSpawnError) {
      logger.error(`Failed to spawn command: ${command}`, error);
      throw new DyadError(
        `Failed to spawn command: ${error.message}\n\nSTDOUT:\n${error.stdout}\n\nSTDERR:\n${error.stderr}`,
        DyadErrorKind.External,
        { cause: error },
      );
    }
    throw error;
  }

  if (result.code === 0 && !result.aborted && !result.timedOut) {
    logger.info(successMessage);
    return;
  }

  let failureReason: string;
  if (result.timedOut) {
    failureReason = `timed out after ${timeoutMs} ms`;
  } else if (result.aborted) {
    failureReason = "was cancelled";
  } else if (result.signal) {
    failureReason = `terminated by signal ${result.signal}`;
  } else {
    failureReason = `exit code ${result.code}`;
  }

  logger.error(`${errorPrefix}, ${failureReason}`);
  throw new DyadError(
    `${errorPrefix} (${failureReason})\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`,
    // An abort comes from the caller's AbortSignal, so it is not an upstream
    // failure worth reporting to telemetry.
    result.aborted ? DyadErrorKind.UserCancelled : DyadErrorKind.External,
  );
}
