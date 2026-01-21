/**
 * Supabase Functions Capability
 *
 * Handles edge function deployment, deletion, listing, and log retrieval.
 */

import log from "electron-log";
import fs from "node:fs";
import path from "node:path";
import { IS_TEST_BUILD } from "../../../ipc/utils/test_utils";
import {
  fetchWithRetry,
  retryWithRateLimit,
  RateLimitError,
} from "../../../ipc/utils/retryWithRateLimit";
import { getSupabaseClientForOrganization } from "./oauth";
import type {
  FunctionsCapability,
  DeployFunctionParams,
  DeployedFunction,
  DeleteFunctionParams,
  ListFunctionsParams,
  GetLogsParams,
  FunctionLog,
} from "../../types";
import {
  listFilesWithStats,
  buildSignature,
  toPosixPath,
  type FileStatEntry,
} from "../../../supabase_admin/supabase_management_client";

const logger = log.scope("supabase_plugin_functions");
const fsPromises = fs.promises;

const SUPABASE_API_BASE_URL = "https://api.supabase.com/v1";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

interface ZipFileEntry {
  relativePath: string;
  content: Buffer;
  date: Date;
}

interface CachedSharedFiles {
  signature: string;
  files: ZipFileEntry[];
}

// Cache for shared files
const sharedFilesCache = new Map<string, CachedSharedFiles>();

// ─────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────

async function getClient(organizationSlug?: string | null) {
  if (!organizationSlug) {
    throw new Error("Organization slug is required for Supabase operations");
  }
  return getSupabaseClientForOrganization(organizationSlug);
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

async function collectFunctionFiles({
  functionPath,
  functionName,
}: {
  functionPath: string;
  functionName: string;
}) {
  const normalizedFunctionPath = path.resolve(functionPath);
  const stats = await fsPromises.stat(normalizedFunctionPath);

  if (!stats.isDirectory()) {
    throw new Error(
      `Unable to locate directory for Supabase function ${functionName}`,
    );
  }

  const indexPath = path.join(normalizedFunctionPath, "index.ts");

  try {
    await fsPromises.access(indexPath);
  } catch {
    throw new Error(
      `Supabase function ${functionName} is missing an index.ts entrypoint`,
    );
  }

  const statEntries = await listFilesWithStats(normalizedFunctionPath, functionName);
  const signature = buildSignature(statEntries);
  const files = await loadZipEntries(statEntries);

  return {
    files,
    signature,
    entrypointPath: path.posix.join(
      functionName,
      toPosixPath(path.relative(normalizedFunctionPath, indexPath)),
    ),
    cacheKey: normalizedFunctionPath,
  };
}

async function getSharedFiles(appPath: string): Promise<CachedSharedFiles> {
  const sharedDirectory = path.join(appPath, "supabase", "functions", "_shared");

  try {
    const sharedStats = await fsPromises.stat(sharedDirectory);
    if (!sharedStats.isDirectory()) {
      return { signature: "", files: [] };
    }
  } catch (error: any) {
    if (error?.code === "ENOENT") {
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

function guessMimeType(filePath: string): string {
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".ts")) return "application/typescript";
  if (filePath.endsWith(".mjs")) return "application/javascript";
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  if (filePath.endsWith(".map")) return "application/json";
  return "application/octet-stream";
}

function extractFunctionName(eventMessage: string): string | undefined {
  // Extract function name from log messages like "[function-name] message"
  const match = eventMessage.match(/^\[([^\]]+)\]/);
  return match?.[1];
}

// ─────────────────────────────────────────────────────────────────────
// Functions Capability Implementation
// ─────────────────────────────────────────────────────────────────────

export function createFunctionsCapability(): FunctionsCapability {
  return {
    deployFunction: async (params: DeployFunctionParams): Promise<DeployedFunction> => {
      const { projectId, functionName, appPath, accountId, bundleOnly } = params;

      logger.info(
        `Deploying Supabase function: ${functionName} to project: ${projectId}`,
      );

      const functionPath = path.join(appPath, "supabase", "functions", functionName);

      // Collect function files
      const functionFiles = await collectFunctionFiles({
        functionPath,
        functionName,
      });

      // Collect shared files
      const sharedFiles = await getSharedFiles(appPath);

      // Combine all files
      const filesToUpload = [...functionFiles.files, ...sharedFiles.files];

      // Create import map
      const entrypointPath = functionFiles.entrypointPath;
      const entryDir = path.posix.dirname(entrypointPath);
      const importMapRelPath = path.posix.join(entryDir, "import_map.json");

      filesToUpload.push({
        relativePath: importMapRelPath,
        content: Buffer.from(JSON.stringify({ imports: {} }, null, 2)),
        date: new Date(),
      });

      // Prepare multipart form-data
      const supabase = await getClient(accountId);

      function buildFormData() {
        const formData = new FormData();
        const metadata = {
          entrypoint_path: entrypointPath,
          name: functionName,
          verify_jwt: false,
          import_map_path: importMapRelPath,
        };

        formData.append("metadata", JSON.stringify(metadata));

        for (const f of filesToUpload) {
          const mime = guessMimeType(f.relativePath);
          const blob = new Blob([new Uint8Array(f.content)], { type: mime });
          formData.append("file", blob, f.relativePath);
        }

        return formData;
      }

      // Deploy
      const deployUrl = `${SUPABASE_API_BASE_URL}/projects/${encodeURIComponent(
        projectId,
      )}/functions/deploy?slug=${encodeURIComponent(functionName)}${bundleOnly ? "&bundleOnly=true" : ""}`;

      const response = await retryWithRateLimit(async () => {
        const res = await fetch(deployUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${(supabase as any).options.accessToken}`,
          },
          body: buildFormData(),
        });
        if (res.status === 429) {
          throw new RateLimitError(`Rate limited (429): ${res.statusText}`, res);
        }
        return res;
      }, `Deploy Supabase function ${functionName}`);

      if (response.status !== 201) {
        const errorBody = await response.text();
        throw new Error(
          `Failed to deploy function: ${response.statusText} (${response.status}): ${errorBody}`,
        );
      }

      const result = await response.json();

      logger.info(
        `Deployed Supabase function: ${functionName} to project: ${projectId}${bundleOnly ? " (bundle only)" : ""}`,
      );

      return {
        id: result.id,
        name: result.name,
        slug: result.slug,
        status: result.status,
        version: result.version,
      };
    },

    deleteFunction: async (params: DeleteFunctionParams): Promise<void> => {
      const { projectId, functionName, accountId } = params;

      logger.info(
        `Deleting Supabase function: ${functionName} from project: ${projectId}`,
      );

      const supabase = await getClient(accountId);
      await retryWithRateLimit(
        () => supabase.deleteFunction(projectId, functionName),
        `Delete function ${functionName}`,
      );

      logger.info(
        `Deleted Supabase function: ${functionName} from project: ${projectId}`,
      );
    },

    listFunctions: async (
      params: ListFunctionsParams,
    ): Promise<DeployedFunction[]> => {
      const { projectId, accountId } = params;

      const supabase = await getClient(accountId);
      const functions = await retryWithRateLimit(
        () => supabase.getFunctions(projectId),
        `List functions for ${projectId}`,
      );

      return (functions || []).map((fn: any) => ({
        id: fn.id,
        name: fn.name,
        slug: fn.slug,
        status: fn.status,
        version: fn.version,
      }));
    },

    getLogs: async (params: GetLogsParams): Promise<FunctionLog[]> => {
      const { projectId, timestampStart, accountId } = params;

      const supabase = await getClient(accountId);

      // Build SQL query with optional timestamp filter
      let sqlQuery = `
SELECT
  timestamp,
  event_message,
  metadata
FROM function_logs`;

      if (timestampStart) {
        sqlQuery += `\nWHERE timestamp > TIMESTAMP_MICROS(${timestampStart * 1000})`;
      }

      sqlQuery += `\nORDER BY timestamp ASC\nLIMIT 1000`;

      const now = new Date();
      const isoTimestampEnd = now.toISOString();
      const isoTimestampStart = timestampStart
        ? new Date(timestampStart).toISOString()
        : new Date(now.getTime() - 10 * 60 * 1000).toISOString();

      const encodedSql = encodeURIComponent(sqlQuery);
      const url = `${SUPABASE_API_BASE_URL}/projects/${projectId}/analytics/endpoints/logs.all?sql=${encodedSql}&iso_timestamp_start=${isoTimestampStart}&iso_timestamp_end=${isoTimestampEnd}`;

      logger.info(`Fetching logs from: ${url}`);

      const response = await fetchWithRetry(
        url,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${(supabase as any).options.accessToken}`,
          },
        },
        `Get Supabase project logs for ${projectId}`,
      );

      if (response.status !== 200) {
        const errorText = await response.text();
        logger.error(`Failed to fetch logs (${response.status}): ${errorText}`);
        throw new Error(
          `Failed to fetch logs: ${response.statusText} (${response.status}) - ${errorText}`,
        );
      }

      const jsonResponse = await response.json();
      const rawLogs = jsonResponse.result || [];

      logger.info(`Received ${rawLogs.length} logs`);

      return rawLogs.map((log: any) => {
        const metadata = log.metadata?.[0] || {};
        const level = metadata.level || "info";
        const eventMessage = log.event_message || "";
        const functionName = extractFunctionName(eventMessage);

        return {
          timestamp: log.timestamp / 1000, // Convert from microseconds to milliseconds
          message: eventMessage,
          level: level === "error" ? "error" : level === "warn" ? "warn" : "info",
          functionName,
        };
      });
    },
  };
}
