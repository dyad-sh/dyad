import fs from "node:fs/promises";
import path from "node:path";
import log from "electron-log";
import {
  bulkUpdateFunctions,
  deploySupabaseFunction,
  type DeployedFunctionResponse,
} from "./supabase_management_client";

const logger = log.scope("supabase_utils");

/**
 * Extracts function name from Supabase edge function log event_message
 * Example: "[todo-activity] fetched 0 recent todos\n" -> "todo-activity"
 * @param eventMessage - The event_message string from the log
 * @returns The function name or undefined if not found
 */
export function extractFunctionName(eventMessage: string): string | undefined {
  const match = eventMessage.match(/^\[([^\]]+)\]/);
  return match ? match[1] : undefined;
}

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
 * Extracts the function name from a Supabase function file path.
 * Handles nested paths like "supabase/functions/hello/lib/utils.ts" → "hello"
 *
 * @param filePath - A path like "supabase/functions/{functionName}/..."
 * @returns The function name
 * @throws Error if the path is not a valid function path
 */
export function extractFunctionNameFromPath(filePath: string): string {
  // Normalize path separators to forward slashes
  const normalized = filePath.replace(/\\/g, "/");

  // Match the pattern: supabase/functions/{functionName}/...
  // The function name is the segment immediately after "supabase/functions/"
  const match = normalized.match(/^supabase\/functions\/([^/]+)/);

  if (!match) {
    throw new Error(
      `Invalid Supabase function path: ${filePath}. Expected format: supabase/functions/{functionName}/...`,
    );
  }

  const functionName = match[1];

  // Exclude _shared and other special directories
  if (functionName.startsWith("_")) {
    throw new Error(
      `Invalid Supabase function path: ${filePath}. Function names starting with "_" are reserved for special directories.`,
    );
  }

  return functionName;
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
  supabaseOrganizationSlug,
}: {
  appPath: string;
  supabaseProjectId: string;
  supabaseOrganizationSlug: string | null;
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

    // Filter to only functions with index.ts
    const validFunctions: string[] = [];
    for (const functionDir of functionDirs) {
      const functionName = functionDir.name;
      const functionPath = path.join(functionsDir, functionName);
      const indexPath = path.join(functionPath, "index.ts");

      try {
        await fs.access(indexPath);
        validFunctions.push(functionName);
      } catch {
        logger.warn(
          `Skipping ${functionName}: index.ts not found at ${indexPath}`,
        );
      }
    }

    if (validFunctions.length === 0) {
      logger.info("No valid functions to deploy");
      return [];
    }

    // Deploy all functions in parallel with bundleOnly=true
    logger.info(`Bundling ${validFunctions.length} functions in parallel...`);

    const deployResults = await Promise.allSettled(
      validFunctions.map(async (functionName) => {
        logger.info(`Bundling function: ${functionName}`);
        const result = await deploySupabaseFunction({
          supabaseProjectId,
          organizationSlug: supabaseOrganizationSlug,
          functionName,
          appPath,
          bundleOnly: true,
        });
        logger.info(`Successfully bundled function: ${functionName}`);
        return result;
      }),
    );

    // Collect successful results and errors
    const successfulDeploys: DeployedFunctionResponse[] = [];
    for (let i = 0; i < deployResults.length; i++) {
      const result = deployResults[i];
      const functionName = validFunctions[i];

      if (result.status === "fulfilled") {
        successfulDeploys.push(result.value);
      } else {
        const errorMessage = `Failed to bundle ${functionName}: ${result.reason?.message || result.reason}`;
        logger.error(errorMessage, result.reason);
        errors.push(errorMessage);
      }
    }

    // Bulk update all successfully bundled functions to activate them
    if (successfulDeploys.length > 0) {
      logger.info(
        `Activating ${successfulDeploys.length} functions via bulk update...`,
      );
      try {
        await bulkUpdateFunctions({
          supabaseProjectId,
          functions: successfulDeploys,
          organizationSlug: supabaseOrganizationSlug,
        });
        logger.info(
          `Successfully activated ${successfulDeploys.length} functions`,
        );
      } catch (error: any) {
        const errorMessage = `Failed to bulk update functions: ${error.message}`;
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
