import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { safeJoin } from "./path_utils";
import { gitAdd } from "./git_utils";
import { isWithinDyadMediaDir } from "./media_path_utils";
import { deploySupabaseFunction } from "../../supabase_admin/supabase_management_client";
import {
  isServerFunction,
  isSharedServerModule,
  extractFunctionNameFromPath,
} from "../../supabase_admin/supabase_utils";

const logger = log.scope("copy_file_utils");

export interface CopyFileResult {
  /** Whether the destination is a shared server module */
  sharedModuleChanged: boolean;
  /** Error from Supabase function deployment, if any */
  deployError?: unknown;
}

/**
 * Copy a file within a Dyad app, with security validation, git staging,
 * and optional Supabase function deployment.
 *
 * @throws Error if the source path is outside the allowed dyad-media directory
 * @throws Error if the source file does not exist
 */
export async function executeCopyFile({
  from,
  to,
  appPath,
  supabaseProjectId,
  supabaseOrganizationSlug,
  isSharedModulesChanged,
}: {
  from: string;
  to: string;
  appPath: string;
  supabaseProjectId?: string | null;
  supabaseOrganizationSlug?: string | null;
  isSharedModulesChanged?: boolean;
}): Promise<CopyFileResult> {
  // Resolve the source path: allow both dyad-media paths and app-relative paths
  let fromFullPath: string;
  if (path.isAbsolute(from)) {
    // Security: only allow absolute paths within the app's dyad-media directory
    if (!isWithinDyadMediaDir(from, appPath)) {
      throw new Error(
        `Absolute source paths are only allowed within the dyad-media directory`,
      );
    }
    fromFullPath = path.resolve(from);
  } else {
    fromFullPath = safeJoin(appPath, from);
  }

  const toFullPath = safeJoin(appPath, to);

  if (!fs.existsSync(fromFullPath)) {
    throw new Error(`Source file does not exist: ${from}`);
  }

  // Track if this involves shared modules
  const sharedModuleChanged = isSharedServerModule(to);

  // Ensure destination directory exists
  const dirPath = path.dirname(toFullPath);
  fs.mkdirSync(dirPath, { recursive: true });

  // Copy the file
  fs.copyFileSync(fromFullPath, toFullPath);
  logger.log(`Successfully copied file: ${fromFullPath} -> ${toFullPath}`);

  // Add to git
  await gitAdd({ path: appPath, filepath: to });

  // Deploy Supabase function if applicable
  const effectiveSharedModulesChanged =
    isSharedModulesChanged || sharedModuleChanged;
  let deployError: unknown;
  if (
    supabaseProjectId &&
    isServerFunction(to) &&
    !effectiveSharedModulesChanged
  ) {
    try {
      await deploySupabaseFunction({
        supabaseProjectId,
        functionName: extractFunctionNameFromPath(to),
        appPath,
        organizationSlug: supabaseOrganizationSlug ?? null,
      });
    } catch (error) {
      logger.error("Failed to deploy Supabase function after copy:", error);
      deployError = error;
    }
  }

  return {
    sharedModuleChanged,
    deployError,
  };
}
