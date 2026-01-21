/**
 * Supabase Database Capability
 *
 * Handles database operations including SQL execution, schema queries,
 * project listing, and branch management.
 */

import log from "electron-log";
import { db } from "../../../db";
import { eq } from "drizzle-orm";
import { apps } from "../../../db/schema";
import { IS_TEST_BUILD } from "../../../ipc/utils/test_utils";
import {
  fetchWithRetry,
  retryWithRateLimit,
} from "../../../ipc/utils/retryWithRateLimit";
import { SupabaseManagementAPIError } from "@dyad-sh/supabase-management-js";
import { getSupabaseClientForOrganization } from "./oauth";
import type {
  DatabaseCapability,
  ExecuteSqlParams,
  GetSchemaParams,
  DatabaseSchema,
  DatabaseProject,
  LinkProjectParams,
  ListBranchesParams,
  DatabaseBranch,
} from "../../types";
import {
  SUPABASE_SCHEMA_QUERY,
  SUPABASE_FUNCTIONS_QUERY,
  buildSupabaseSchemaQuery,
} from "../../../supabase_admin/supabase_schema_query";

const logger = log.scope("supabase_plugin_database");

const SUPABASE_API_BASE_URL = "https://api.supabase.com/v1";

// ─────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────

/**
 * Get a Supabase Management API client, optionally for a specific organization.
 */
async function getClient(organizationSlug?: string | null) {
  if (!organizationSlug) {
    throw new Error("Organization slug is required for Supabase operations");
  }
  return getSupabaseClientForOrganization(organizationSlug);
}

// ─────────────────────────────────────────────────────────────────────
// Database Capability Implementation
// ─────────────────────────────────────────────────────────────────────

export function createDatabaseCapability(): DatabaseCapability {
  return {
    executeSql: async (params: ExecuteSqlParams): Promise<string> => {
      const { projectId, query, accountId } = params;

      if (IS_TEST_BUILD) {
        return "{}";
      }

      const supabase = await getClient(accountId);
      const result = await retryWithRateLimit(
        () => supabase.runQuery(projectId, query),
        `Execute SQL on ${projectId}`,
      );
      return JSON.stringify(result);
    },

    getSchema: async (params: GetSchemaParams): Promise<DatabaseSchema> => {
      const { projectId, accountId, tableName } = params;

      if (IS_TEST_BUILD) {
        return {
          tables: [
            {
              name: "users",
              columns: [
                {
                  name: "id",
                  type: "uuid",
                  nullable: false,
                  isPrimaryKey: true,
                },
                { name: "email", type: "text", nullable: false },
                { name: "created_at", type: "timestamptz", nullable: false },
              ],
              rlsEnabled: true,
            },
          ],
          functions: [
            {
              name: "test_function",
              arguments: "",
              returnType: "void",
              language: "plpgsql",
            },
          ],
        };
      }

      const supabase = await getClient(accountId);

      // Use the schema query builder if a specific table is requested
      const schemaQuery = tableName
        ? buildSupabaseSchemaQuery(tableName)
        : SUPABASE_SCHEMA_QUERY;

      const schemaResult = await retryWithRateLimit(
        () => supabase.runQuery(projectId, schemaQuery),
        `Get schema for ${projectId}${tableName ? `:${tableName}` : ""}`,
      );

      // Also fetch functions
      const functionsResult = await retryWithRateLimit(
        () => supabase.runQuery(projectId, SUPABASE_FUNCTIONS_QUERY),
        `Get DB functions for ${projectId}`,
      );

      // Parse the results into a DatabaseSchema structure
      // The raw query results need to be transformed
      const tables = Array.isArray(schemaResult)
        ? schemaResult.map((row: any) => ({
            name: row.table_name,
            columns: [], // Would need additional query to get columns
            rlsEnabled: row.rls_enabled,
          }))
        : [];

      const functions = Array.isArray(functionsResult)
        ? functionsResult.map((row: any) => ({
            name: row.name,
            arguments: row.arguments || "",
            returnType: row.return_type || "void",
            language: row.language || "plpgsql",
            source: row.source,
          }))
        : [];

      return { tables, functions };
    },

    listProjects: async (accountId?: string): Promise<DatabaseProject[]> => {
      const { readSettings } = await import("../../../main/settings");
      const settings = readSettings();
      const organizations = settings.supabase?.organizations ?? {};

      // If accountId provided, only list from that organization
      const orgsToQuery = accountId
        ? [accountId]
        : Object.keys(organizations);

      const allProjects: DatabaseProject[] = [];

      for (const organizationSlug of orgsToQuery) {
        try {
          const client = await getSupabaseClientForOrganization(organizationSlug);
          const projects = await client.getProjects();

          if (projects) {
            for (const project of projects) {
              allProjects.push({
                id: project.id,
                name: project.name,
                region: project.region,
                accountId:
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
    },

    linkProject: async (params: LinkProjectParams): Promise<void> => {
      const { appId, projectId, accountId, parentProjectId } = params;

      await db
        .update(apps)
        .set({
          supabaseProjectId: projectId,
          supabaseParentProjectId: parentProjectId ?? null,
          supabaseOrganizationSlug: accountId,
        })
        .where(eq(apps.id, appId));

      logger.info(
        `Associated app ${appId} with Supabase project ${projectId} (organization: ${accountId})${parentProjectId ? ` and parent project ${parentProjectId}` : ""}`,
      );
    },

    unlinkProject: async (appId: number): Promise<void> => {
      await db
        .update(apps)
        .set({
          supabaseProjectId: null,
          supabaseParentProjectId: null,
          supabaseOrganizationSlug: null,
        })
        .where(eq(apps.id, appId));

      logger.info(`Removed Supabase project association for app ${appId}`);
    },

    listBranches: async (params: ListBranchesParams): Promise<DatabaseBranch[]> => {
      const { projectId, accountId } = params;

      if (IS_TEST_BUILD) {
        return [
          {
            id: "default-branch-id",
            name: "Default Branch",
            isDefault: true,
            projectRef: "fake-project-id",
            parentProjectRef: "fake-project-id",
          },
          {
            id: "test-branch-id",
            name: "Test Branch",
            isDefault: false,
            projectRef: "test-branch-project-id",
            parentProjectRef: "fake-project-id",
          },
        ];
      }

      logger.info(`Listing Supabase branches for project: ${projectId}`);
      const supabase = await getClient(accountId);

      const response = await fetchWithRetry(
        `${SUPABASE_API_BASE_URL}/projects/${projectId}/branches`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${(supabase as any).options.accessToken}`,
          },
        },
        `List Supabase branches for ${projectId}`,
      );

      if (response.status !== 200) {
        const errorText = await response.text();
        logger.error(
          `Failed to list branches (${response.status}): ${errorText}`,
        );
        throw new SupabaseManagementAPIError(
          `Failed to list branches: ${response.statusText}`,
          response,
        );
      }

      const branches = await response.json();
      logger.info(`Listed Supabase branches for project: ${projectId}`);

      return branches.map((branch: any) => ({
        id: branch.id,
        name: branch.name,
        isDefault: branch.is_default,
        projectRef: branch.project_ref,
        parentProjectRef: branch.parent_project_ref,
      }));
    },
  };
}
