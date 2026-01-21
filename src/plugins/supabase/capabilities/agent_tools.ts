/**
 * Supabase Agent Tools Capability
 *
 * Provides AI agent tools for Supabase operations.
 */

import { z } from "zod";
import type { AgentToolsCapability, PluginToolDefinition } from "../../types";
import { createAgentContextCapability } from "./agent_context";
import { createDatabaseCapability } from "./database";

// ─────────────────────────────────────────────────────────────────────
// Tool Input Schemas
// ─────────────────────────────────────────────────────────────────────

const getProjectInfoSchema = z.object({
  include_db_functions: z
    .boolean()
    .optional()
    .describe(
      "If true, includes database functions in the output. This can significantly increase the response size.",
    ),
});

const getTableSchemaSchema = z.object({
  table_name: z
    .string()
    .optional()
    .describe(
      "Optional specific table name to get schema for. If not provided, returns schema for all tables.",
    ),
});

// ─────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────

/**
 * Tool for getting high-level Supabase project info.
 */
function createGetProjectInfoTool(
  getProjectId: () => string | null,
  getAccountId: () => string | null,
): PluginToolDefinition {
  const agentContext = createAgentContextCapability();

  return {
    name: "get_supabase_project_info",
    description: `Retrieves high-level Supabase project information including:
- Project ID
- Publishable key (anon key)
- Secret names (environment variables)
- Table names (without full schema details)
- Optionally, database functions

Use this tool first to discover available tables, then use get_supabase_table_schema for detailed schema information about specific tables.`,
    inputSchema: getProjectInfoSchema,
    defaultConsent: "always",
    execute: async (params: unknown) => {
      const input = getProjectInfoSchema.parse(params);
      const projectId = getProjectId();
      const accountId = getAccountId();

      if (!projectId) {
        throw new Error(
          "No Supabase project is connected. Please connect a Supabase project first.",
        );
      }

      return agentContext.getProjectInfo({
        projectId,
        accountId: accountId ?? undefined,
        includeDbFunctions: input.include_db_functions,
      });
    },
  };
}

/**
 * Tool for getting detailed table schema information.
 */
function createGetTableSchemaTool(
  getProjectId: () => string | null,
  getAccountId: () => string | null,
): PluginToolDefinition {
  const database = createDatabaseCapability();

  return {
    name: "get_supabase_table_schema",
    description: `Retrieves detailed schema information for Supabase database tables including:
- Column definitions (name, type, nullable, default values)
- Row Level Security (RLS) policies
- Triggers
- Database functions

Use get_supabase_project_info first to discover available tables, then use this tool for detailed schema of specific tables.`,
    inputSchema: getTableSchemaSchema,
    defaultConsent: "always",
    execute: async (params: unknown) => {
      const input = getTableSchemaSchema.parse(params);
      const projectId = getProjectId();
      const accountId = getAccountId();

      if (!projectId) {
        throw new Error(
          "No Supabase project is connected. Please connect a Supabase project first.",
        );
      }

      const schema = await database.getSchema({
        projectId,
        accountId: accountId ?? undefined,
        tableName: input.table_name,
      });

      return JSON.stringify(schema);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Agent Tools Capability Implementation
// ─────────────────────────────────────────────────────────────────────

/**
 * Create the agent tools capability.
 *
 * Note: The getProjectId and getAccountId functions need to be provided
 * to resolve the current app's Supabase configuration at runtime.
 * This is typically done by the tool executor that has access to the current app context.
 */
export function createAgentToolsCapability(): AgentToolsCapability {
  // These will be set up by the plugin system when tools are registered
  // For now, we return placeholder tools that will be configured at runtime
  let projectIdGetter: () => string | null = () => null;
  let accountIdGetter: () => string | null = () => null;

  return {
    getToolDefinitions: () => [
      createGetProjectInfoTool(projectIdGetter, accountIdGetter),
      createGetTableSchemaTool(projectIdGetter, accountIdGetter),
    ],
  };
}

/**
 * Create agent tools capability with context getters.
 * This is used when you have access to the app context.
 */
export function createAgentToolsCapabilityWithContext(
  getProjectId: () => string | null,
  getAccountId: () => string | null,
): AgentToolsCapability {
  return {
    getToolDefinitions: () => [
      createGetProjectInfoTool(getProjectId, getAccountId),
      createGetTableSchemaTool(getProjectId, getAccountId),
    ],
  };
}
