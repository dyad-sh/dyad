import * as path from "node:path";
import { utilityProcess } from "electron";
import type {
  SupabaseDependencyAnalysisInput,
  SupabaseDependencyAnalysisOutput,
  SupabaseFunctionImpact,
} from "../../../shared/supabase_dependency_analysis_types";
import { typescriptUtilityProcessScheduler } from "./typescript_utility_process_scheduler";

const TIMEOUT_MS = 60_000;

function runWorker(
  input: SupabaseDependencyAnalysisInput,
): Promise<SupabaseFunctionImpact> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(
      path.join(__dirname, "supabase_dependency_analysis_worker.js"),
      [],
      { serviceName: "dyad-supabase-dependency-analysis" },
    );
    let response: SupabaseDependencyAnalysisOutput | undefined;
    let failure: Error | undefined;
    let killRequested = false;
    const requestStop = () => {
      if (!killRequested) {
        killRequested = true;
        if (!child.kill())
          failure ??= new Error(
            "Failed to stop Supabase dependency analysis worker",
          );
      }
    };
    const timeout = setTimeout(() => {
      failure ??= new Error(
        `Supabase dependency analysis timed out after ${TIMEOUT_MS / 1000}s`,
      );
      requestStop();
    }, TIMEOUT_MS);

    child.on("spawn", () => {
      if (!response && !failure) child.postMessage(input);
    });
    child.on("message", (message: SupabaseDependencyAnalysisOutput) => {
      if (response || failure) return;
      response = message;
      requestStop();
    });
    child.on("error", (type, location) => {
      if (response || failure) return;
      failure =
        type === "FatalError"
          ? new Error(
              "Supabase dependency analysis ran out of memory. This can happen with very large apps.",
            )
          : new Error(
              `Supabase dependency analysis worker failed: ${type} at ${location}`,
            );
      requestStop();
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (failure) return reject(failure);
      if (!response) {
        return reject(
          new Error(
            `Supabase dependency analysis worker exited with code ${code} before replying`,
          ),
        );
      }
      if (!response.success) return reject(new Error(response.error));
      resolve(response.data);
    });
  });
}

export function runSupabaseDependencyAnalysis(
  input: SupabaseDependencyAnalysisInput,
): Promise<SupabaseFunctionImpact> {
  return typescriptUtilityProcessScheduler.runExclusive(
    "supabase-dependency-analysis",
    () => runWorker(input),
  );
}
