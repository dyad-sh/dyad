import fs from "node:fs";
import path from "node:path";
import { withLock } from "../ipc/utils/lock_utils";
import { readSettings, writeSettings } from "../main/settings";
import {
  SupabaseManagementAPI,
  SupabaseManagementAPIError,
} from "@dyad-sh/supabase-management-js";
import log from "electron-log";
import { IS_TEST_BUILD } from "../ipc/utils/test_utils";

const fsPromises = fs.promises;

const logger = log.scope("supabase_management_client");

// ─────────────────────────────────────────────────────────────────────
// Interfaces for file collection and caching
// ─────────────────────────────────────────────────────────────────────

interface ZipFileEntry {
  relativePath: string;
  content: Buffer;
  date: Date;
}

export interface FileStatEntry {
  absolutePath: string;
  relativePath: string;
  mtimeMs: number;
  size: number;
}

interface CachedSharedFiles {
  signature: string;
  files: ZipFileEntry[];
}

interface FunctionFilesResult {
  files: ZipFileEntry[];
  signature: string;
  entrypointPath: string;
  cacheKey: string;
}

// Caches for shared files to avoid re-reading unchanged files
const sharedFilesCache = new Map<string, CachedSharedFiles>();

/**
 * Checks if the Supabase access token is expired or about to expire
 * Returns true if token needs to be refreshed
 */
function isTokenExpired(expiresIn?: number): boolean {
  if (!expiresIn) return true;

  // Get when the token was saved (expiresIn is stored at the time of token receipt)
  const settings = readSettings();
  const tokenTimestamp = settings.supabase?.tokenTimestamp || 0;
  const currentTime = Math.floor(Date.now() / 1000);

  // Check if the token is expired or about to expire (within 5 minutes)
  return currentTime >= tokenTimestamp + expiresIn - 300;
}

/**
 * Refreshes the Supabase access token using the refresh token
 * Updates settings with new tokens and expiration time
 */
export async function refreshSupabaseToken(): Promise<void> {
  const settings = readSettings();
  const refreshToken = settings.supabase?.refreshToken?.value;

  if (!isTokenExpired(settings.supabase?.expiresIn)) {
    return;
  }

  if (!refreshToken) {
    throw new Error(
      "Supabase refresh token not found. Please authenticate first.",
    );
  }

  try {
    // Make request to Supabase refresh endpoint
    const response = await fetch(
      "https://supabase-oauth.dyad.sh/api/connect-supabase/refresh",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Supabase token refresh failed. Try going to Settings to disconnect Supabase and then reconnect to Supabase. Error status: ${response.statusText}`,
      );
    }

    const {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn,
    } = await response.json();

    // Update settings with new tokens
    writeSettings({
      supabase: {
        accessToken: {
          value: accessToken,
        },
        refreshToken: {
          value: newRefreshToken,
        },
        expiresIn,
        tokenTimestamp: Math.floor(Date.now() / 1000), // Store current timestamp
      },
    });
  } catch (error) {
    logger.error("Error refreshing Supabase token:", error);
    throw error;
  }
}

// Function to get the Supabase Management API client
export async function getSupabaseClient(): Promise<SupabaseManagementAPI> {
  const settings = readSettings();

  // Check if Supabase token exists in settings
  const supabaseAccessToken = settings.supabase?.accessToken?.value;
  const expiresIn = settings.supabase?.expiresIn;

  if (!supabaseAccessToken) {
    throw new Error(
      "Supabase access token not found. Please authenticate first.",
    );
  }

  // Check if token needs refreshing
  if (isTokenExpired(expiresIn)) {
    await withLock("refresh-supabase-token", refreshSupabaseToken);
    // Get updated settings after refresh
    const updatedSettings = readSettings();
    const newAccessToken = updatedSettings.supabase?.accessToken?.value;

    if (!newAccessToken) {
      throw new Error("Failed to refresh Supabase access token");
    }

    return new SupabaseManagementAPI({
      accessToken: newAccessToken,
    });
  }

  return new SupabaseManagementAPI({
    accessToken: supabaseAccessToken,
  });
}

export async function getSupabaseProjectName(
  projectId: string,
): Promise<string> {
  if (IS_TEST_BUILD) {
    return "Fake Supabase Project";
  }

  const supabase = await getSupabaseClient();
  const projects = await supabase.getProjects();
  const project = projects?.find((p) => p.id === projectId);
  return project?.name || `<project not found for: ${projectId}>`;
}

export async function executeSupabaseSql({
  supabaseProjectId,
  query,
}: {
  supabaseProjectId: string;
  query: string;
}): Promise<string> {
  if (IS_TEST_BUILD) {
    return "{}";
  }

  const supabase = await getSupabaseClient();
  const result = await supabase.runQuery(supabaseProjectId, query);
  return JSON.stringify(result);
}

export async function deleteSupabaseFunction({
  supabaseProjectId,
  functionName,
}: {
  supabaseProjectId: string;
  functionName: string;
}): Promise<void> {
  logger.info(
    `Deleting Supabase function: ${functionName} from project: ${supabaseProjectId}`,
  );
  const supabase = await getSupabaseClient();
  await supabase.deleteFunction(supabaseProjectId, functionName);
  logger.info(
    `Deleted Supabase function: ${functionName} from project: ${supabaseProjectId}`,
  );
}

export async function listSupabaseBranches({
  supabaseProjectId,
}: {
  supabaseProjectId: string;
}): Promise<
  Array<{
    id: string;
    name: string;
    is_default: boolean;
    project_ref: string;
    parent_project_ref: string;
  }>
> {
  if (IS_TEST_BUILD) {
    return [
      {
        id: "default-branch-id",
        name: "Default Branch",
        is_default: true,
        project_ref: "fake-project-id",
        parent_project_ref: "fake-project-id",
      },

      {
        id: "test-branch-id",
        name: "Test Branch",
        is_default: false,
        project_ref: "test-branch-project-id",
        parent_project_ref: "fake-project-id",
      },
    ];
  }

  logger.info(`Listing Supabase branches for project: ${supabaseProjectId}`);
  const supabase = await getSupabaseClient();

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${supabaseProjectId}/branches`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
      },
    },
  );

  if (response.status !== 200) {
    throw await createResponseError(response, "list branches");
  }

  logger.info(`Listed Supabase branches for project: ${supabaseProjectId}`);
  const jsonResponse = await response.json();
  return jsonResponse;
}

// ─────────────────────────────────────────────────────────────────────
// Deploy Supabase Functions with shared module support
// ─────────────────────────────────────────────────────────────────────

export async function deploySupabaseFunction({
  supabaseProjectId,
  functionName,
  appPath,
}: {
  supabaseProjectId: string;
  functionName: string;
  appPath: string;
}): Promise<void> {
  logger.info(
    `Deploying Supabase function: ${functionName} to project: ${supabaseProjectId}`,
  );

  const functionPath = path.join(
    appPath,
    "supabase",
    "functions",
    functionName,
  );

  // 1) Collect function files
  const functionFiles = await collectFunctionFiles({
    functionPath,
    functionName,
  });

  // 2) Collect shared files (from supabase/functions/_shared/)
  const sharedFiles = await getSharedFiles(appPath);

  // 3) Combine all files
  const filesToUpload = [...functionFiles.files, ...sharedFiles.files];

  // 4) Create an import map next to the function entrypoint
  const entrypointPath = functionFiles.entrypointPath;
  const entryDir = path.posix.dirname(entrypointPath);
  const importMapRelPath = path.posix.join(entryDir, "import_map.json");

  const importMapObject = {
    imports: {
      // This resolves "_shared/" imports to the _shared directory
      // From {functionName}/index.ts, ../_shared/ goes up to root then into _shared/
      "_shared/": "../_shared/",
    },
  };

  // Add the import map file into the upload list
  filesToUpload.push({
    relativePath: importMapRelPath,
    content: Buffer.from(JSON.stringify(importMapObject, null, 2)),
    date: new Date(),
  });

  // 5) Prepare multipart form-data
  const supabase = await getSupabaseClient();
  const formData = new FormData();

  // Metadata: instruct Supabase to use our import map
  const metadata = {
    entrypoint_path: entrypointPath,
    name: functionName,
    verify_jwt: false,
    import_map: importMapRelPath,
  };

  formData.append("metadata", JSON.stringify(metadata));

  // Add all files to form data
  for (const f of filesToUpload) {
    const buf: Buffer = f.content;
    const mime = guessMimeType(f.relativePath);
    const blob = new Blob([new Uint8Array(buf)], { type: mime });
    formData.append("file", blob, f.relativePath);
  }

  // 6) Perform the deploy request
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(
      supabaseProjectId,
    )}/functions/deploy?slug=${encodeURIComponent(functionName)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
      },
      body: formData,
    },
  );

  if (response.status !== 201) {
    throw await createResponseError(response, "create function");
  }

  logger.info(
    `Deployed Supabase function: ${functionName} to project: ${supabaseProjectId}`,
  );

  await response.json();
}

// ─────────────────────────────────────────────────────────────────────
// File collection helpers
// ─────────────────────────────────────────────────────────────────────

async function collectFunctionFiles({
  functionPath,
  functionName,
}: {
  functionPath: string;
  functionName: string;
}): Promise<FunctionFilesResult> {
  const normalizedFunctionPath = path.resolve(functionPath);
  const stats = await fsPromises.stat(normalizedFunctionPath);

  let functionDirectory: string | null = null;

  if (stats.isDirectory()) {
    functionDirectory = normalizedFunctionPath;
  }

  if (!functionDirectory) {
    throw new Error(
      `Unable to locate directory for Supabase function ${functionName}`,
    );
  }

  const indexPath = path.join(functionDirectory, "index.ts");

  try {
    await fsPromises.access(indexPath);
  } catch {
    throw new Error(
      `Supabase function ${functionName} is missing an index.ts entrypoint`,
    );
  }

  // Prefix function files with functionName so the directory structure allows
  // relative imports like "../_shared/" to resolve correctly
  const statEntries = await listFilesWithStats(functionDirectory, functionName);
  const signature = buildSignature(statEntries);
  const files = await loadZipEntries(statEntries);

  return {
    files,
    signature,
    entrypointPath: path.posix.join(
      functionName,
      toPosixPath(path.relative(functionDirectory, indexPath)),
    ),
    cacheKey: functionDirectory,
  };
}

async function getSharedFiles(appPath: string): Promise<CachedSharedFiles> {
  const sharedDirectory = path.join(
    appPath,
    "supabase",
    "functions",
    "_shared",
  );

  try {
    const sharedStats = await fsPromises.stat(sharedDirectory);
    if (!sharedStats.isDirectory()) {
      return { signature: "", files: [] };
    }
  } catch (error: any) {
    if (error && error.code === "ENOENT") {
      return { signature: "", files: [] };
    }
    throw error;
  }

  const statEntries = await listFilesWithStats(sharedDirectory, "_shared");
  const signature = buildSignature(statEntries);

  const cached = sharedFilesCache.get(sharedDirectory);
  if (cached && cached.signature === signature) {
    return cached;
  }

  const files = await loadZipEntries(statEntries);
  const result = { signature, files };
  sharedFilesCache.set(sharedDirectory, result);
  return result;
}

export async function listFilesWithStats(
  directory: string,
  prefix: string,
): Promise<FileStatEntry[]> {
  const dirents = await fsPromises.readdir(directory, { withFileTypes: true });
  dirents.sort((a, b) => a.name.localeCompare(b.name));
  const entries: FileStatEntry[] = [];

  for (const dirent of dirents) {
    const absolutePath = path.join(directory, dirent.name);
    const relativePath = path.posix.join(prefix, dirent.name);

    if (dirent.isDirectory()) {
      const nestedEntries = await listFilesWithStats(
        absolutePath,
        relativePath,
      );
      entries.push(...nestedEntries);
    } else if (dirent.isFile() || dirent.isSymbolicLink()) {
      const stat = await fsPromises.stat(absolutePath);
      entries.push({
        absolutePath,
        relativePath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }

  return entries;
}

export function buildSignature(entries: FileStatEntry[]): string {
  return entries
    .map(
      (entry) =>
        `${entry.relativePath}:${entry.mtimeMs.toString(16)}:${entry.size.toString(16)}`,
    )
    .sort()
    .join("|");
}

async function loadZipEntries(
  entries: FileStatEntry[],
): Promise<ZipFileEntry[]> {
  const files: ZipFileEntry[] = [];

  for (const entry of entries) {
    const content = await fsPromises.readFile(entry.absolutePath);
    files.push({
      relativePath: toPosixPath(entry.relativePath),
      content,
      date: new Date(entry.mtimeMs),
    });
  }

  return files;
}

// ─────────────────────────────────────────────────────────────────────
// Path helpers (exported for testing)
// ─────────────────────────────────────────────────────────────────────

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

export function stripSupabaseFunctionsPrefix(
  relativePath: string,
  functionName: string,
): string {
  const normalized = toPosixPath(relativePath).replace(/^\//, "");
  const slugPrefix = `supabase/functions/${functionName}/`;

  if (normalized.startsWith(slugPrefix)) {
    const remainder = normalized.slice(slugPrefix.length);
    return remainder || "index.ts";
  }

  const slugFilePrefix = `supabase/functions/${functionName}`;

  if (normalized.startsWith(slugFilePrefix)) {
    const remainder = normalized.slice(slugFilePrefix.length);
    if (remainder.startsWith("/")) {
      const trimmed = remainder.slice(1);
      return trimmed || "index.ts";
    }
    const combined = `${functionName}${remainder}`;
    return combined || "index.ts";
  }

  const basePrefix = "supabase/functions/";
  if (normalized.startsWith(basePrefix)) {
    const withoutBase = normalized.slice(basePrefix.length);
    return withoutBase || path.posix.basename(normalized);
  }

  return normalized || path.posix.basename(relativePath);
}

function guessMimeType(filePath: string): string {
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".ts")) return "application/typescript";
  if (filePath.endsWith(".mjs")) return "application/javascript";
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  if (filePath.endsWith(".map")) return "application/json";
  return "application/octet-stream";
}

// ─────────────────────────────────────────────────────────────────────
// Error handling helpers
// ─────────────────────────────────────────────────────────────────────

async function createResponseError(response: Response, action: string) {
  const errorBody = await safeParseErrorResponseBody(response);

  return new SupabaseManagementAPIError(
    `Failed to ${action}: ${response.statusText} (${response.status})${
      errorBody ? `: ${errorBody.message}` : ""
    }`,
    response,
  );
}

async function safeParseErrorResponseBody(
  response: Response,
): Promise<{ message: string } | undefined> {
  try {
    const body = await response.json();

    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      return { message: body.message };
    }
  } catch {
    return;
  }
}
