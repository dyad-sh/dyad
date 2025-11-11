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

interface ZipFileEntry {
  relativePath: string;
  content: Buffer;
  date: Date;
}

interface FileStatEntry {
  absolutePath: string;
  relativePath: string;
  mtimeMs: number;
  size: number;
}

interface CachedSharedFiles {
  signature: string;
  files: ZipFileEntry[];
}

interface CachedFunctionZip {
  signature: string;
  buffer: Buffer;
}

interface FunctionFilesResult {
  files: ZipFileEntry[];
  signature: string;
  entrypointPath: string;
  cacheKey: string;
}

const sharedFilesCache = new Map<string, CachedSharedFiles>();
const functionZipCache = new Map<string, CachedFunctionZip>();

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

export async function deploySupabaseFunctions({
  supabaseProjectId,
  functionName,
  appPath,
  functionPath,
}: {
  supabaseProjectId: string;
  functionName: string;
  appPath: string;
  functionPath: string;
}): Promise<void> {
  logger.info(
    `Deploying Supabase function: ${functionName} to project: ${supabaseProjectId}`,
  );

  const functionFiles = await collectFunctionFiles({
    appPath,
    functionPath,
    functionName,
  });

  const sharedFiles = await getSharedFiles(appPath);

  // Preserve your current structure (no "source/" prefixing)
  let filesToUpload = [...functionFiles.files, ...sharedFiles.files].map(f => ({
    ...f,
    relativePath: f.relativePath,
  }));

  // ————————————————————————————————————————————————————————————————
  // (1) In-memory import rewrite (deploy-only)
  // Convert "../_shared/..." and "./_shared/..." to a bare specifier "_shared/..."
  // This keeps local code unchanged but makes it work reliably in Deno with an import map.
 const rewriteImports = (content: string) =>
  content
    // Replace ANY number of "../" segments before "_shared/" with "./"
    .replace(/(\.\.\/)+_shared\//g, "./_shared/")
    // Normalize accidental "././_shared/" to a single "./_shared/"
    .replace(/(\.\/)+_shared\//g, "./_shared/");



  filesToUpload = filesToUpload.map(f => {
    const isJSorTS =
      f.relativePath.endsWith(".ts") ||
      f.relativePath.endsWith(".js") ||
      f.relativePath.endsWith(".mjs") ||
      f.relativePath.endsWith(".tsx") ||
      f.relativePath.endsWith(".jsx");

    if (!isJSorTS) return f;

    const originalBuf: Buffer =
      (f as any).content ?? (f as any).buffer ?? (f as any).data ?? Buffer.from([]);

    const rewritten = rewriteImports(originalBuf.toString("utf8"));
    if (rewritten === originalBuf.toString("utf8")) return f; // no change

    return {
      ...f,
      // Safe in-memory change for deploy only:
      content: Buffer.from(rewritten, "utf8"),
      buffer: undefined,
      data: undefined,
    };
  });

  // ————————————————————————————————————————————————————————————————
  // (2) Create a fresh import map beside the entrypoint
  // We point the bare specifier "_shared/" to a path *relative to the entrypoint directory*.
  const entrypointPath = functionFiles.entrypointPath; // e.g., "functions/random-demo/index.ts"
  const entryDir = path.posix.dirname(entrypointPath);
  const importMapRelPath = path.posix.join(entryDir, "import_map.json");


  // ————————————————————————————————————————————————————————————————
  // (3) Build multipart form
  const supabase = await getSupabaseClient();
  const formData = new FormData();

  // Metadata: include the newly created import_map path
  const metadata = {
    entrypoint_path: entrypointPath,
    name: functionName,
    verify_jwt: false,
    import_map: importMapRelPath,
  };

  formData.append("metadata", JSON.stringify(metadata));

  const guessMime = (p: string) => {
    if (p.endsWith(".json")) return "application/json";
    if (p.endsWith(".ts")) return "application/typescript";
    if (p.endsWith(".mjs")) return "application/javascript";
    if (p.endsWith(".js")) return "application/javascript";
    if (p.endsWith(".wasm")) return "application/wasm";
    if (p.endsWith(".map")) return "application/json";
    return "application/octet-stream";
  };

  for (const f of filesToUpload) {
    const buf: Buffer =
      (f as any).content ?? (f as any).buffer ?? (f as any).data ?? Buffer.from([]);
    const mime = guessMime(f.relativePath);

    // Use a Uint8Array to avoid TS union issues (ArrayBuffer | SharedArrayBuffer)
    const blob = new Blob([new Uint8Array(buf)], { type: mime });
    formData.append("file", blob, f.relativePath);
  }

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
    const text = await response.text();
    logger.error(`Supabase response: ${response.status} ${text}`);
    throw await createResponseError(response, "create function");
  }

  logger.info(
    `Deployed Supabase function: ${functionName} to project: ${supabaseProjectId}`,
  );
  await response.json();
}


async function collectFunctionFiles({
  appPath,
  functionPath,
  functionName,
}: {
  appPath: string;
  functionPath: string;
  functionName: string;
}): Promise<FunctionFilesResult> {
  const normalizedFunctionPath = path.resolve(functionPath);
  const stats = await fsPromises.stat(normalizedFunctionPath);

  let functionDirectory: string | null = null;

  if (stats.isDirectory()) {
    functionDirectory = normalizedFunctionPath;
  } else {
    functionDirectory = findFunctionDirectory(normalizedFunctionPath, functionName);

    if (!functionDirectory) {
      const relativeFilePath = toPosixPath(
        path.relative(appPath, normalizedFunctionPath),
      );
      const zipRelativePath = stripSupabaseFunctionsPrefix(
        relativeFilePath,
        functionName,
      );
      const content = await fsPromises.readFile(normalizedFunctionPath);
      return {
        files: [
          {
            relativePath: zipRelativePath,
            content,
            date: stats.mtime,
          },
        ],
        signature: buildSignature([
          {
            absolutePath: normalizedFunctionPath,
            relativePath: zipRelativePath,
            mtimeMs: stats.mtimeMs,
            size: stats.size,
          },
        ]),
        entrypointPath: zipRelativePath,
        cacheKey: normalizedFunctionPath,
      };
    }
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

  const statEntries = await listFilesWithStats(functionDirectory, "");
  const signature = buildSignature(statEntries);
  const files = await loadZipEntries(statEntries);

  return {
    files,
    signature,
    entrypointPath: toPosixPath(path.relative(functionDirectory, indexPath)),
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

async function listFilesWithStats(
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
      const nestedEntries = await listFilesWithStats(absolutePath, relativePath);
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

function buildSignature(entries: FileStatEntry[]): string {
  return entries
    .map(
      (entry) =>
        `${entry.relativePath}:${entry.mtimeMs.toString(16)}:${entry.size.toString(16)}`,
    )
    .sort()
    .join("|");
}

async function loadZipEntries(entries: FileStatEntry[]): Promise<ZipFileEntry[]> {
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

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function findFunctionDirectory(
  filePath: string,
  functionName: string,
): string | null {
  let currentDir = path.dirname(filePath);

  while (true) {
    const parentDir = path.dirname(currentDir);
    const normalized = toPosixPath(currentDir);

    if (normalized.endsWith(`/supabase/functions/${functionName}`)) {
      return currentDir;
    }

    if (!normalized.includes("/supabase/functions/")) {
      break;
    }

    if (currentDir === parentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return null;
}

function stripSupabaseFunctionsPrefix(
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

function toDosDateTime(date: Date): { dosDate: number; dosTime: number } {
  let year = date.getFullYear();
  if (year < 1980) {
    year = 1980;
  }
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | seconds;

  return { dosDate, dosTime };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

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
