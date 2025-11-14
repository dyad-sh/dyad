import fs from "node:fs/promises";
import path from "node:path";
import log from "electron-log";
import { deploySupabaseFunctions } from "./supabase_management_client";

const logger = log.scope("supabase_utils");

export function isServerFunction(filePath: string) {
  return filePath.startsWith("supabase/functions/");
}

/**
 * Deploys all Supabase edge functions found in the app's supabase/functions directory
 * @param appPath - The absolute path to the app directory
 * @param supabaseProjectId - The Supabase project ID
 * @returns An array of error messages for functions that failed to deploy (empty if all succeeded)
 */
export async function deployAllSupabaseFunctions({
  appPath,
  supabaseProjectId,
}: {
  appPath: string;
  supabaseProjectId: string;
}): Promise<string[]> {
  const functionsDir = path.join(appPath, "supabase", "functions");

  // Check if supabase/functions directory exists
  try {
    await fs.access(functionsDir);
  } catch {
    logger.info(`No supabase/functions directory found at ${functionsDir}`);
    return [];
  }

  const errors: string[] = [];

  try {
    // Read all directories in supabase/functions
    const entries = await fs.readdir(functionsDir, { withFileTypes: true });
    const functionDirs = entries.filter((entry) => entry.isDirectory());

    logger.info(
      `Found ${functionDirs.length} functions to deploy in ${functionsDir}`,
    );

    // Deploy functions in batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < functionDirs.length; i += BATCH_SIZE) {
      const batch = functionDirs.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(functionDirs.length / BATCH_SIZE);

      logger.info(
        `Deploying batch ${batchNumber}/${totalBatches} (${batch.length} functions)`,
      );

      // Deploy all functions in this batch in parallel
      const deploymentPromises = batch.map(async (functionDir) => {
        const functionName = functionDir.name;
        const indexPath = path.join(functionsDir, functionName, "index.ts");

        // Check if index.ts exists
        try {
          await fs.access(indexPath);
        } catch {
          logger.warn(
            `Skipping ${functionName}: index.ts not found at ${indexPath}`,
          );
          return { functionName, skipped: true };
        }

        try {
          const content = await fs.readFile(indexPath, "utf-8");
          logger.info(`Deploying function: ${functionName}`);

          await deploySupabaseFunctions({
            supabaseProjectId,
            functionName,
            content,
          });

          logger.info(`Successfully deployed function: ${functionName}`);
          return { functionName, success: true };
        } catch (error: any) {
          const errorMessage = `Failed to deploy ${functionName}: ${error.message}`;
          logger.error(errorMessage, error);
          return { functionName, error: errorMessage };
        }
      });

      // Wait for all deployments in this batch to complete
      const results = await Promise.allSettled(deploymentPromises);

      // Collect errors from this batch
      for (const result of results) {
        if (result.status === "fulfilled" && result.value.error) {
          errors.push(result.value.error);
        } else if (result.status === "rejected") {
          const errorMessage = `Unexpected error deploying function: ${result.reason}`;
          logger.error(errorMessage);
          errors.push(errorMessage);
        }
      }

      logger.info(`Completed batch ${batchNumber}/${totalBatches}`);
    }
  } catch (error: any) {
    const errorMessage = `Error reading functions directory: ${error.message}`;
    logger.error(errorMessage, error);
    errors.push(errorMessage);
  }

  return errors;
}
