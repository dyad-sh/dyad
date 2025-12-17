/**
 * Shared file operations for both XML-based (Build mode) and Tool-based (Local Agent) processing
 */

import fs from "node:fs";
import path from "node:path";
import { db } from "../../db";
import { messages } from "../../db/schema";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { safeJoin } from "../utils/path_utils";
import {
  gitCommit,
  gitAdd,
  gitRemove,
  gitAddAll,
  getGitUncommittedFiles,
} from "../utils/git_utils";
import {
  deploySupabaseFunction,
  deleteSupabaseFunction,
  executeSupabaseSql,
} from "../../supabase_admin/supabase_management_client";
import {
  isServerFunction,
  isSharedServerModule,
  deployAllSupabaseFunctions,
} from "../../supabase_admin/supabase_utils";
import { executeAddDependency } from "./executeAddDependency";
import { applySearchReplace } from "../../pro/main/ipc/processors/search_replace_processor";
import { writeMigrationFile } from "../utils/file_utils";
import { readSettings } from "../../main/settings";
import { getSupabaseContext } from "../../supabase_admin/supabase_context";
import { extractCodebase } from "../../utils/codebase";

const readFile = fs.promises.readFile;
const logger = log.scope("file_operations");

export interface FileOperationContext {
  appPath: string;
  supabaseProjectId?: string | null;
}

export interface FileOperationResult {
  success: boolean;
  error?: string;
  warning?: string;
}

// Track shared module changes across operations
let sharedModulesChanged = false;

export function resetSharedModulesFlag() {
  sharedModulesChanged = false;
}

export function getSharedModulesChanged() {
  return sharedModulesChanged;
}

function getFunctionNameFromPath(input: string): string {
  return path.basename(path.extname(input) ? path.dirname(input) : input);
}

/**
 * Write a file to the codebase
 */
export async function executeWriteFile(
  ctx: FileOperationContext,
  filePath: string,
  content: string | Buffer,
): Promise<FileOperationResult> {
  const fullFilePath = safeJoin(ctx.appPath, filePath);

  // Track if this is a shared module
  if (isSharedServerModule(filePath)) {
    sharedModulesChanged = true;
  }

  try {
    // Ensure directory exists
    const dirPath = path.dirname(fullFilePath);
    fs.mkdirSync(dirPath, { recursive: true });

    // Write file content
    fs.writeFileSync(fullFilePath, content);
    logger.log(`Successfully wrote file: ${fullFilePath}`);

    // Deploy Supabase function if applicable
    if (
      ctx.supabaseProjectId &&
      isServerFunction(filePath) &&
      typeof content === "string" &&
      !sharedModulesChanged
    ) {
      try {
        await deploySupabaseFunction({
          supabaseProjectId: ctx.supabaseProjectId,
          functionName: path.basename(path.dirname(filePath)),
          appPath: ctx.appPath,
        });
      } catch (error) {
        return {
          success: true,
          warning: `File written, but failed to deploy Supabase function: ${error}`,
        };
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to write file: ${error}` };
  }
}

/**
 * Delete a file from the codebase
 */
export async function executeDeleteFile(
  ctx: FileOperationContext,
  filePath: string,
): Promise<FileOperationResult> {
  const fullFilePath = safeJoin(ctx.appPath, filePath);

  // Track if this is a shared module
  if (isSharedServerModule(filePath)) {
    sharedModulesChanged = true;
  }

  try {
    if (fs.existsSync(fullFilePath)) {
      if (fs.lstatSync(fullFilePath).isDirectory()) {
        fs.rmdirSync(fullFilePath, { recursive: true });
      } else {
        fs.unlinkSync(fullFilePath);
      }
      logger.log(`Successfully deleted file: ${fullFilePath}`);

      // Remove from git
      try {
        await gitRemove({ path: ctx.appPath, filepath: filePath });
      } catch (error) {
        logger.warn(`Failed to git remove deleted file ${filePath}:`, error);
      }

      // Delete Supabase function if applicable
      if (ctx.supabaseProjectId && isServerFunction(filePath)) {
        try {
          await deleteSupabaseFunction({
            supabaseProjectId: ctx.supabaseProjectId,
            functionName: getFunctionNameFromPath(filePath),
          });
        } catch (error) {
          return {
            success: true,
            warning: `File deleted, but failed to delete Supabase function: ${error}`,
          };
        }
      }
    } else {
      logger.warn(`File to delete does not exist: ${fullFilePath}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to delete file: ${error}` };
  }
}

/**
 * Rename/move a file in the codebase
 */
export async function executeRenameFile(
  ctx: FileOperationContext,
  fromPath: string,
  toPath: string,
): Promise<FileOperationResult> {
  const fromFullPath = safeJoin(ctx.appPath, fromPath);
  const toFullPath = safeJoin(ctx.appPath, toPath);

  // Track if this involves shared modules
  if (isSharedServerModule(fromPath) || isSharedServerModule(toPath)) {
    sharedModulesChanged = true;
  }

  try {
    // Ensure target directory exists
    const dirPath = path.dirname(toFullPath);
    fs.mkdirSync(dirPath, { recursive: true });

    if (fs.existsSync(fromFullPath)) {
      fs.renameSync(fromFullPath, toFullPath);
      logger.log(`Successfully renamed file: ${fromFullPath} -> ${toFullPath}`);

      // Update git
      await gitAdd({ path: ctx.appPath, filepath: toPath });
      try {
        await gitRemove({ path: ctx.appPath, filepath: fromPath });
      } catch (error) {
        logger.warn(`Failed to git remove old file ${fromPath}:`, error);
      }

      // Handle Supabase functions
      if (ctx.supabaseProjectId) {
        if (isServerFunction(fromPath)) {
          try {
            await deleteSupabaseFunction({
              supabaseProjectId: ctx.supabaseProjectId,
              functionName: getFunctionNameFromPath(fromPath),
            });
          } catch (error) {
            logger.warn(
              `Failed to delete old Supabase function: ${fromPath}`,
              error,
            );
          }
        }
        if (isServerFunction(toPath) && !sharedModulesChanged) {
          try {
            await deploySupabaseFunction({
              supabaseProjectId: ctx.supabaseProjectId,
              functionName: getFunctionNameFromPath(toPath),
              appPath: ctx.appPath,
            });
          } catch (error) {
            return {
              success: true,
              warning: `File renamed, but failed to deploy Supabase function: ${error}`,
            };
          }
        }
      }
    } else {
      logger.warn(`Source file for rename does not exist: ${fromFullPath}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to rename file: ${error}` };
  }
}

/**
 * Apply search/replace edits to a file
 */
export async function executeSearchReplaceFile(
  ctx: FileOperationContext,
  filePath: string,
  search: string,
  replace: string,
): Promise<FileOperationResult> {
  const fullFilePath = safeJoin(ctx.appPath, filePath);

  // Track if this is a shared module
  if (isSharedServerModule(filePath)) {
    sharedModulesChanged = true;
  }

  try {
    if (!fs.existsSync(fullFilePath)) {
      return { success: false, error: `File does not exist: ${filePath}` };
    }

    const original = await readFile(fullFilePath, "utf8");
    console.log("FILE PATH: ", filePath, "original*******", original);
    // Construct the operations string in the expected format
    const operations = `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;
    const result = applySearchReplace(original, operations);

    if (!result.success || typeof result.content !== "string") {
      return {
        success: false,
        error: `Failed to apply search-replace: ${result.error ?? "unknown"}`,
      };
    }

    fs.writeFileSync(fullFilePath, result.content);
    logger.log(`Successfully applied search-replace to: ${fullFilePath}`);

    // Deploy Supabase function if applicable
    if (
      ctx.supabaseProjectId &&
      isServerFunction(filePath) &&
      !sharedModulesChanged
    ) {
      try {
        await deploySupabaseFunction({
          supabaseProjectId: ctx.supabaseProjectId,
          functionName: path.basename(path.dirname(filePath)),
          appPath: ctx.appPath,
        });
      } catch (error) {
        return {
          success: true,
          warning: `Search-replace applied, but failed to deploy Supabase function: ${error}`,
        };
      }
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to apply search-replace: ${error}`,
    };
  }
}

/**
 * Add npm dependencies
 */
export async function executeAddDependencies(
  ctx: FileOperationContext,
  packages: string[],
  messageId?: number,
): Promise<FileOperationResult> {
  try {
    const message = messageId
      ? await db.query.messages.findFirst({ where: eq(messages.id, messageId) })
      : undefined;

    if (!message) {
      return {
        success: false,
        error: "Message not found for adding dependencies",
      };
    }

    await executeAddDependency({
      packages,
      message,
      appPath: ctx.appPath,
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to add dependencies: ${error}` };
  }
}

/**
 * Execute SQL on Supabase
 */
export async function executeSupabaseSqlQuery(
  ctx: FileOperationContext,
  query: string,
  description?: string,
): Promise<FileOperationResult> {
  if (!ctx.supabaseProjectId) {
    return { success: false, error: "Supabase is not connected to this app" };
  }

  try {
    await executeSupabaseSql({
      supabaseProjectId: ctx.supabaseProjectId,
      query,
    });

    // Write migration file if enabled
    const settings = readSettings();
    if (settings.enableSupabaseWriteSqlMigration) {
      try {
        await writeMigrationFile(ctx.appPath, query, description);
      } catch (error) {
        return {
          success: true,
          warning: `SQL executed, but failed to write migration file: ${error}`,
        };
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to execute SQL: ${error}` };
  }
}

/**
 * Read a file for context
 */
export async function readFileForContext(
  ctx: FileOperationContext,
  filePath: string,
): Promise<{ success: boolean; content?: string; error?: string }> {
  const fullFilePath = safeJoin(ctx.appPath, filePath);

  try {
    if (!fs.existsSync(fullFilePath)) {
      return { success: false, error: `File does not exist: ${filePath}` };
    }

    const content = await readFile(fullFilePath, "utf8");
    return { success: true, content };
  } catch (error) {
    return { success: false, error: `Failed to read file: ${error}` };
  }
}

/**
 * List files in the app directory
 */
export async function listFilesInApp(
  ctx: FileOperationContext,
  directory?: string,
): Promise<{ success: boolean; files?: string; error?: string }> {
  try {
    const { files } = await extractCodebase({
      appPath: ctx.appPath,
      // TODO
      chatContext: {
        contextPaths: directory ? [{ globPath: directory + "/**" }] : [],
        smartContextAutoIncludes: [],
        excludePaths: [],
      },
    });

    return {
      success: true,
      files: files.map((file) => " - " + file.path).join("\n"),
    };
  } catch (error) {
    return { success: false, error: `Failed to list files: ${error}` };
  }
}

/**
 * Get database schema from Supabase
 */
export async function getDatabaseSchema(
  ctx: FileOperationContext,
): Promise<{ success: boolean; schema?: string; error?: string }> {
  if (!ctx.supabaseProjectId) {
    return { success: false, error: "Supabase is not connected to this app" };
  }

  try {
    const schema = await getSupabaseContext({
      supabaseProjectId: ctx.supabaseProjectId,
    });
    return { success: true, schema };
  } catch (error) {
    return { success: false, error: `Failed to get database schema: ${error}` };
  }
}

/**
 * Deploy all Supabase functions (after shared module changes)
 */
export async function deployAllFunctionsIfNeeded(
  ctx: FileOperationContext,
): Promise<FileOperationResult> {
  if (!ctx.supabaseProjectId || !sharedModulesChanged) {
    return { success: true };
  }

  try {
    logger.info("Shared modules changed, redeploying all Supabase functions");
    const deployErrors = await deployAllSupabaseFunctions({
      appPath: ctx.appPath,
      supabaseProjectId: ctx.supabaseProjectId,
    });

    if (deployErrors.length > 0) {
      return {
        success: true,
        warning: `Some Supabase functions failed to deploy: ${deployErrors.join(", ")}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to redeploy Supabase functions: ${error}`,
    };
  }
}

/**
 * Commit all changes
 */
export async function commitAllChanges(
  ctx: FileOperationContext,
  writtenFiles: string[],
  deletedFiles: string[],
  renamedFiles: string[],
  packagesAdded: string[],
  sqlQueriesExecuted: number,
  chatSummary?: string,
): Promise<{
  success: boolean;
  commitHash?: string;
  extraFiles?: string[];
  error?: string;
}> {
  const hasChanges =
    writtenFiles.length > 0 ||
    deletedFiles.length > 0 ||
    renamedFiles.length > 0 ||
    packagesAdded.length > 0;

  if (!hasChanges) {
    return { success: true };
  }

  try {
    // Stage all written files
    for (const file of writtenFiles) {
      await gitAdd({ path: ctx.appPath, filepath: file });
    }

    // Create commit message
    const changes = [];
    if (writtenFiles.length > 0)
      changes.push(`wrote ${writtenFiles.length} file(s)`);
    if (renamedFiles.length > 0)
      changes.push(`renamed ${renamedFiles.length} file(s)`);
    if (deletedFiles.length > 0)
      changes.push(`deleted ${deletedFiles.length} file(s)`);
    if (packagesAdded.length > 0)
      changes.push(`added ${packagesAdded.join(", ")} package(s)`);
    if (sqlQueriesExecuted > 0)
      changes.push(`executed ${sqlQueriesExecuted} SQL queries`);

    let message = chatSummary
      ? `[dyad] ${chatSummary} - ${changes.join(", ")}`
      : `[dyad] ${changes.join(", ")}`;

    let commitHash = await gitCommit({
      path: ctx.appPath,
      message,
    });

    // Check for uncommitted changes
    const uncommittedFiles = await getGitUncommittedFiles({
      path: ctx.appPath,
    });

    if (uncommittedFiles.length > 0) {
      await gitAddAll({ path: ctx.appPath });
      try {
        commitHash = await gitCommit({
          path: ctx.appPath,
          message: message + " + extra files edited outside of Dyad",
          amend: true,
        });
      } catch (error) {
        logger.error(
          `Failed to commit extra files: ${uncommittedFiles.join(", ")}`,
          error,
        );
      }
    }

    return {
      success: true,
      commitHash,
      extraFiles: uncommittedFiles.length > 0 ? uncommittedFiles : undefined,
    };
  } catch (error) {
    return { success: false, error: `Failed to commit changes: ${error}` };
  }
}
