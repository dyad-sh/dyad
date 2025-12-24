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
import type { SupabaseOrganizationCredentials } from "../lib/schemas";

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

export interface DeployedFunctionResponse {
  id: string;
  slug: string;
  name: string;
  status: "ACTIVE" | "REMOVED" | "THROTTLED";
  version: number;
  created_at?: number;
  updated_at?: number;
  verify_jwt?: boolean;
  import_map?: boolean;
  entrypoint_path?: string;
  import_map_path?: string;
  ezbr_sha256?: string;
}

export interface SupabaseProjectLog {
  timestamp: number;
  event_message: string;
  metadata: any;
}

export interface SupabaseProjectLogsResponse {
  result: SupabaseProjectLog[];
  error?: any;
}

export interface SupabaseProjectBranch {
  id: string;
  name: string;
  is_default: boolean;
  project_ref: string;
  parent_project_ref: string;
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
export async function getSupabaseClient({
  organizationSlug,
}: { organizationSlug?: string | null } = {}): Promise<SupabaseManagementAPI> {
  // If organizationSlug provided, use organization-specific credentials
  if (organizationSlug) {
    return getSupabaseClientForOrganization(organizationSlug);
  }

  // Otherwise fall back to legacy single-account credentials
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

// ─────────────────────────────────────────────────────────────────────
// Multi-organization support
// ─────────────────────────────────────────────────────────────────────

/**
 * Checks if an organization's token is expired or about to expire.
 */
function isOrganizationTokenExpired(
  org: SupabaseOrganizationCredentials,
): boolean {
  if (!org.expiresIn || !org.tokenTimestamp) return true;

  const currentTime = Math.floor(Date.now() / 1000);
  // Check if the token is expired or about to expire (within 5 minutes)
  return currentTime >= org.tokenTimestamp + org.expiresIn - 300;
}

/**
 * Refreshes the Supabase access token for a specific organization.
 */
async function refreshSupabaseTokenForOrganization(
  organizationSlug: string,
): Promise<void> {
  const settings = readSettings();
  const org = settings.supabase?.organizations?.[organizationSlug];

  if (!org) {
    throw new Error(
      `Supabase organization ${organizationSlug} not found. Please authenticate first.`,
    );
  }

  if (!isOrganizationTokenExpired(org)) {
    return;
  }

  const refreshToken = org.refreshToken?.value;
  if (!refreshToken) {
    throw new Error(
      "Supabase refresh token not found. Please authenticate first.",
    );
  }

  try {
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
        `Supabase token refresh failed. Try going to Settings to disconnect Supabase and then reconnect. Error status: ${response.statusText}`,
      );
    }

    const {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn,
    } = await response.json();

    // Update the specific organization in settings
    const existingOrgs = settings.supabase?.organizations ?? {};
    writeSettings({
      supabase: {
        ...settings.supabase,
        organizations: {
          ...existingOrgs,
          [organizationSlug]: {
            ...org,
            accessToken: {
              value: accessToken,
            },
            refreshToken: {
              value: newRefreshToken,
            },
            expiresIn,
            tokenTimestamp: Math.floor(Date.now() / 1000),
          },
        },
      },
    });
  } catch (error) {
    logger.error(
      `Error refreshing Supabase token for organization ${organizationSlug}:`,
      error,
    );
    throw error;
  }
}

/**
 * Gets a Supabase Management API client for a specific organization.
 */
export async function getSupabaseClientForOrganization(
  organizationSlug: string,
): Promise<SupabaseManagementAPI> {
  const settings = readSettings();
  const org = settings.supabase?.organizations?.[organizationSlug];

  if (!org) {
    throw new Error(
      `Supabase organization ${organizationSlug} not found. Please authenticate first.`,
    );
  }

  const accessToken = org.accessToken?.value;
  if (!accessToken) {
    throw new Error(
      `Supabase access token not found for organization ${organizationSlug}. Please authenticate first.`,
    );
  }

  // Check if token needs refreshing
  if (isOrganizationTokenExpired(org)) {
    await withLock(`refresh-supabase-token-${organizationSlug}`, () =>
      refreshSupabaseTokenForOrganization(organizationSlug),
    );
    // Get updated settings after refresh
    const updatedSettings = readSettings();
    const updatedOrg =
      updatedSettings.supabase?.organizations?.[organizationSlug];
    const newAccessToken = updatedOrg?.accessToken?.value;

    if (!newAccessToken) {
      throw new Error(
        `Failed to refresh Supabase access token for organization ${organizationSlug}`,
      );
    }

    return new SupabaseManagementAPI({
      accessToken: newAccessToken,
    });
  }

  return new SupabaseManagementAPI({
    accessToken,
  });
}

/**
 * Lists organizations for a given access token.
 */
export async function listSupabaseOrganizations(
  accessToken: string,
): Promise<SupabaseOrganizationDetails[]> {
  const response = await fetch("https://api.supabase.com/v1/organizations", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status !== 200) {
    const errorText = await response.text();
    logger.error(
      `Failed to fetch organizations (${response.status}): ${errorText}`,
    );
    throw new Error(`Failed to fetch organizations: ${response.statusText}`);
  }

  const organizations: SupabaseOrganizationDetails[] = await response.json();
  return organizations;
}

export interface SupabaseOrganizationMember {
  userId: string;
  email: string;
  role: string; // "Owner" | "Member" | etc.
  username?: string;
}

interface SupabaseRawMember {
  user_id: string;
  primary_email?: string;
  email: string;
  role_name: string;
  username?: string;
}

/**
 * Gets members of a Supabase organization.
 */
export async function getOrganizationMembers(
  organizationSlug: string,
): Promise<SupabaseOrganizationMember[]> {
  if (IS_TEST_BUILD) {
    return [
      {
        userId: "fake-user-id",
        email: "owner@example.com",
        role: "Owner",
        username: "owner",
      },
    ];
  }

  const client = await getSupabaseClientForOrganization(organizationSlug);
  const accessToken = (client as any).options.accessToken;

  const response = await fetch(
    `https://api.supabase.com/v1/organizations/${organizationSlug}/members`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (response.status !== 200) {
    const errorText = await response.text();
    logger.error(
      `Failed to fetch organization members (${response.status}): ${errorText}`,
    );
    throw new Error(
      `Failed to fetch organization members: ${response.statusText}`,
    );
  }

  const members: SupabaseRawMember[] = await response.json();
  return members.map((m) => ({
    userId: m.user_id,
    email: m.primary_email || m.email,
    role: m.role_name,
    username: m.username,
  }));
}

export interface SupabaseOrganizationDetails {
  id: string;
  name: string;
  slug: string;
}

/**
 * Gets details about a Supabase organization.
 */
export async function getOrganizationDetails(
  organizationSlug: string,
): Promise<SupabaseOrganizationDetails> {
  if (IS_TEST_BUILD) {
    return {
      id: organizationSlug,
      name: "Fake Organization",
      slug: "fake-org",
    };
  }

  const client = await getSupabaseClientForOrganization(organizationSlug);
  const accessToken = (client as any).options.accessToken;

  const response = await fetch(
    `https://api.supabase.com/v1/organizations/${organizationSlug}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (response.status !== 200) {
    const errorText = await response.text();
    logger.error(
      `Failed to fetch organization details (${response.status}): ${errorText}`,
    );
    throw new Error(
      `Failed to fetch organization details: ${response.statusText}`,
    );
  }

  const org = await response.json();
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
  };
}

export async function getSupabaseProjectName(
  projectId: string,
  organizationSlug?: string,
): Promise<string> {
  if (IS_TEST_BUILD) {
    return "Fake Supabase Project";
  }

  const supabase = await getSupabaseClient({ organizationSlug });
  const projects = await supabase.getProjects();
  const project = projects?.find((p) => p.id === projectId);
  return project?.name || `<project not found for: ${projectId}>`;
}

export async function getSupabaseProjectLogs(
  projectId: string,
  timestampStart?: number,
  organizationSlug?: string,
): Promise<SupabaseProjectLogsResponse> {
  const supabase = await getSupabaseClient({ organizationSlug });

  // Build SQL query with optional timestamp filter
  let sqlQuery = `
SELECT 
  timestamp,
  event_message,
  metadata
FROM function_logs`;

  if (timestampStart) {
    // Convert milliseconds to microseconds and wrap in TIMESTAMP_MICROS for BigQuery
    sqlQuery += `\nWHERE timestamp > TIMESTAMP_MICROS(${timestampStart * 1000})`;
  }

  sqlQuery += `\nORDER BY timestamp ASC
LIMIT 1000`;

  // Calculate time range for API parameters
  const now = new Date();
  const isoTimestampEnd = now.toISOString();
  // Default to last 10 minutes if no start timestamp provided
  const isoTimestampStart = timestampStart
    ? new Date(timestampStart).toISOString()
    : new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  // Encode SQL query for URL
  const encodedSql = encodeURIComponent(sqlQuery);

  const url = `https://api.supabase.com/v1/projects/${projectId}/analytics/endpoints/logs.all?sql=${encodedSql}&iso_timestamp_start=${isoTimestampStart}&iso_timestamp_end=${isoTimestampEnd}`;

  logger.info(`Fetching logs from: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${(supabase as any).options.accessToken}`,
    },
  });

  if (response.status !== 200) {
    const errorText = await response.text();
    logger.error(`Failed to fetch logs (${response.status}): ${errorText}`);
    throw new Error(
      `Failed to fetch logs: ${response.statusText} (${response.status}) - ${errorText}`,
    );
  }

  const jsonResponse: SupabaseProjectLogsResponse = await response.json();
  logger.info(`Received ${jsonResponse.result?.length || 0} logs`);

  return jsonResponse;
}

export async function executeSupabaseSql({
  supabaseProjectId,
  query,
  organizationSlug,
}: {
  supabaseProjectId: string;
  query: string;
  organizationSlug: string | null;
}): Promise<string> {
  if (IS_TEST_BUILD) {
    return "{}";
  }

  const supabase = await getSupabaseClient({ organizationSlug });
  const result = await supabase.runQuery(supabaseProjectId, query);
  return JSON.stringify(result);
}

export async function deleteSupabaseFunction({
  supabaseProjectId,
  functionName,
  organizationSlug,
}: {
  supabaseProjectId: string;
  functionName: string;
  organizationSlug: string | null;
}): Promise<void> {
  logger.info(
    `Deleting Supabase function: ${functionName} from project: ${supabaseProjectId}`,
  );
  const supabase = await getSupabaseClient({ organizationSlug });
  await supabase.deleteFunction(supabaseProjectId, functionName);
  logger.info(
    `Deleted Supabase function: ${functionName} from project: ${supabaseProjectId}`,
  );
}

export async function listSupabaseBranches({
  supabaseProjectId,
  organizationSlug,
}: {
  supabaseProjectId: string;
  organizationSlug: string | null;
}): Promise<SupabaseProjectBranch[]> {
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
  const supabase = await getSupabaseClient({ organizationSlug });

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
  const jsonResponse: SupabaseProjectBranch[] = await response.json();
  return jsonResponse;
}

// ─────────────────────────────────────────────────────────────────────
// Deploy Supabase Functions with shared module support
// ─────────────────────────────────────────────────────────────────────

export async function deploySupabaseFunction({
  supabaseProjectId,
  functionName,
  appPath,
  bundleOnly = false,
  organizationSlug,
}: {
  supabaseProjectId: string;
  functionName: string;
  appPath: string;
  bundleOnly?: boolean;
  organizationSlug: string | null;
}): Promise<DeployedFunctionResponse> {
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
    imports: {},
  };

  // Add the import map file into the upload list
  filesToUpload.push({
    relativePath: importMapRelPath,
    content: Buffer.from(JSON.stringify(importMapObject, null, 2)),
    date: new Date(),
  });

  // 5) Prepare multipart form-data
  const supabase = await getSupabaseClient({ organizationSlug });
  const formData = new FormData();

  // Metadata: instruct Supabase to use our import map
  const metadata = {
    entrypoint_path: entrypointPath,
    name: functionName,
    verify_jwt: false,
    import_map_path: importMapRelPath,
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
  const deployUrl = `https://api.supabase.com/v1/projects/${encodeURIComponent(
    supabaseProjectId,
  )}/functions/deploy?slug=${encodeURIComponent(functionName)}${bundleOnly ? "&bundleOnly=true" : ""}`;

  const response = await fetch(deployUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${(supabase as any).options.accessToken}`,
    },
    body: formData,
  });

  if (response.status !== 201) {
    throw await createResponseError(response, "create function");
  }

  const result: DeployedFunctionResponse = await response.json();

  logger.info(
    `Deployed Supabase function: ${functionName} to project: ${supabaseProjectId}${bundleOnly ? " (bundle only)" : ""}`,
  );

  return result;
}

export async function bulkUpdateFunctions({
  supabaseProjectId,
  functions,
  organizationSlug,
}: {
  supabaseProjectId: string;
  functions: DeployedFunctionResponse[];
  organizationSlug: string | null;
}): Promise<void> {
  logger.info(
    `Bulk updating ${functions.length} functions for project: ${supabaseProjectId}`,
  );

  const supabase = await getSupabaseClient({ organizationSlug });

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(supabaseProjectId)}/functions`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(functions),
    },
  );

  if (response.status !== 200) {
    throw await createResponseError(response, "bulk update functions");
  }

  logger.info(
    `Successfully bulk updated ${functions.length} functions for project: ${supabaseProjectId}`,
  );
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
