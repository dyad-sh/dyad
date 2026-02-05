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
import {
  fetchWithRetry,
  RateLimitError,
  retryWithRateLimit,
} from "../ipc/utils/retryWithRateLimit";

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
  const response = await fetchWithRetry(
    "https://api.supabase.com/v1/organizations",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    "List Supabase organizations",
  );

  if (response.status !== 200) {
    const errorText = await response.text();
    logger.error(
      `Failed to fetch organizations (${response.status}): ${errorText}`,
    );
    throw new SupabaseManagementAPIError(
      `Failed to fetch organizations: ${response.statusText}`,
      response,
    );
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

  const response = await fetchWithRetry(
    `https://api.supabase.com/v1/organizations/${organizationSlug}/members`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    `Get organization members for ${organizationSlug}`,
  );

  if (response.status !== 200) {
    const errorText = await response.text();
    logger.error(
      `Failed to fetch organization members (${response.status}): ${errorText}`,
    );
    throw new SupabaseManagementAPIError(
      `Failed to fetch organization members: ${response.statusText}`,
      response,
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

  const response = await fetchWithRetry(
    `https://api.supabase.com/v1/organizations/${organizationSlug}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    `Get organization details for ${organizationSlug}`,
  );

  if (response.status !== 200) {
    const errorText = await response.text();
    logger.error(
      `Failed to fetch organization details (${response.status}): ${errorText}`,
    );
    throw new SupabaseManagementAPIError(
      `Failed to fetch organization details: ${response.statusText}`,
      response,
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
  const projects = await retryWithRateLimit(
    () => supabase.getProjects(),
    `Get Supabase projects for ${projectId}`,
  );
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
    throw new SupabaseManagementAPIError(
      `Failed to fetch logs: ${response.statusText} (${response.status}) - ${errorText}`,
      response,
    );
  }

  const jsonResponse: SupabaseProjectLogsResponse = await response.json();
  logger.info(`Received ${jsonResponse.result?.length || 0} logs`);

  return jsonResponse;
}

/**
 * Returns fake SQL results for test builds based on the query type.
 * This allows e2e tests to verify database viewer functionality without a real database.
 */
function getFakeTestSqlResult(query: string): string {
  const normalizedQuery = query.toLowerCase().trim();

  // Storage buckets query (must be checked before generic patterns)
  if (normalizedQuery.includes("storage.buckets")) {
    return JSON.stringify([
      {
        id: "avatars",
        name: "avatars",
        public: true,
        created_at: "2024-01-15T10:00:00Z",
        file_size_limit: 5242880,
        allowed_mime_types: ["image/png", "image/jpeg"],
      },
      {
        id: "documents",
        name: "documents",
        public: false,
        created_at: "2024-01-16T10:00:00Z",
        file_size_limit: null,
        allowed_mime_types: null,
      },
    ]);
  }

  // Storage objects query (must be checked before generic patterns)
  if (normalizedQuery.includes("storage.objects")) {
    if (normalizedQuery.includes("count(*)")) {
      return JSON.stringify([{ count: 3 }]);
    }
    return JSON.stringify([
      {
        id: "obj-1",
        name: "profile.png",
        bucket_id: "avatars",
        created_at: "2024-01-15T11:00:00Z",
        updated_at: "2024-01-15T11:00:00Z",
        metadata: { mimetype: "image/png", size: 12345 },
      },
      {
        id: "obj-2",
        name: "avatar.jpg",
        bucket_id: "avatars",
        created_at: "2024-01-16T11:00:00Z",
        updated_at: "2024-01-16T11:00:00Z",
        metadata: { mimetype: "image/jpeg", size: 23456 },
      },
      {
        id: "obj-3",
        name: "report.pdf",
        bucket_id: "documents",
        created_at: "2024-01-17T11:00:00Z",
        updated_at: "2024-01-17T11:00:00Z",
        metadata: { mimetype: "application/pdf", size: 102400 },
      },
    ]);
  }

  // List tables query
  if (
    normalizedQuery.includes("information_schema.tables") &&
    normalizedQuery.includes("table_name")
  ) {
    return JSON.stringify([
      { table_name: "users" },
      { table_name: "posts" },
      { table_name: "comments" },
    ]);
  }

  // Get table schema query
  if (
    normalizedQuery.includes("information_schema.columns") &&
    normalizedQuery.includes("column_name")
  ) {
    // Determine which table's schema is being requested
    if (normalizedQuery.includes("users")) {
      return JSON.stringify([
        {
          name: "id",
          type: "uuid",
          nullable: false,
          defaultValue: "gen_random_uuid()",
        },
        { name: "email", type: "text", nullable: false, defaultValue: null },
        { name: "name", type: "text", nullable: true, defaultValue: null },
        {
          name: "created_at",
          type: "timestamp with time zone",
          nullable: false,
          defaultValue: "now()",
        },
      ]);
    }
    if (normalizedQuery.includes("posts")) {
      return JSON.stringify([
        {
          name: "id",
          type: "uuid",
          nullable: false,
          defaultValue: "gen_random_uuid()",
        },
        { name: "title", type: "text", nullable: false, defaultValue: null },
        { name: "content", type: "text", nullable: true, defaultValue: null },
        {
          name: "author_id",
          type: "uuid",
          nullable: false,
          defaultValue: null,
        },
        {
          name: "created_at",
          type: "timestamp with time zone",
          nullable: false,
          defaultValue: "now()",
        },
      ]);
    }
    if (normalizedQuery.includes("comments")) {
      return JSON.stringify([
        {
          name: "id",
          type: "uuid",
          nullable: false,
          defaultValue: "gen_random_uuid()",
        },
        { name: "post_id", type: "uuid", nullable: false, defaultValue: null },
        {
          name: "author_id",
          type: "uuid",
          nullable: false,
          defaultValue: null,
        },
        { name: "content", type: "text", nullable: false, defaultValue: null },
        {
          name: "created_at",
          type: "timestamp with time zone",
          nullable: false,
          defaultValue: "now()",
        },
      ]);
    }
    // Default schema
    return JSON.stringify([
      {
        name: "id",
        type: "uuid",
        nullable: false,
        defaultValue: "gen_random_uuid()",
      },
    ]);
  }

  // Count query for pagination
  if (normalizedQuery.includes("count(*)")) {
    if (normalizedQuery.includes("users")) {
      return JSON.stringify([{ count: 3 }]);
    }
    if (normalizedQuery.includes("posts")) {
      return JSON.stringify([{ count: 2 }]);
    }
    if (normalizedQuery.includes("comments")) {
      return JSON.stringify([{ count: 4 }]);
    }
    return JSON.stringify([{ count: 0 }]);
  }

  // Select rows query
  if (normalizedQuery.startsWith("select * from")) {
    // Parse LIMIT and OFFSET from query
    const limitMatch = normalizedQuery.match(/limit\s+(\d+)/);
    const offsetMatch = normalizedQuery.match(/offset\s+(\d+)/);
    const limit = limitMatch ? parseInt(limitMatch[1], 10) : Infinity;
    const offset = offsetMatch ? parseInt(offsetMatch[1], 10) : 0;

    let allRows: unknown[] = [];
    if (normalizedQuery.includes("users")) {
      allRows = [
        {
          id: "550e8400-e29b-41d4-a716-446655440001",
          email: "alice@example.com",
          name: "Alice Johnson",
          created_at: "2024-01-15T10:30:00Z",
        },
        {
          id: "550e8400-e29b-41d4-a716-446655440002",
          email: "bob@example.com",
          name: "Bob Smith",
          created_at: "2024-01-16T14:20:00Z",
        },
        {
          id: "550e8400-e29b-41d4-a716-446655440003",
          email: "charlie@example.com",
          name: null,
          created_at: "2024-01-17T09:00:00Z",
        },
      ];
    } else if (normalizedQuery.includes("posts")) {
      allRows = [
        {
          id: "660e8400-e29b-41d4-a716-446655440001",
          title: "Hello World",
          content: "This is my first post!",
          author_id: "550e8400-e29b-41d4-a716-446655440001",
          created_at: "2024-01-15T11:00:00Z",
        },
        {
          id: "660e8400-e29b-41d4-a716-446655440002",
          title: "Learning Supabase",
          content: "Supabase is great for building apps.",
          author_id: "550e8400-e29b-41d4-a716-446655440002",
          created_at: "2024-01-16T15:00:00Z",
        },
      ];
    } else if (normalizedQuery.includes("comments")) {
      allRows = [
        {
          id: "770e8400-e29b-41d4-a716-446655440001",
          post_id: "660e8400-e29b-41d4-a716-446655440001",
          author_id: "550e8400-e29b-41d4-a716-446655440002",
          content: "Great post!",
          created_at: "2024-01-15T12:00:00Z",
        },
        {
          id: "770e8400-e29b-41d4-a716-446655440002",
          post_id: "660e8400-e29b-41d4-a716-446655440001",
          author_id: "550e8400-e29b-41d4-a716-446655440003",
          content: "Thanks for sharing!",
          created_at: "2024-01-15T13:00:00Z",
        },
        {
          id: "770e8400-e29b-41d4-a716-446655440003",
          post_id: "660e8400-e29b-41d4-a716-446655440002",
          author_id: "550e8400-e29b-41d4-a716-446655440001",
          content: "I love Supabase too!",
          created_at: "2024-01-16T16:00:00Z",
        },
        {
          id: "770e8400-e29b-41d4-a716-446655440004",
          post_id: "660e8400-e29b-41d4-a716-446655440002",
          author_id: "550e8400-e29b-41d4-a716-446655440003",
          content: "Very helpful.",
          created_at: "2024-01-16T17:00:00Z",
        },
      ];
    }
    // Apply OFFSET and LIMIT
    return JSON.stringify(allRows.slice(offset, offset + limit));
  }

  // Default: empty result
  return JSON.stringify([]);
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
    return getFakeTestSqlResult(query);
  }

  const supabase = await getSupabaseClient({ organizationSlug });
  const result = await retryWithRateLimit(
    () => supabase.runQuery(supabaseProjectId, query),
    `Execute SQL on ${supabaseProjectId}`,
  );
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
  await retryWithRateLimit(
    () => supabase.deleteFunction(supabaseProjectId, functionName),
    `Delete function ${functionName}`,
  );
  logger.info(
    `Deleted Supabase function: ${functionName} from project: ${supabaseProjectId}`,
  );
}

export async function listSupabaseFunctions({
  supabaseProjectId,
  organizationSlug,
}: {
  supabaseProjectId: string;
  organizationSlug: string | null;
}): Promise<DeployedFunctionResponse[]> {
  if (IS_TEST_BUILD) {
    return [];
  }

  logger.info(`Listing Supabase functions for project: ${supabaseProjectId}`);
  const supabase = await getSupabaseClient({ organizationSlug });

  const response = await fetchWithRetry(
    `https://api.supabase.com/v1/projects/${supabaseProjectId}/functions`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
      },
    },
    `List Supabase functions for ${supabaseProjectId}`,
  );

  if (response.status !== 200) {
    throw await createResponseError(response, "list functions");
  }

  const functions: DeployedFunctionResponse[] = await response.json();
  logger.info(
    `Found ${functions.length} functions for project: ${supabaseProjectId}`,
  );
  return functions;
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

  const response = await fetchWithRetry(
    `https://api.supabase.com/v1/projects/${supabaseProjectId}/branches`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
      },
    },
    `List Supabase branches for ${supabaseProjectId}`,
  );

  // 403 means the user's plan doesn't support branching - return empty array
  if (response.status === 403) {
    logger.info(
      `Branching not available for project ${supabaseProjectId} (requires Pro plan)`,
    );
    return [];
  }

  if (response.status !== 200) {
    throw await createResponseError(response, "list branches");
  }

  logger.info(`Listed Supabase branches for project: ${supabaseProjectId}`);
  const jsonResponse: SupabaseProjectBranch[] = await response.json();
  return jsonResponse;
}

// ─────────────────────────────────────────────────────────────────────
// Auth Users Management
// ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

export interface ListAuthUsersResponse {
  users: AuthUser[];
  total: number;
}

export async function listAuthUsers({
  supabaseProjectId,
  organizationSlug,
  page = 1,
  perPage = 25,
}: {
  supabaseProjectId: string;
  organizationSlug: string | null;
  page?: number;
  perPage?: number;
}): Promise<ListAuthUsersResponse> {
  if (IS_TEST_BUILD) {
    // Return fake test users
    return {
      users: [
        {
          id: "550e8400-e29b-41d4-a716-446655440001",
          email: "alice@example.com",
          phone: null,
          created_at: "2024-01-15T10:30:00Z",
          last_sign_in_at: "2024-01-20T08:00:00Z",
          app_metadata: { provider: "email" },
        },
        {
          id: "550e8400-e29b-41d4-a716-446655440002",
          email: "bob@example.com",
          phone: null,
          created_at: "2024-01-16T14:20:00Z",
          last_sign_in_at: null,
          app_metadata: { provider: "google" },
        },
      ],
      total: 2,
    };
  }

  logger.info(`Listing auth users for project: ${supabaseProjectId}`);

  // Query auth.users table directly via SQL
  const offset = (page - 1) * perPage;

  // Get total count
  const countQuery = `SELECT COUNT(*) as count FROM auth.users;`;
  const countResult = await executeSupabaseSql({
    supabaseProjectId,
    query: countQuery,
    organizationSlug,
  });

  let total = 0;
  try {
    const countParsed = JSON.parse(countResult);
    total = Number(countParsed?.[0]?.count ?? 0);
  } catch {
    logger.warn("Failed to parse auth users count");
  }

  // Get users with pagination
  const usersQuery = `
    SELECT
      id,
      email,
      phone,
      created_at,
      last_sign_in_at,
      raw_app_meta_data as app_metadata,
      raw_user_meta_data as user_metadata
    FROM auth.users
    ORDER BY created_at DESC
    LIMIT ${perPage} OFFSET ${offset};
  `;

  const usersResult = await executeSupabaseSql({
    supabaseProjectId,
    query: usersQuery,
    organizationSlug,
  });

  let users: AuthUser[] = [];
  try {
    const usersParsed = JSON.parse(usersResult);
    users = (usersParsed ?? []).map((u: Record<string, unknown>) => ({
      id: String(u.id ?? ""),
      email: u.email ? String(u.email) : null,
      phone: u.phone ? String(u.phone) : null,
      created_at: String(u.created_at ?? ""),
      last_sign_in_at: u.last_sign_in_at ? String(u.last_sign_in_at) : null,
      app_metadata: u.app_metadata as Record<string, unknown> | undefined,
      user_metadata: u.user_metadata as Record<string, unknown> | undefined,
    }));
  } catch {
    logger.warn("Failed to parse auth users");
  }

  return { users, total };
}

// ─────────────────────────────────────────────────────────────────────
// Secrets Management
// ─────────────────────────────────────────────────────────────────────

export interface Secret {
  name: string;
}

export async function listSecrets({
  supabaseProjectId,
  organizationSlug,
}: {
  supabaseProjectId: string;
  organizationSlug: string | null;
}): Promise<Secret[]> {
  if (IS_TEST_BUILD) {
    return [
      { name: "DATABASE_URL" },
      { name: "API_KEY" },
      { name: "JWT_SECRET" },
    ];
  }

  logger.info(`Listing secrets for project: ${supabaseProjectId}`);
  const supabase = await getSupabaseClient({ organizationSlug });

  const response = await fetchWithRetry(
    `https://api.supabase.com/v1/projects/${supabaseProjectId}/secrets`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
      },
    },
    `List secrets for ${supabaseProjectId}`,
  );

  if (response.status !== 200) {
    throw await createResponseError(response, "list secrets");
  }

  const data = await response.json();
  // The API returns an array of objects with name property
  return data.map((s: { name: string }) => ({ name: s.name }));
}

export async function createSecret({
  supabaseProjectId,
  organizationSlug,
  name,
  value,
}: {
  supabaseProjectId: string;
  organizationSlug: string | null;
  name: string;
  value: string;
}): Promise<void> {
  if (IS_TEST_BUILD) {
    logger.info(
      `[TEST] Created secret ${name} for project ${supabaseProjectId}`,
    );
    return;
  }

  logger.info(`Creating secret ${name} for project: ${supabaseProjectId}`);
  const supabase = await getSupabaseClient({ organizationSlug });

  const response = await fetchWithRetry(
    `https://api.supabase.com/v1/projects/${supabaseProjectId}/secrets`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ name, value }]),
    },
    `Create secret ${name} for ${supabaseProjectId}`,
  );

  if (response.status !== 201 && response.status !== 200) {
    throw await createResponseError(response, "create secret");
  }

  logger.info(`Created secret ${name} for project: ${supabaseProjectId}`);
}

export async function deleteSecrets({
  supabaseProjectId,
  organizationSlug,
  names,
}: {
  supabaseProjectId: string;
  organizationSlug: string | null;
  names: string[];
}): Promise<void> {
  if (IS_TEST_BUILD) {
    logger.info(
      `[TEST] Deleted secrets ${names.join(", ")} from project ${supabaseProjectId}`,
    );
    return;
  }

  logger.info(
    `Deleting secrets ${names.join(", ")} from project: ${supabaseProjectId}`,
  );
  const supabase = await getSupabaseClient({ organizationSlug });

  const response = await fetchWithRetry(
    `https://api.supabase.com/v1/projects/${supabaseProjectId}/secrets`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(names),
    },
    `Delete secrets from ${supabaseProjectId}`,
  );

  if (response.status !== 200 && response.status !== 204) {
    throw await createResponseError(response, "delete secrets");
  }

  logger.info(
    `Deleted secrets ${names.join(", ")} from project: ${supabaseProjectId}`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Edge Logs (simplified for LogsSection)
// ─────────────────────────────────────────────────────────────────────

export interface EdgeLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  functionName?: string;
}

export async function listEdgeLogs({
  supabaseProjectId,
  organizationSlug,
  timestampStart,
}: {
  supabaseProjectId: string;
  organizationSlug: string | null;
  timestampStart?: number;
}): Promise<EdgeLogEntry[]> {
  if (IS_TEST_BUILD) {
    // Return fake test logs
    return [
      {
        timestamp: new Date().toISOString(),
        level: "info",
        message: "Function invoked successfully",
        functionName: "hello-world",
      },
      {
        timestamp: new Date(Date.now() - 60000).toISOString(),
        level: "warn",
        message: "Slow response time detected",
        functionName: "api-handler",
      },
      {
        timestamp: new Date(Date.now() - 120000).toISOString(),
        level: "error",
        message: "Failed to connect to external API",
        functionName: "data-sync",
      },
    ];
  }

  // Use the existing getSupabaseProjectLogs function and transform the result
  const logsResponse = await getSupabaseProjectLogs(
    supabaseProjectId,
    timestampStart,
    organizationSlug ?? undefined,
  );

  // Transform the logs into EdgeLogEntry format
  const entries: EdgeLogEntry[] = [];
  for (const log of logsResponse.result ?? []) {
    const metadata = log.metadata?.[0];
    const message =
      (metadata?.request?.url ?? metadata?.response?.status_code)
        ? `${metadata?.request?.method ?? "GET"} ${metadata?.request?.url ?? ""} - ${metadata?.response?.status_code ?? ""}`
        : (log.event_message ?? "");

    entries.push({
      timestamp: log.timestamp
        ? String(log.timestamp)
        : new Date().toISOString(),
      level: "info",
      message,
      functionName: metadata?.function_id,
    });
  }

  return entries;
}

// ─────────────────────────────────────────────────────────────────────
// Auth Config
// ─────────────────────────────────────────────────────────────────────

export interface AuthConfigResponse {
  site_url?: string;
  uri_allow_list?: string;
  jwt_exp?: number;
  disable_signup?: boolean;
  mailer_autoconfirm?: boolean;
  phone_autoconfirm?: boolean;
  sms_provider?: string;
  [key: string]: unknown;
}

export async function getAuthConfig({
  supabaseProjectId,
  organizationSlug,
}: {
  supabaseProjectId: string;
  organizationSlug: string | null;
}): Promise<AuthConfigResponse> {
  if (IS_TEST_BUILD) {
    return {
      site_url: "http://localhost:3000",
      uri_allow_list: "",
      jwt_exp: 3600,
      disable_signup: false,
      mailer_autoconfirm: false,
      external_email_enabled: true,
      external_google_enabled: true,
      external_github_enabled: false,
      external_apple_enabled: false,
      external_azure_enabled: false,
      external_discord_enabled: false,
      external_facebook_enabled: false,
      external_twitter_enabled: false,
    };
  }

  const supabase = await getSupabaseClient({ organizationSlug });
  const response = await fetchWithRetry(
    `https://api.supabase.com/v1/projects/${supabaseProjectId}/config/auth`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
      },
    },
    `Get auth config for ${supabaseProjectId}`,
  );

  if (response.status !== 200) {
    throw await createResponseError(response, "get auth config");
  }

  return await response.json();
}

// ─────────────────────────────────────────────────────────────────────
// Project Logs (multi-source)
// ─────────────────────────────────────────────────────────────────────

export interface GenericLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  source: "edge" | "postgres" | "auth" | "postgrest";
}

function getFakeLogsForSource(
  source: "edge" | "postgres" | "auth" | "postgrest",
): GenericLogEntry[] {
  const now = Date.now();
  return [
    {
      timestamp: new Date(now).toISOString(),
      level: "info",
      message: `[${source}] Operation completed successfully`,
      source,
    },
    {
      timestamp: new Date(now - 30000).toISOString(),
      level: "warn",
      message: `[${source}] Slow query detected`,
      source,
    },
    {
      timestamp: new Date(now - 60000).toISOString(),
      level: "error",
      message: `[${source}] Connection timeout`,
      source,
    },
  ];
}

function extractLogLevel(
  log: { event_message?: string; metadata?: Array<{ level?: string }> },
  source: string,
): "info" | "warn" | "error" | "debug" {
  if (source === "postgres") {
    const msg = log.event_message ?? "";
    if (msg.includes("ERROR")) return "error";
    if (msg.includes("WARNING")) return "warn";
    return "info";
  }
  const metadata = log.metadata?.[0];
  const level = metadata?.level ?? "info";
  if (level === "error") return "error";
  if (level === "warn" || level === "warning") return "warn";
  return "info";
}

export async function getProjectLogs({
  supabaseProjectId,
  organizationSlug,
  source,
  timestampStart,
}: {
  supabaseProjectId: string;
  organizationSlug: string | null;
  source: "edge" | "postgres" | "auth" | "postgrest";
  timestampStart?: number;
}): Promise<GenericLogEntry[]> {
  if (IS_TEST_BUILD) {
    return getFakeLogsForSource(source);
  }

  const tableMap: Record<string, string> = {
    edge: "function_logs",
    postgres: "postgres_logs",
    auth: "auth_logs",
    postgrest: "postgrest_logs",
  };
  const tableName = tableMap[source] || "function_logs";

  const supabase = await getSupabaseClient({ organizationSlug });

  let sqlQuery = `SELECT timestamp, event_message, metadata FROM ${tableName}`;
  if (timestampStart) {
    sqlQuery += `\nWHERE timestamp > TIMESTAMP_MICROS(${timestampStart * 1000})`;
  }
  sqlQuery += `\nORDER BY timestamp DESC\nLIMIT 200`;

  const now = new Date();
  const isoTimestampEnd = now.toISOString();
  const isoTimestampStart = timestampStart
    ? new Date(timestampStart).toISOString()
    : new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  const url = `https://api.supabase.com/v1/projects/${supabaseProjectId}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sqlQuery)}&iso_timestamp_start=${isoTimestampStart}&iso_timestamp_end=${isoTimestampEnd}`;

  const response = await fetchWithRetry(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
      },
    },
    `Get ${source} logs for ${supabaseProjectId}`,
  );

  if (response.status !== 200) {
    throw await createResponseError(response, `get ${source} logs`);
  }

  const jsonResponse = await response.json();
  return (
    (jsonResponse as { result?: Array<Record<string, unknown>> }).result ?? []
  ).map(
    (
      log: Record<string, unknown> & {
        timestamp?: number;
        event_message?: string;
        metadata?: Array<{ level?: string }>;
      },
    ) => ({
      timestamp: log.timestamp
        ? new Date(Number(log.timestamp) / 1000).toISOString()
        : new Date().toISOString(),
      level: extractLogLevel(log, source),
      message: (log.event_message ?? "") as string,
      source,
    }),
  );
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
      const buf: Buffer = f.content;
      const mime = guessMimeType(f.relativePath);
      const blob = new Blob([new Uint8Array(buf)], { type: mime });
      formData.append("file", blob, f.relativePath);
    }

    return formData;
  }

  // 6) Perform the deploy request
  const deployUrl = `https://api.supabase.com/v1/projects/${encodeURIComponent(
    supabaseProjectId,
  )}/functions/deploy?slug=${encodeURIComponent(functionName)}${bundleOnly ? "&bundleOnly=true" : ""}`;

  const response = await retryWithRateLimit(async () => {
    const res = await fetch(deployUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
      },
      // Safer to rebuild form data each time.
      body: buildFormData(),
    });
    if (res.status === 429) {
      throw new RateLimitError(`Rate limited (429): ${res.statusText}`, res);
    }
    return res;
  }, `Deploy Supabase function ${functionName}`);

  if (response.status !== 201) {
    throw await createResponseError(response, "create function");
  }

  const result = (await response.json()) as DeployedFunctionResponse;

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

  const response = await fetchWithRetry(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(supabaseProjectId)}/functions`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(functions),
    },
    `Bulk update functions for ${supabaseProjectId}`,
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
