import * as path from "node:path";
import { utilityProcess } from "electron";
import type {
  SupabaseDependencyAnalysisInput,
  SupabaseDependencyAnalysisOutput,
  SupabaseFunctionImpact,
} from "../../../shared/supabase_dependency_analysis_types";
import { typescriptUtilityProcessScheduler } from "./typescript_utility_process_scheduler";

const TIMEOUT_MS = 60_000;
const SHUTDOWN_GRACE_MS = 5_000;

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
    let settled = false;
    let shutdownTimeout: NodeJS.Timeout | undefined;
    let resolveExit!: () => void;
    const exitPromise = new Promise<void>((exitResolve) => {
      resolveExit = exitResolve;
    });

    const requestStop = () => {
      if (!killRequested) {
        killRequested = true;
        child.kill();
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(analysisTimeout);
      if (shutdownTimeout) clearTimeout(shutdownTimeout);
      if (failure) return reject(failure);
      if (!response) {
        return reject(
          new Error("Supabase dependency analysis worker did not reply"),
        );
      }
      if (!response.success) return reject(new Error(response.error));
      resolve(response.data);
    };

    const finishAfterShutdownGrace = () => {
      requestStop();
      shutdownTimeout ??= setTimeout(finish, SHUTDOWN_GRACE_MS);
    };

    let registration: ReturnType<
      typeof typescriptUtilityProcessScheduler.registerResidentProcess
    >;
    try {
      registration = typescriptUtilityProcessScheduler.registerResidentProcess({
        kind: "supabase-dependency-analysis",
        reusable: false,
        token: child,
        stop: async () => {
          requestStop();
          await exitPromise;
        },
      });
    } catch (error) {
      child.kill();
      throw error;
    }

    const analysisTimeout = setTimeout(() => {
      failure ??= new Error(
        `Supabase dependency analysis timed out after ${TIMEOUT_MS / 1000}s`,
      );
      finishAfterShutdownGrace();
    }, TIMEOUT_MS);

    child.on("spawn", () => {
      if (!response && !failure) child.postMessage(input);
    });
    child.on("message", (message: SupabaseDependencyAnalysisOutput) => {
      if (response || failure) return;
      response = message;
      clearTimeout(analysisTimeout);
      finishAfterShutdownGrace();
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
      clearTimeout(analysisTimeout);
      finishAfterShutdownGrace();
    });
    child.on("exit", (code) => {
      registration.clear();
      resolveExit();
      if (!response && !failure) {
        failure = new Error(
          `Supabase dependency analysis worker exited with code ${code} before replying`,
        );
      }
      finish();
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
