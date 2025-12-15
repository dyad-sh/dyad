import fs from "node:fs/promises";
import path from "node:path";
import log from "electron-log";
import { deploySupabaseFunctions } from "./supabase_management_client";

const logger = log.scope("supabase_utils");

/**
 * Checks if a file path is a Supabase edge function
 * (i.e., inside supabase/functions/ but NOT in _shared/)
 */
export function isServerFunction(filePath: string): boolean {
  return (
    filePath.startsWith("supabase/functions/") &&
    !filePath.startsWith("supabase/functions/_shared/")
  );
}

/**
 * Checks if a file path is a shared module in supabase/functions/_shared/
 */
export function isSharedServerModule(filePath: string): boolean {
  return filePath.startsWith("supabase/functions/_shared/");
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
    // Filter out _shared and other non-function directories
    const functionDirs = entries.filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith("_"),
    );

    logger.info(
      `Found ${functionDirs.length} functions to deploy in ${functionsDir}`,
    );

    // Deploy each function
    for (const functionDir of functionDirs) {
      const functionName = functionDir.name;
      const functionPath = path.join(functionsDir, functionName);
      const indexPath = path.join(functionPath, "index.ts");

      // Check if index.ts exists
      try {
        await fs.access(indexPath);
      } catch {
        logger.warn(
          `Skipping ${functionName}: index.ts not found at ${indexPath}`,
        );
        continue;
      }

      try {
        logger.info(`Deploying function: ${functionName}`);

        await deploySupabaseFunctions({
          supabaseProjectId,
          functionName,
          appPath,
          functionPath,
        });

        logger.info(`Successfully deployed function: ${functionName}`);
      } catch (error: any) {
        const errorMessage = `Failed to deploy ${functionName}: ${error.message}`;
        logger.error(errorMessage, error);
        errors.push(errorMessage);
      }
    }
  } catch (error: any) {
    const errorMessage = `Error reading functions directory: ${error.message}`;
    logger.error(errorMessage, error);
    errors.push(errorMessage);
  }

  return errors;
}
