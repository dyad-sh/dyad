import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  CodeExplorerResult,
  CodeExplorerWorkerInput,
  CodeExplorerWorkerOutput,
} from "../../../shared/code_explorer_types";
import log from "electron-log";

const logger = log.scope("code-explorer");
const DEFAULT_CONFIGS = ["tsconfig.app.json", "tsconfig.json"];

export function isCodeExplorerReady(appPath: string): boolean {
  try {
    require.resolve("typescript", { paths: [appPath] });
    return DEFAULT_CONFIGS.some((config) =>
      fs.existsSync(path.join(appPath, config)),
    );
  } catch {
    return false;
  }
}

export function toCodeExplorerError(error: unknown): Error {
  if (error instanceof DyadError) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  if (
    message.startsWith("Failed to load TypeScript from") ||
    message.includes("Cannot find module 'typescript'") ||
    message.startsWith("No TypeScript configuration file found") ||
    message.startsWith("No TypeScript source files found") ||
    message.startsWith("TypeScript config error")
  ) {
    return new DyadError(message, DyadErrorKind.Precondition);
  }

  if (
    message.startsWith("Invalid tsconfig_path") ||
    message.includes("escapes app")
  ) {
    return new DyadError(message, DyadErrorKind.Validation);
  }

  return error instanceof Error ? error : new Error(message);
}

export async function runCodeExplorer(
  input: CodeExplorerWorkerInput,
): Promise<CodeExplorerResult> {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "code_explorer_worker.js");
    const worker = new Worker(workerPath);
    let settled = false;

    const finish = () => {
      settled = true;
      void worker.terminate();
    };

    worker.on("message", (output: CodeExplorerWorkerOutput) => {
      finish();
      if (output.success) {
        resolve(output.data);
      } else {
        logger.error(
          `Code explorer worker failed for app ${input.appPath}: ${output.error}`,
        );
        reject(toCodeExplorerError(new Error(output.error)));
      }
    });

    worker.on("error", (error) => {
      finish();
      reject(toCodeExplorerError(error));
    });

    worker.on("exit", (code) => {
      if (!settled && code !== 0) {
        reject(
          toCodeExplorerError(new Error(`Worker exited with code ${code}`)),
        );
      }
    });

    worker.postMessage(input);
  });
}
