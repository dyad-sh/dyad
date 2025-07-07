import * as path from "node:path";
import { Worker } from "node:worker_threads";

import { ProblemReport } from "../ipc_types";
import log from "electron-log";
import { WorkerInput, WorkerOutput } from "../../../shared/tsc_types";

import {
  getDyadDeleteTags,
  getDyadRenameTags,
  getDyadWriteTags,
} from "../utils/dyad_tag_parser";
import { getTypeScriptCachePath } from "@/paths/paths";

const logger = log.scope("tsc");

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
        reject(new Error(output.error || "Unknown worker error"));
      }
    });

    // Handle worker errors
    worker.on("error", (error) => {
      logger.error(`TSC worker error for app ${appPath}:`, error);
      worker.terminate();
      reject(error);
    });

    // Handle worker exit
    worker.on("exit", (code) => {
      if (code !== 0) {
        logger.error(`TSC worker exited with code ${code} for app ${appPath}`);
        reject(new Error(`Worker exited with code ${code}`));
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
