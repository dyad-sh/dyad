import { neon } from "@neondatabase/serverless";
import log from "electron-log";
import { getNeonClient } from "./neon_management_client";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("neon_context");

// =============================================================================
// SQL Execution
// =============================================================================

/**
 * Get the primary role name for a given project branch by querying the Neon API.
 * Falls back to "neondb_owner" if no roles are found.
 */
export async function getBranchRoleName({
  projectId,
  branchId,
}: {
  projectId: string;
  branchId: string;
}): Promise<string> {
  const neonClient = await getNeonClient();
  const rolesResponse = await neonClient.listProjectBranchRoles(
    projectId,
    branchId,
  );
  const roles = rolesResponse.data.roles ?? [];
  // Prefer the first non-protected role (user-created), fall back to any role
  const userRole = roles.find((r) => !r.protected) ?? roles[0];
  return userRole?.name ?? "neondb_owner";
}

/**
 * Get a Neon connection URI for a given project and branch.
 */
export async function getConnectionUri({
  projectId,
  branchId,
}: {
  projectId: string;
  branchId: string;
}): Promise<string> {
  const neonClient = await getNeonClient();
  const roleName = await getBranchRoleName({ projectId, branchId });
  const response = await neonClient.getConnectionUri({
    projectId,
    branch_id: branchId,
    database_name: "neondb",
    role_name: roleName,
  });
  return response.data.uri;
}

/**
 * Execute a SQL query against a Neon database.
 */
export async function executeNeonSql({
  projectId,
  branchId,
  query,
}: {
  projectId: string;
  branchId: string;
  query: string;
}): Promise<string> {
  if (IS_TEST_BUILD) {
    return `[[TEST_NEON_SQL_RESULT: ${query.slice(0, 50)}]]`;
  }

  try {
    const connectionUri = await getConnectionUri({ projectId, branchId });
    const sql = neon(connectionUri);
    const result = await sql.query(query, []);
    return JSON.stringify(result, null, 2);
  } catch (error) {
    logger.error("Error executing Neon SQL:", error);
    throw new DyadError(
      `Failed to execute SQL on Neon: ${error instanceof Error ? error.message : String(error)}`,
      DyadErrorKind.External,
    );
  }
}

// =============================================================================
// Schema Introspection Queries
// =============================================================================

const TABLE_NAMES_QUERY = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
  ORDER BY table_name;
`;

const TABLE_SCHEMA_QUERY = `
  SELECT
    c.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable,
    c.column_default,
    c.character_maximum_length,
    tc.constraint_type,
    kcu.constraint_name
  FROM information_schema.columns c
  LEFT JOIN information_schema.key_column_usage kcu
    ON c.table_schema = kcu.table_schema
    AND c.table_name = kcu.table_name
    AND c.column_name = kcu.column_name
  LEFT JOIN information_schema.table_constraints tc
    ON kcu.constraint_name = tc.constraint_name
    AND kcu.table_schema = tc.table_schema
  WHERE c.table_schema = 'public'
  ORDER BY c.table_name, c.ordinal_position;
`;

function buildTableSchemaQuery(tableName?: string): {
  query: string;
  params: string[];
} {
  if (!tableName) return { query: TABLE_SCHEMA_QUERY, params: [] };
  // Append a table filter to the base query, replacing the final ORDER BY
  // so we can inject the AND clause and use a single-column ordering.
  const filtered = TABLE_SCHEMA_QUERY.replace(
    /ORDER BY c\.table_name, c\.ordinal_position;\s*$/,
    `AND c.table_name = $1\n  ORDER BY c.ordinal_position;\n`,
  );
  return { query: filtered, params: [tableName] };
}

const INDEXES_QUERY = `
  SELECT
    tablename AS table_name,
    indexname AS index_name,
    indexdef AS index_definition
  FROM pg_indexes
  WHERE schemaname = 'public'
  ORDER BY tablename, indexname;
`;

function buildIndexesQuery(tableName?: string): {
  query: string;
  params: string[];
} {
  if (!tableName) return { query: INDEXES_QUERY, params: [] };
  // Append a table filter to the base query, replacing the final ORDER BY
  // so we can inject the AND clause and use a single-column ordering.
  const filtered = INDEXES_QUERY.replace(
    /ORDER BY tablename, indexname;\s*$/,
    `AND tablename = $1\n  ORDER BY indexname;\n`,
  );
  return { query: filtered, params: [tableName] };
}

// =============================================================================
// Project Info
// =============================================================================

/**
 * Get high-level Neon project info: project ID, branches, and table names.
 */
export async function getNeonProjectInfo({
  projectId,
  branchId,
}: {
  projectId: string;
  branchId: string;
}): Promise<string> {
  if (IS_TEST_BUILD) {
    return `# Neon Project Info

## Project ID
${projectId}

## Branches
(test mode)

## Table Names
["users", "posts", "comments"]
`;
  }

  try {
    const neonClient = await getNeonClient();

    // Get project info
    const projectResponse = await neonClient.getProject(projectId);
    const project = projectResponse.data.project;

    // Get branches
    const branchesResponse = await neonClient.listProjectBranches({
      projectId,
    });
    const branches =
      branchesResponse.data.branches?.map((b) => ({
        id: b.id,
        name: b.name,
        default: b.default,
      })) ?? [];

    // Get table names via SQL
    const connectionUri = await getConnectionUri({ projectId, branchId });
    const sql = neon(connectionUri);
    const tableResult = await sql.query(TABLE_NAMES_QUERY, []);
    const tableNames = tableResult.map(
      (row) => (row as Record<string, string>).table_name,
    );

    return `# Neon Project Info

## Project ID
${projectId}

## Project Name
${project.name}

## Branches
${JSON.stringify(branches, null, 2)}

## Active Branch
${branchId}

## Table Names
${JSON.stringify(tableNames)}
`;
  } catch (error) {
    logger.error("Error getting Neon project info:", error);
    throw new DyadError(
      `Failed to get Neon project info: ${error instanceof Error ? error.message : String(error)}`,
      DyadErrorKind.External,
    );
  }
}

// =============================================================================
// Table Schema
// =============================================================================

/**
 * Get database table schema from Neon. If tableName is provided, returns schema
 * for that specific table. If omitted, returns schema for all tables.
 */
export async function getNeonTableSchema({
  projectId,
  branchId,
  tableName,
}: {
  projectId: string;
  branchId: string;
  tableName?: string;
}): Promise<string> {
  if (IS_TEST_BUILD) {
    return `[[TEST_NEON_TABLE_SCHEMA${tableName ? `:${tableName}` : ""}]]`;
  }

  try {
    const connectionUri = await getConnectionUri({ projectId, branchId });
    const sql = neon(connectionUri);

    const { query: schemaQuery, params: schemaParams } =
      buildTableSchemaQuery(tableName);
    const schemaResult = await sql.query(schemaQuery, schemaParams);

    const { query: indexesQuery, params: indexesParams } =
      buildIndexesQuery(tableName);
    const indexesResult = await sql.query(indexesQuery, indexesParams);

    return JSON.stringify(
      {
        columns: schemaResult,
        indexes: indexesResult,
      },
      null,
      2,
    );
  } catch (error) {
    logger.error("Error getting Neon table schema:", error);
    throw new DyadError(
      `Failed to get Neon table schema: ${error instanceof Error ? error.message : String(error)}`,
      DyadErrorKind.External,
    );
  }
}

// =============================================================================
// Client Code Generation
// =============================================================================

/**
 * Generate framework-specific client code for connecting to Neon.
 */
export function getNeonClientCode(
  frameworkType: "nextjs" | "vite" | "other" | null,
): string {
  if (frameworkType === "nextjs") {
    return `// Neon Database Client (server-side only)
// File: src/db/index.ts
import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL!);

// IMPORTANT: Only use this in server-side code (API routes, server actions, server components).
// NEVER import @neondatabase/serverless in client-side React components.
// Prefer sql\`...\` tagged queries or Drizzle over string-built SQL.`;
  }

  // Fallback for "vite", "other", or null
  return `// Neon Database Connection
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
// Use: const result = await sql\`SELECT * FROM table_name\`;`;
}

// =============================================================================
// Full Context for Agent Prompt
// =============================================================================

/**
 * Get full Neon context for the agent prompt, including project info and schema.
 */
export async function getNeonContext({
  projectId,
  branchId,
  frameworkType,
}: {
  projectId: string;
  branchId: string;
  frameworkType: "nextjs" | "vite" | "other" | null;
}): Promise<string> {
  if (IS_TEST_BUILD) {
    return "[[TEST_BUILD_NEON_CONTEXT]]";
  }

  const projectInfo = await getNeonProjectInfo({ projectId, branchId });
  const clientCode = getNeonClientCode(frameworkType);

  return `${projectInfo}

## Client Code
\`\`\`typescript
${clientCode}
\`\`\`
`;
}
