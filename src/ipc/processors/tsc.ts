import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Worker } from "node:worker_threads";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { ProblemReport } from "@/ipc/types";
import log from "electron-log";
import {
  TscWorkerErrorKind,
  WorkerInput,
  WorkerOutput,
} from "../../../shared/tsc_types";

import {
  getDyadDeleteTags,
  getDyadRenameTags,
  getDyadWriteTags,
} from "../utils/dyad_tag_parser";
import { getTypeScriptCachePath } from "@/paths/paths";

const logger = log.scope("tsc");

export class TypeCheckPreconditionError extends DyadError {
  readonly typeCheckKind: TscWorkerErrorKind;

  constructor(
    typeCheckKind: TscWorkerErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, DyadErrorKind.Precondition, options);
    this.name = "TypeCheckPreconditionError";
    this.typeCheckKind = typeCheckKind;
  }
}

function getStringMatchedTypeCheckPreconditionKind(
  message: string,
): TscWorkerErrorKind | undefined {
  if (
    message.startsWith("Failed to load TypeScript from") ||
    message.includes("Cannot find module 'typescript'")
  ) {
    return "typescript-not-found";
  }

  if (message.startsWith("No TypeScript configuration file found")) {
    return "tsconfig-not-found";
  }

  return undefined;
}

export function getTypeCheckPreconditionKind(
  error: unknown,
): TscWorkerErrorKind | undefined {
  if (error instanceof TypeCheckPreconditionError) {
    return error.typeCheckKind;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  return getStringMatchedTypeCheckPreconditionKind(message);
}

async function packageJsonDeclaresTypeScript(
  appPath: string,
): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(appPath, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };

    return (
      parsed.dependencies?.typescript !== undefined ||
      parsed.devDependencies?.typescript !== undefined
    );
  } catch {
    return false;
  }
}

export async function getTypeCheckPreconditionGuidance({
  kind,
  appPath,
  includeAgentInstructions,
  canInstallDependencies = true,
}: {
  kind: TscWorkerErrorKind;
  appPath: string;
  includeAgentInstructions?: boolean;
  canInstallDependencies?: boolean;
}): Promise<string> {
  if (kind === "tsconfig-not-found") {
    return "Type checking could not run: TypeScript is installed but no tsconfig was found (expected `tsconfig.app.json` or `tsconfig.json`). You can create a suitable tsconfig for this project and retry.";
  }

  const declaresTypeScript = await packageJsonDeclaresTypeScript(appPath);

  if (declaresTypeScript) {
    if (!includeAgentInstructions) {
      return "Type checking could not run: TypeScript is listed in package.json but is not installed (node_modules is missing or incomplete). Install dependencies, then retry.";
    }

    return canInstallDependencies
      ? 'Type checking could not run: TypeScript is listed in package.json but is not installed (node_modules is missing or incomplete). Call the `add_dependency` tool with `{ "packages": ["typescript"] }` to install dependencies, then retry `run_type_checks`.'
      : "Type checking could not run: TypeScript is listed in package.json but is not installed (node_modules is missing or incomplete). This turn cannot install dependencies because state-changing tools are unavailable. Tell the user to switch to Agent mode or install dependencies manually, then retry `run_type_checks`.";
  }

  return includeAgentInstructions
    ? 'Type checking is unavailable: this project does not use TypeScript (no `typescript` entry in package.json). Do not call `run_type_checks` again in this conversation. Verify your changes by reading the files instead. At the end of your reply, recommend that the user add TypeScript to the project so you can automatically catch and fix type errors, and include `<dyad-command type="add-typescript"></dyad-command>` so they can accept with one click.'
    : "Type checking is unavailable: this project does not use TypeScript (no `typescript` entry in package.json). Add TypeScript to enable automatic type checking.";
}

/**
 * Map expected type-check setup failures to DyadError so they are not sent to
 * PostHog as `$exception` events (missing deps, no tsconfig, etc.).
 */
export function toProblemReportError(
  error: unknown,
  errorKind?: TscWorkerErrorKind,
): Error {
  if (error instanceof DyadError) {
    // Already classified; keep the original kind rather than re-wrapping.
    return error;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const typeCheckKind =
    errorKind ?? getStringMatchedTypeCheckPreconditionKind(message);

  if (typeCheckKind) {
    return new TypeCheckPreconditionError(typeCheckKind, message, {
      cause: error,
    });
  }

  return error instanceof Error ? error : new Error(message);
}

export async function generateProblemReport({
  fullResponse,
  appPath,
}: {
  fullResponse: string;
  appPath: string;
}): Promise<ProblemReport> {
  return new Promise((resolve, reject) => {
    // Determine the worker script path
    const workerPath = path.join(__dirname, "tsc_worker.js");

    logger.info(`Starting TSC worker for app ${appPath}`);

    // Create the worker
    const worker = new Worker(workerPath);

    // Handle worker messages
    worker.on("message", (output: WorkerOutput) => {
      worker.terminate();

      if (output.success && output.data) {
        logger.info(`TSC worker completed successfully for app ${appPath}`);
        resolve(output.data);
      } else {
        logger.error(`TSC worker failed for app ${appPath}: ${output.error}`);
        reject(
          toProblemReportError(
            new Error(output.error || "Unknown worker error"),
            output.errorKind,
          ),
        );
      }
    });

    // Handle worker errors
    worker.on("error", (error) => {
      logger.error(`TSC worker error for app ${appPath}:`, error);
      worker.terminate();
      reject(toProblemReportError(error));
    });

    // Handle worker exit
    worker.on("exit", (code) => {
      if (code !== 0) {
        logger.error(`TSC worker exited with code ${code} for app ${appPath}`);
        reject(
          toProblemReportError(new Error(`Worker exited with code ${code}`)),
        );
      }
    });

    const writeTags = getDyadWriteTags(fullResponse);
    const renameTags = getDyadRenameTags(fullResponse);
    const deletePaths = getDyadDeleteTags(fullResponse);
    const virtualChanges = {
      deletePaths,
      renameTags,
      writeTags,
    };

    // Send input to worker
    const input: WorkerInput = {
      virtualChanges,
      appPath,
      tsBuildInfoCacheDir: getTypeScriptCachePath(),
    };

    logger.info(`Sending input to TSC worker for app ${appPath}`);

    worker.postMessage(input);
  });
}
