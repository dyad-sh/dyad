import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import log from "electron-log";
import {
  bulkUpdateFunctions,
  deleteSupabaseFunction,
  deploySupabaseFunction,
  listSupabaseFunctions,
  type DeployedFunctionResponse,
} from "./supabase_management_client";
import { SUPABASE_BUNDLE_ONLY_DEPLOY_CONCURRENCY } from "./supabase_deploy_queue";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("supabase_utils");
const require = createRequire(import.meta.url);

export interface SupabaseDeployProgress {
  phase: "deploying" | "finished" | "failed";
  total: number;
  active: number;
  queued: number;
  completed: number;
  succeeded: number;
  failed: number;
  functionName?: string;
}

export async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: Array<PromiseSettledResult<R> | undefined> = Array.from({
    length: items.length,
  });
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      try {
        results[currentIndex] = {
          status: "fulfilled",
          value: await mapper(items[currentIndex], currentIndex),
        };
      } catch (reason) {
        results[currentIndex] = {
          status: "rejected",
          reason,
        };
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results.map((result) => result!);
}

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
    throw new DyadError(
      `Invalid Supabase function path: ${filePath}. Expected format: supabase/functions/{functionName}/...`,
      DyadErrorKind.Validation,
    );
  }

  const functionName = match[1];

  // Exclude _shared and other special directories
  if (functionName.startsWith("_")) {
    throw new DyadError(
      `Invalid Supabase function path: ${filePath}. Function names starting with "_" are reserved for special directories.`,
      DyadErrorKind.Validation,
    );
  }

  return functionName;
}

export type SupabaseFunctionImpact =
  | { kind: "partial"; functionNames: string[] }
  | { kind: "all"; reason: string };

const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const RESOLUTION_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
];

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function isPathWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function getValidSupabaseFunctionNames(
  functionsDir: string,
): Promise<string[]> {
  const entries = await fs.readdir(functionsDir, { withFileTypes: true });
  const validFunctions: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue;
    }

    const indexPath = path.join(functionsDir, entry.name, "index.ts");
    try {
      await fs.access(indexPath);
      validFunctions.push(entry.name);
    } catch {
      logger.warn(`Skipping ${entry.name}: index.ts not found at ${indexPath}`);
    }
  }

  return validFunctions;
}

function loadAppTypeScript(
  appPath: string,
): typeof import("typescript") | null {
  try {
    const tsPath = require.resolve("typescript", { paths: [appPath] });
    return require(tsPath) as typeof import("typescript");
  } catch {
    return null;
  }
}

function scriptKindForPath(ts: typeof import("typescript"), filePath: string) {
  switch (path.extname(filePath)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function isClearlyExternalSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("npm:") ||
    specifier.startsWith("jsr:") ||
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("@supabase/")
  );
}

async function resolveLocalImport({
  fromFile,
  specifier,
  functionsDir,
}: {
  fromFile: string;
  specifier: string;
  functionsDir: string;
}): Promise<string | SupabaseFunctionImpact> {
  const resolvedBase = path.resolve(path.dirname(fromFile), specifier);

  if (!isPathWithin(functionsDir, resolvedBase)) {
    return {
      kind: "all",
      reason: `relative_import_outside_supabase_functions:${specifier}`,
    };
  }

  const ext = path.extname(resolvedBase);
  const candidates =
    ext.length > 0
      ? [resolvedBase]
      : [
          resolvedBase,
          ...RESOLUTION_EXTENSIONS.map(
            (candidateExt) => resolvedBase + candidateExt,
          ),
          ...RESOLUTION_EXTENSIONS.map((candidateExt) =>
            path.join(resolvedBase, `index${candidateExt}`),
          ),
        ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        if (!isPathWithin(functionsDir, candidate)) {
          return {
            kind: "all",
            reason: `resolved_import_outside_supabase_functions:${specifier}`,
          };
        }
        return candidate;
      }
    } catch {
      // Try the next supported resolution candidate.
    }
  }

  return { kind: "all", reason: `unresolved_relative_import:${specifier}` };
}

async function collectLocalDependencies({
  ts,
  filePath,
  functionsDir,
}: {
  ts: typeof import("typescript");
  filePath: string;
  functionsDir: string;
}): Promise<string[] | SupabaseFunctionImpact> {
  let sourceText: string;
  try {
    sourceText = await fs.readFile(filePath, "utf8");
  } catch {
    return { kind: "all", reason: `unable_to_read_source:${filePath}` };
  }

  let sourceFile: import("typescript").SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(ts, filePath),
    );
  } catch {
    return { kind: "all", reason: `parse_failure:${filePath}` };
  }

  const specifiers: string[] = [];
  let unsafeReason: string | undefined;

  function addSpecifier(specifierNode: import("typescript").Expression) {
    if (ts.isStringLiteralLike(specifierNode)) {
      specifiers.push(specifierNode.text);
    } else {
      unsafeReason = `non_literal_dynamic_import:${filePath}`;
    }
  }

  function visit(node: import("typescript").Node) {
    if (unsafeReason) {
      return;
    }

    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      addSpecifier(node.moduleSpecifier);
      return;
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [specifier] = node.arguments;
      if (!specifier) {
        unsafeReason = `missing_dynamic_import_specifier:${filePath}`;
        return;
      }
      addSpecifier(specifier);
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      unsafeReason = `commonjs_require:${filePath}`;
      return;
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      unsafeReason = `import_equals_require:${filePath}`;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (unsafeReason) {
    return { kind: "all", reason: unsafeReason };
  }

  const dependencies: string[] = [];
  for (const specifier of specifiers) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const resolved = await resolveLocalImport({
        fromFile: filePath,
        specifier,
        functionsDir,
      });
      if (typeof resolved !== "string") {
        return resolved;
      }
      dependencies.push(resolved);
      continue;
    }

    if (!isClearlyExternalSpecifier(specifier)) {
      return { kind: "all", reason: `unknown_bare_specifier:${specifier}` };
    }
  }

  return dependencies;
}

export async function getSupabaseFunctionsAffectedBySharedModules({
  appPath,
  changedSharedModulePaths,
}: {
  appPath: string;
  changedSharedModulePaths: string[];
}): Promise<SupabaseFunctionImpact> {
  const functionsDir = path.join(appPath, "supabase", "functions");
  try {
    await fs.access(functionsDir);
  } catch {
    return { kind: "partial", functionNames: [] };
  }

  const ts = loadAppTypeScript(appPath);
  if (!ts) {
    return { kind: "all", reason: "typescript_not_installed" };
  }

  const changedSharedPaths = new Set<string>();
  for (const changedPath of changedSharedModulePaths) {
    const normalized = normalizeRelativePath(changedPath);
    const ext = path.extname(normalized);
    if (!SUPPORTED_SOURCE_EXTENSIONS.has(ext)) {
      return {
        kind: "all",
        reason: `unsupported_changed_shared_path:${changedPath}`,
      };
    }

    const absolutePath = path.resolve(appPath, normalized);
    if (!isPathWithin(functionsDir, absolutePath)) {
      return {
        kind: "all",
        reason: `changed_shared_path_outside_functions:${changedPath}`,
      };
    }

    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        return {
          kind: "all",
          reason: `changed_shared_directory:${changedPath}`,
        };
      }
    } catch {
      // Deleted or renamed files may no longer exist. Keep the exact source-like
      // path in the impact set; unresolved imports will force fallback.
    }

    changedSharedPaths.add(absolutePath);
  }

  if (changedSharedPaths.size === 0) {
    return { kind: "partial", functionNames: [] };
  }

  let validFunctions: string[];
  try {
    validFunctions = await getValidSupabaseFunctionNames(functionsDir);
  } catch {
    return { kind: "all", reason: "unable_to_enumerate_functions" };
  }

  const dependencyCache = new Map<string, string[]>();
  const affectedFunctionNames: string[] = [];

  for (const functionName of validFunctions) {
    const entrypoint = path.join(functionsDir, functionName, "index.ts");
    const visited = new Set<string>();
    const stack = [entrypoint];
    let affected = false;

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      if (changedSharedPaths.has(current)) {
        affected = true;
        break;
      }

      let dependencies = dependencyCache.get(current);
      if (!dependencies) {
        const collected = await collectLocalDependencies({
          ts,
          filePath: current,
          functionsDir,
        });
        if (!Array.isArray(collected)) {
          return collected;
        }
        dependencies = collected;
        dependencyCache.set(current, dependencies);
      }

      for (const dependency of dependencies) {
        if (!visited.has(dependency)) {
          stack.push(dependency);
        }
      }
    }

    if (affected) {
      affectedFunctionNames.push(functionName);
    }
  }

  return { kind: "partial", functionNames: affectedFunctionNames };
}

/**
 * Deploys the right Supabase function set after shared module changes and/or
 * deferred direct function deploys.
 */
export async function deployAffectedSupabaseFunctions({
  appPath,
  supabaseProjectId,
  supabaseOrganizationSlug,
  skipPruneEdgeFunctions,
  sharedModulesChanged,
  changedSharedModulePaths,
  pendingFunctionDeploys,
  onProgress,
}: {
  appPath: string;
  supabaseProjectId: string;
  supabaseOrganizationSlug: string | null;
  skipPruneEdgeFunctions: boolean;
  sharedModulesChanged: boolean;
  changedSharedModulePaths: string[];
  pendingFunctionDeploys: string[];
  onProgress?: (progress: SupabaseDeployProgress) => void;
}): Promise<string[]> {
  const deployArgs = {
    appPath,
    supabaseProjectId,
    supabaseOrganizationSlug,
    skipPruneEdgeFunctions,
    onProgress,
  };

  if (sharedModulesChanged) {
    const impact =
      changedSharedModulePaths.length > 0
        ? await getSupabaseFunctionsAffectedBySharedModules({
            appPath,
            changedSharedModulePaths,
          })
        : ({
            kind: "all",
            reason: "changed_shared_paths_missing",
          } as const);

    if (impact.kind === "partial") {
      const functionNames = Array.from(
        new Set([...impact.functionNames, ...pendingFunctionDeploys]),
      );
      logger.info(
        functionNames.length > 0
          ? `Shared modules changed, redeploying affected Supabase functions: ${functionNames.join(", ")}`
          : "Shared modules changed, no affected Supabase functions to bundle",
      );
      return deploySupabaseFunctions({
        ...deployArgs,
        functionNames,
      });
    }

    logger.info(
      `Shared module dependency analysis fell back to all functions: ${impact.reason}`,
    );
    return deployAllSupabaseFunctions(deployArgs);
  }

  const functionNames = Array.from(new Set(pendingFunctionDeploys));
  logger.info(
    `Redeploying pending Supabase functions: ${functionNames.join(", ")}`,
  );
  return deploySupabaseFunctions({
    ...deployArgs,
    functionNames,
  });
}

/**
 * Deploys all Supabase edge functions found in the app's supabase/functions directory
 * @param appPath - The absolute path to the app directory
 * @param supabaseProjectId - The Supabase project ID
 * @param supabaseOrganizationSlug - The Supabase organization slug
 * @param skipPruneEdgeFunctions - If false, delete any deployed edge functions that are not in the codebase
 * @returns An array of error messages for functions that failed to deploy (empty if all succeeded)
 */
export async function deploySupabaseFunctions({
  appPath,
  supabaseProjectId,
  supabaseOrganizationSlug,
  skipPruneEdgeFunctions,
  functionNames,
  onProgress,
}: {
  appPath: string;
  supabaseProjectId: string;
  supabaseOrganizationSlug: string | null;
  skipPruneEdgeFunctions: boolean;
  functionNames?: string[];
  onProgress?: (progress: SupabaseDeployProgress) => void;
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
    const allValidFunctions = await getValidSupabaseFunctionNames(functionsDir);
    const allValidFunctionNames = new Set(allValidFunctions);
    const requestedFunctionNames = functionNames
      ? Array.from(new Set(functionNames))
      : undefined;
    const missingRequestedFunctionNames: string[] = [];
    const validFunctions = requestedFunctionNames
      ? requestedFunctionNames.filter((functionName) => {
          if (allValidFunctionNames.has(functionName)) {
            return true;
          }
          missingRequestedFunctionNames.push(functionName);
          logger.warn(
            `Skipping ${functionName}: index.ts not found in local functions directory`,
          );
          return false;
        })
      : allValidFunctions;
    if (missingRequestedFunctionNames.length > 0) {
      const errorMessage = `Requested Supabase functions do not exist locally or are missing index.ts: ${missingRequestedFunctionNames.join(", ")}`;
      logger.error(errorMessage);
      errors.push(errorMessage);
    }

    logger.info(
      `Found ${validFunctions.length} functions to deploy in ${functionsDir}`,
    );

    if (validFunctions.length === 0) {
      logger.info("No valid functions to deploy");
      if (!requestedFunctionNames) {
        return [];
      }
      if (errors.length > 0) {
        return errors;
      }
    }

    logger.info(
      `Bundling ${validFunctions.length} functions with concurrency ${SUPABASE_BUNDLE_ONLY_DEPLOY_CONCURRENCY}...`,
    );

    const totalFunctions = validFunctions.length;
    let activeFunctions = 0;
    let completedFunctions = 0;
    let succeededFunctions = 0;
    let failedFunctions = 0;

    function emitProgress(
      phase: SupabaseDeployProgress["phase"],
      functionName?: string,
    ) {
      onProgress?.({
        phase,
        total: totalFunctions,
        active: activeFunctions,
        queued: totalFunctions - activeFunctions - completedFunctions,
        completed: completedFunctions,
        succeeded: succeededFunctions,
        failed: failedFunctions,
        functionName,
      });
    }

    if (validFunctions.length > 0) {
      emitProgress("deploying");
    }

    const deployResults = await mapSettledWithConcurrency(
      validFunctions,
      SUPABASE_BUNDLE_ONLY_DEPLOY_CONCURRENCY,
      async (functionName) => {
        activeFunctions++;
        emitProgress("deploying", functionName);
        logger.info(`Bundling function: ${functionName}`);
        try {
          const result = await deploySupabaseFunction({
            supabaseProjectId,
            organizationSlug: supabaseOrganizationSlug,
            functionName,
            appPath,
            bundleOnly: true,
          });
          succeededFunctions++;
          logger.info(`Successfully bundled function: ${functionName}`);
          return result;
        } catch (error) {
          failedFunctions++;
          throw error;
        } finally {
          activeFunctions--;
          completedFunctions++;
          emitProgress("deploying", functionName);
        }
      },
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

    const activationSucceeded = successfulDeploys.length > 0;

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

    // Prune dangling edge functions (deployed but not in codebase)
    if (!skipPruneEdgeFunctions) {
      try {
        logger.info("Checking for dangling edge functions to prune...");
        const deployedFunctions = await listSupabaseFunctions({
          supabaseProjectId,
          organizationSlug: supabaseOrganizationSlug,
        });

        const localFunctionNames = new Set(allValidFunctions);
        const danglingFunctions = deployedFunctions.filter(
          (fn) => !localFunctionNames.has(fn.slug),
        );

        if (danglingFunctions.length > 0) {
          logger.info(
            `Found ${danglingFunctions.length} dangling edge functions to prune: ${danglingFunctions.map((fn) => fn.slug).join(", ")}`,
          );

          for (const fn of danglingFunctions) {
            try {
              await deleteSupabaseFunction({
                supabaseProjectId,
                functionName: fn.slug,
                organizationSlug: supabaseOrganizationSlug,
              });
              logger.info(`Pruned dangling edge function: ${fn.slug}`);
            } catch (deleteError: any) {
              const errorMessage = `Failed to prune edge function ${fn.slug}: ${deleteError.message}`;
              logger.error(errorMessage, deleteError);
              errors.push(errorMessage);
            }
          }
        } else {
          logger.info("No dangling edge functions found");
        }
      } catch (pruneError: any) {
        const errorMessage = `Failed to check for dangling edge functions: ${pruneError.message}`;
        logger.error(errorMessage, pruneError);
        errors.push(errorMessage);
      }
    }

    if (validFunctions.length > 0) {
      emitProgress(
        errors.length === 0 && activationSucceeded ? "finished" : "failed",
      );
    }
  } catch (error: any) {
    const errorMessage = `Error reading functions directory: ${error.message}`;
    logger.error(errorMessage, error);
    errors.push(errorMessage);
  }

  return errors;
}

/**
 * Deploys all Supabase edge functions found in the app's supabase/functions directory
 * @param appPath - The absolute path to the app directory
 * @param supabaseProjectId - The Supabase project ID
 * @param supabaseOrganizationSlug - The Supabase organization slug
 * @param skipPruneEdgeFunctions - If false, delete any deployed edge functions that are not in the codebase
 * @returns An array of error messages for functions that failed to deploy (empty if all succeeded)
 */
export async function deployAllSupabaseFunctions(args: {
  appPath: string;
  supabaseProjectId: string;
  supabaseOrganizationSlug: string | null;
  skipPruneEdgeFunctions: boolean;
  onProgress?: (progress: SupabaseDeployProgress) => void;
}): Promise<string[]> {
  return deploySupabaseFunctions(args);
}
