import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  BufferedProcessSpawnError,
  DEFAULT_BUFFERED_PROCESS_TIMEOUT_MS,
  runBufferedProcess,
} from "./buffered_process";
import { getPackageManagerCommandEnv } from "./socket_firewall";

const logger = log.scope("portal_migration");
const MIGRATION_CREATED_MESSAGE = "Migration created at";
const MIGRATION_RENAME_PROMPT = "created or renamed from another";
const MIGRATION_SEARCH_TAIL_LENGTH =
  Math.max(MIGRATION_CREATED_MESSAGE.length, MIGRATION_RENAME_PROMPT.length) -
  1;

export async function runPortalMigrationCommand({
  appId,
  appPath,
  timeoutMs = DEFAULT_BUFFERED_PROCESS_TIMEOUT_MS,
}: {
  appId: number;
  appPath: string;
  timeoutMs?: number;
}): Promise<string> {
  logger.info(`Running migrate:create for app ${appId} at ${appPath}`);

  let createdMigration = false;
  let stdoutSearchTail = "";

  let result;
  try {
    result = await runBufferedProcess({
      command: "npm run migrate:create -- --skip-empty",
      cwd: appPath,
      env: getPackageManagerCommandEnv(),
      timeoutMs,
      onStdout: (output, child) => {
        logger.info(`migrate:create stdout: ${output}`);
        const searchableOutput = stdoutSearchTail + output;
        createdMigration ||= searchableOutput.includes(
          MIGRATION_CREATED_MESSAGE,
        );

        // Drizzle prompts once per ambiguous rename, so answer every
        // occurrence. Skip matches that end inside the carried-over tail:
        // those were already answered when they first streamed in.
        let promptIndex = searchableOutput.indexOf(MIGRATION_RENAME_PROMPT);
        while (promptIndex !== -1) {
          const promptEnd = promptIndex + MIGRATION_RENAME_PROMPT.length;
          if (promptEnd > stdoutSearchTail.length) {
            child.stdin?.write("\r\n");
            logger.info(
              `App ${appId} (PID: ${child.pid}) wrote enter to stdin to automatically respond to drizzle migrate input`,
            );
          }
          promptIndex = searchableOutput.indexOf(
            MIGRATION_RENAME_PROMPT,
            promptEnd,
          );
        }

        stdoutSearchTail = searchableOutput.slice(
          -MIGRATION_SEARCH_TAIL_LENGTH,
        );
      },
      onStderr: (output) => {
        logger.warn(`migrate:create stderr: ${output}`);
      },
    });
  } catch (error) {
    if (error instanceof BufferedProcessSpawnError) {
      logger.error(`Failed to spawn migrate:create for app ${appId}:`, error);
      throw new DyadError(
        `Failed to run migration command: ${error.message}\n\nOutput:\n${error.stdout}\n\nErrors:\n${error.stderr}`,
        DyadErrorKind.External,
        { cause: error },
      );
    }
    throw error;
  }

  const combinedOutput =
    result.stdout +
    (result.stderr ? `\n\nErrors/Warnings:\n${result.stderr}` : "");

  if (result.timedOut) {
    logger.error(`migrate:create timed out for app ${appId}`);
    throw new DyadError(
      `Migration creation timed out after ${timeoutMs} ms\n\n${combinedOutput}`,
      DyadErrorKind.External,
    );
  }

  if (result.code === 0) {
    if (createdMigration) {
      logger.info(`migrate:create completed successfully for app ${appId}`);
      return combinedOutput;
    }

    logger.error(
      `migrate:create completed successfully for app ${appId} but no migration was created`,
    );
    throw new DyadError(
      "No migration was created because no changes were found.",
      DyadErrorKind.Precondition,
    );
  }

  const failureReason = result.signal
    ? `signal ${result.signal}`
    : `exit code ${result.code}`;
  logger.error(`migrate:create failed for app ${appId} with ${failureReason}`);
  throw new DyadError(
    `Migration creation failed (${failureReason})\n\n${combinedOutput}`,
    DyadErrorKind.External,
  );
}
