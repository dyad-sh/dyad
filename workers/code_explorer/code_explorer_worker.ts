import { parentPort } from "node:worker_threads";

import type {
  CodeExplorerWorkerInput,
  CodeExplorerWorkerOutput,
} from "../../shared/code_explorer_types";
import { exploreCode } from "./core";

function loadLocalTypeScript(appPath: string): typeof import("typescript") {
  try {
    const requirePath = require.resolve("typescript", { paths: [appPath] });
    return require(requirePath);
  } catch (error) {
    throw new Error(
      `Failed to load TypeScript from ${appPath} because of ${error}`,
    );
  }
}

async function processCodeExplorer(
  input: CodeExplorerWorkerInput,
): Promise<CodeExplorerWorkerOutput> {
  try {
    const ts = loadLocalTypeScript(input.appPath);
    const result = exploreCode(ts, input);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

parentPort?.on("message", async (input: CodeExplorerWorkerInput) => {
  const output = await processCodeExplorer(input);
  parentPort?.postMessage(output);
});
