import log from "electron-log";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { apps } from "../../db/schema";
import {
  getSupabaseClientForOrganization,
  listSupabaseBranches,
  getSupabaseProjectLogs,
  getOrganizationDetails,
  getOrganizationMembers,
  executeSupabaseSql,
  listAuthUsers,
  listSecrets,
  createSecret,
  deleteSecrets,
  listEdgeLogs,
  type SupabaseProjectLog,
} from "../../supabase_admin/supabase_management_client";
import { extractFunctionName } from "../../supabase_admin/supabase_utils";
import { createTypedHandler } from "./base";
import { createTestOnlyLoggedHandler } from "./safe_handle";
import { safeSend } from "../utils/safe_sender";
import { readSettings, writeSettings } from "../../main/settings";
import { supabaseContracts } from "../types/supabase";
import { isValidTableName, safeJsonParse } from "../../lib/supabase_utils";

const logger = log.scope("supabase_handlers");
const testOnlyHandle = createTestOnlyLoggedHandler(logger);

export function registerSupabaseHandlers() {
  // List all connected Supabase organizations with details
  createTypedHandler(supabaseContracts.listOrganizations, async () => {
    const settings = readSettings();
    const organizations = settings.supabase?.organizations ?? {};

    const results: Array<{
      organizationSlug: string;
      name?: string;
      ownerEmail?: string;
    }> = [];

    for (const organizationSlug of Object.keys(organizations)) {
      try {
        // Fetch organization details and members in parallel
        const [details, members] = await Promise.all([
          getOrganizationDetails(organizationSlug),
          getOrganizationMembers(organizationSlug),
        ]);

        // Find the owner from members
        const owner = members.find((m) => m.role === "Owner");

        results.push({
          organizationSlug,
          name: details.name,
          ownerEmail: owner?.email,
        });
      } catch (error) {
        // If we can't fetch details, still include the org with just the ID
        logger.error(
          `Failed to fetch details for organization ${organizationSlug}:`,
          error,
        );
        results.push({ organizationSlug });
      }
    }

    return results;
  });

  // Delete a Supabase organization connection
  createTypedHandler(
    supabaseContracts.deleteOrganization,
    async (_, params) => {
      const { organizationSlug } = params;
      const settings = readSettings();
      const organizations = { ...settings.supabase?.organizations };

      if (!organizations[organizationSlug]) {
        throw new Error(`Supabase organization ${organizationSlug} not found`);
      }

      delete organizations[organizationSlug];

      writeSettings({
        supabase: {
          ...settings.supabase,
          organizations,
        },
      });

      logger.info(`Deleted Supabase organization ${organizationSlug}`);
    },
  );

  // List all projects from all connected organizations
  createTypedHandler(supabaseContracts.listAllProjects, async () => {
    const settings = readSettings();
    const organizations = settings.supabase?.organizations ?? {};
    const allProjects: Array<{
      id: string;
      name: string;
      region: string;
      organizationSlug: string;
    }> = [];

    for (const organizationSlug of Object.keys(organizations)) {
      try {
        const client = await getSupabaseClientForOrganization(organizationSlug);
        const projects = await client.getProjects();

        if (projects) {
          for (const project of projects) {
            allProjects.push({
              id: project.id,
              name: project.name,
              region: project.region,
              organizationSlug:
                // The supabase management API typedef is out of date and there's
                // actually an organization_slug field.
                // Just in case it's not there, we fallback to organization_id
                // which in practice is the same value as the slug.
                (project as any).organization_slug || project.organization_id,
            });
          }
        }
      } catch (error) {
        logger.error(
          `Failed to fetch projects for organization ${organizationSlug}:`,
          error,
        );
        // Continue with other organizations even if one fails
      }
    }

    return allProjects;
  });

  // List branches for a Supabase project (database branches)
  createTypedHandler(supabaseContracts.listBranches, async (_, params) => {
    const { projectId, organizationSlug } = params;
    const branches = await listSupabaseBranches({
      supabaseProjectId: projectId,
      organizationSlug: organizationSlug ?? null,
    });
    return branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      isDefault: branch.is_default,
      projectRef: branch.project_ref,
      parentProjectRef: branch.parent_project_ref,
    }));
  });

  // Get edge function logs for a Supabase project
  createTypedHandler(supabaseContracts.getEdgeLogs, async (_, params) => {
    const { projectId, timestampStart, appId, organizationSlug } = params;
    const response = await getSupabaseProjectLogs(
      projectId,
      timestampStart,
      organizationSlug ?? undefined,
    );

    if (response.error) {
      const errorMsg =
        typeof response.error === "string"
          ? response.error
          : JSON.stringify(response.error);
      throw new Error(`Failed to fetch logs: ${errorMsg}`);
    }

    const rawLogs = response.result || [];

    // Transform to ConsoleEntry format
    return rawLogs.map((logEntry: SupabaseProjectLog) => {
      const metadata = logEntry.metadata?.[0] || {};
      const level = metadata.level || "info";
      const eventMessage = logEntry.event_message || "";
      const functionName = extractFunctionName(eventMessage);

      return {
        level: (level === "error"
          ? "error"
          : level === "warn"
            ? "warn"
            : "info") as "info" | "warn" | "error",
        type: "edge-function" as const,
        message: eventMessage,
        timestamp: logEntry.timestamp / 1000, // Convert from microseconds to milliseconds
        sourceName: functionName,
        appId,
      };
    });
  });

  // Set app project - links a Dyad app to a Supabase project
  createTypedHandler(supabaseContracts.setAppProject, async (_, params) => {
    const { projectId, appId, parentProjectId, organizationSlug } = params;
    await db
      .update(apps)
      .set({
        supabaseProjectId: projectId,
        supabaseParentProjectId: parentProjectId,
        supabaseOrganizationSlug: organizationSlug,
      })
      .where(eq(apps.id, appId));

    logger.info(
      `Associated app ${appId} with Supabase project ${projectId} (organization: ${organizationSlug})${parentProjectId ? ` and parent project ${parentProjectId}` : ""}`,
    );
  });

  // Unset app project - removes the link between a Dyad app and a Supabase project
  createTypedHandler(supabaseContracts.unsetAppProject, async (_, params) => {
    const { app } = params;
    await db
      .update(apps)
      .set({
        supabaseProjectId: null,
        supabaseParentProjectId: null,
        supabaseOrganizationSlug: null,
      })
      .where(eq(apps.id, app));

    logger.info(`Removed Supabase project association for app ${app}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Database Viewer Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  // List public tables for a Supabase project
  createTypedHandler(supabaseContracts.listTables, async (_, params) => {
    const { projectId, organizationSlug } = params;
    const query = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    const result = await executeSupabaseSql({
      supabaseProjectId: projectId,
      query,
      organizationSlug,
    });
    const parsed = safeJsonParse<Array<{ table_name: string }> | null>(
      result,
      "Supabase listTables response",
    );
    return (parsed ?? []).map((row) => row.table_name);
  });

  // Get table schema (columns) for a specific table
  createTypedHandler(supabaseContracts.getTableSchema, async (_, params) => {
    const { projectId, organizationSlug, table } = params;
    // Validate table name using shared utility for defense in depth
    if (!isValidTableName(table)) {
      throw new Error("supabase:get-table-schema: Invalid table name");
    }
    // Use parameterized-style escaping: escape single quotes in table name
    const escapedTable = table.replace(/'/g, "''");
    // Query includes primary key detection via pg_constraint
    const query = `
      SELECT
        c.column_name as name,
        c.data_type as type,
        c.is_nullable = 'YES' as nullable,
        c.column_default as "defaultValue",
        COALESCE(pk.is_primary_key, false) as "isPrimaryKey"
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name, true as is_primary_key
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = '${escapedTable}'
      ) pk ON c.column_name = pk.column_name
      WHERE c.table_schema = 'public' AND c.table_name = '${escapedTable}'
      ORDER BY c.ordinal_position;
    `;
    const result = await executeSupabaseSql({
      supabaseProjectId: projectId,
      query,
      organizationSlug,
    });
    return safeJsonParse(result, "Supabase getTableSchema response") ?? [];
  });

  // Query table rows with pagination
  createTypedHandler(supabaseContracts.queryTableRows, async (_, params) => {
    const { projectId, organizationSlug, table, limit, offset } = params;
    // Validate table name using shared utility for defense in depth
    if (!isValidTableName(table)) {
      throw new Error("supabase:query-table-rows: Invalid table name");
    }

    // Validate numeric params to prevent injection
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit))));
    const safeOffset = Math.max(0, Math.floor(Number(offset)));

    // Get total count
    const countQuery = `SELECT COUNT(*) as count FROM "${table}";`;
    const countResult = await executeSupabaseSql({
      supabaseProjectId: projectId,
      query: countQuery,
      organizationSlug,
    });
    const countParsed = safeJsonParse<Array<{ count: unknown }> | null>(
      countResult,
      "Supabase count query response",
    );
    const rawTotal = countParsed?.[0]?.count;
    // Properly handle null total to match schema (total: z.number().nullable())
    const total =
      rawTotal === null || rawTotal === undefined ? null : Number(rawTotal);

    // Get rows with pagination - use ORDER BY ctid for deterministic ordering
    // ctid is a system column that provides row physical location, ensuring stable pagination
    const rowsQuery = `SELECT * FROM "${table}" ORDER BY ctid LIMIT ${safeLimit} OFFSET ${safeOffset};`;
    const rowsResult = await executeSupabaseSql({
      supabaseProjectId: projectId,
      query: rowsQuery,
      organizationSlug,
    });

    const rows =
      safeJsonParse<Record<string, unknown>[]>(
        rowsResult,
        "Supabase rows query response",
      ) ?? [];
    return { rows, total };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SQL Editor Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  // Execute arbitrary SQL query
  createTypedHandler(supabaseContracts.executeSql, async (_, params) => {
    const { projectId, organizationSlug, query } = params;

    try {
      const result = await executeSupabaseSql({
        supabaseProjectId: projectId,
        query,
        organizationSlug,
      });

      const parsed = safeJsonParse<Record<string, unknown>[] | null>(
        result,
        "Supabase SQL execution response",
      );

      // Handle empty or null results
      if (!parsed || !Array.isArray(parsed)) {
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          error: null,
        };
      }

      // Extract column names from first row
      const columns = parsed.length > 0 ? Object.keys(parsed[0] as object) : [];

      return {
        columns,
        rows: parsed,
        rowCount: parsed.length,
        error: null,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("SQL execution error:", errorMessage);
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        error: errorMessage,
      };
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Row Mutation Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  // Helper to escape SQL values
  const escapeValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "NULL";
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (typeof value === "boolean") {
      return value ? "TRUE" : "FALSE";
    }
    if (typeof value === "object") {
      // JSON objects/arrays
      return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
    }
    // String - escape single quotes
    return `'${String(value).replace(/'/g, "''")}'`;
  };

  // Insert a new row
  createTypedHandler(supabaseContracts.insertRow, async (_, params) => {
    const { projectId, organizationSlug, table, data } = params;

    if (!isValidTableName(table)) {
      throw new Error("supabase:insert-row: Invalid table name");
    }

    const columns = Object.keys(data);
    if (columns.length === 0) {
      throw new Error("supabase:insert-row: No data provided");
    }

    const columnNames = columns.map((c) => `"${c}"`).join(", ");
    const values = columns.map((c) => escapeValue(data[c])).join(", ");

    const query = `INSERT INTO "${table}" (${columnNames}) VALUES (${values});`;

    await executeSupabaseSql({
      supabaseProjectId: projectId,
      query,
      organizationSlug,
    });

    logger.info(`Inserted row into ${table}`);
  });

  // Update an existing row
  createTypedHandler(supabaseContracts.updateRow, async (_, params) => {
    const { projectId, organizationSlug, table, primaryKey, data } = params;

    if (!isValidTableName(table)) {
      throw new Error("supabase:update-row: Invalid table name");
    }

    const pkColumns = Object.keys(primaryKey);
    if (pkColumns.length === 0) {
      throw new Error("supabase:update-row: No primary key provided");
    }

    const dataColumns = Object.keys(data);
    if (dataColumns.length === 0) {
      throw new Error("supabase:update-row: No data provided");
    }

    const setClause = dataColumns
      .map((c) => `"${c}" = ${escapeValue(data[c])}`)
      .join(", ");

    const whereClause = pkColumns
      .map((c) => `"${c}" = ${escapeValue(primaryKey[c])}`)
      .join(" AND ");

    const query = `UPDATE "${table}" SET ${setClause} WHERE ${whereClause};`;

    await executeSupabaseSql({
      supabaseProjectId: projectId,
      query,
      organizationSlug,
    });

    logger.info(`Updated row in ${table}`);
  });

  // Delete a row
  createTypedHandler(supabaseContracts.deleteRow, async (_, params) => {
    const { projectId, organizationSlug, table, primaryKey } = params;

    if (!isValidTableName(table)) {
      throw new Error("supabase:delete-row: Invalid table name");
    }

    const pkColumns = Object.keys(primaryKey);
    if (pkColumns.length === 0) {
      throw new Error("supabase:delete-row: No primary key provided");
    }

    const whereClause = pkColumns
      .map((c) => `"${c}" = ${escapeValue(primaryKey[c])}`)
      .join(" AND ");

    const query = `DELETE FROM "${table}" WHERE ${whereClause};`;

    await executeSupabaseSql({
      supabaseProjectId: projectId,
      query,
      organizationSlug,
    });

    logger.info(`Deleted row from ${table}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Auth Users Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  createTypedHandler(supabaseContracts.listAuthUsers, async (_, params) => {
    const { projectId, organizationSlug, page, perPage } = params;

    const result = await listAuthUsers({
      supabaseProjectId: projectId,
      organizationSlug,
      page,
      perPage,
    });

    return {
      users: result.users.map((u) => ({
        id: u.id,
        email: u.email,
        phone: u.phone,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        app_metadata: u.app_metadata,
        user_metadata: u.user_metadata,
      })),
      total: result.total,
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Secrets Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  createTypedHandler(supabaseContracts.listSecrets, async (_, params) => {
    const { projectId, organizationSlug } = params;

    const secrets = await listSecrets({
      supabaseProjectId: projectId,
      organizationSlug,
    });

    return secrets;
  });

  createTypedHandler(supabaseContracts.createSecret, async (_, params) => {
    const { projectId, organizationSlug, name, value } = params;

    await createSecret({
      supabaseProjectId: projectId,
      organizationSlug,
      name,
      value,
    });
  });

  createTypedHandler(supabaseContracts.deleteSecrets, async (_, params) => {
    const { projectId, organizationSlug, names } = params;

    await deleteSecrets({
      supabaseProjectId: projectId,
      organizationSlug,
      names,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Edge Logs Handler
  // ─────────────────────────────────────────────────────────────────────────────

  createTypedHandler(supabaseContracts.listEdgeLogs, async (_, params) => {
    const { projectId, organizationSlug, timestampStart } = params;

    const logs = await listEdgeLogs({
      supabaseProjectId: projectId,
      organizationSlug,
      timestampStart,
    });

    return { logs };
  });

  testOnlyHandle(
    "supabase:fake-connect-and-set-project",
    async (
      event,
      { appId, fakeProjectId }: { appId: number; fakeProjectId: string },
    ) => {
      const fakeOrgId = "fake-org-id";

      // Directly store fake credentials in the organizations map
      // We don't call handleSupabaseOAuthReturn because it attempts a real API call
      // which fails with fake tokens, causing credentials to be stored in legacy format
      const settings = readSettings();
      const existingOrgs = settings.supabase?.organizations ?? {};
      writeSettings({
        supabase: {
          ...settings.supabase,
          organizations: {
            ...existingOrgs,
            [fakeOrgId]: {
              accessToken: {
                value: "fake-access-token",
              },
              refreshToken: {
                value: "fake-refresh-token",
              },
              expiresIn: 3600,
              tokenTimestamp: Math.floor(Date.now() / 1000),
            },
          },
        },
      });
      logger.info(
        `Stored fake Supabase credentials for organization ${fakeOrgId} for app ${appId} during testing.`,
      );

      // Set the supabase project for the currently selected app
      await db
        .update(apps)
        .set({
          supabaseProjectId: fakeProjectId,
          supabaseOrganizationSlug: fakeOrgId,
        })
        .where(eq(apps.id, appId));
      logger.info(
        `Set fake Supabase project ${fakeProjectId} for app ${appId} during testing.`,
      );

      // Simulate the deep link event
      safeSend(event.sender, "deep-link-received", {
        type: "supabase-oauth-return",
        url: "https://supabase-oauth.dyad.sh/api/connect-supabase/login",
      });
      logger.info(
        `Sent fake deep-link-received event for app ${appId} during testing.`,
      );
    },
  );
}
