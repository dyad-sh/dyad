import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Supabase Schemas
// =============================================================================

export const SupabaseOrganizationInfoSchema = z.object({
  organizationSlug: z.string(),
  name: z.string().optional(),
  ownerEmail: z.string().optional(),
});

export type SupabaseOrganizationInfo = z.infer<
  typeof SupabaseOrganizationInfoSchema
>;

export const SupabaseProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  organizationSlug: z.string(),
});

export type SupabaseProject = z.infer<typeof SupabaseProjectSchema>;

export const SupabaseBranchSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  projectRef: z.string(),
  parentProjectRef: z.string().nullable(),
});

export type SupabaseBranch = z.infer<typeof SupabaseBranchSchema>;

export const DeleteSupabaseOrganizationParamsSchema = z.object({
  organizationSlug: z.string(),
});

export type DeleteSupabaseOrganizationParams = z.infer<
  typeof DeleteSupabaseOrganizationParamsSchema
>;

export const ListSupabaseBranchesParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable().optional(),
});

export const GetSupabaseEdgeLogsParamsSchema = z.object({
  projectId: z.string(),
  timestampStart: z.number().optional(),
  appId: z.number(),
  organizationSlug: z.string().nullable(),
});

export const ConsoleEntrySchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  type: z.enum(["server", "client", "edge-function", "network-requests"]),
  message: z.string(),
  timestamp: z.number(),
  sourceName: z.string().optional(),
  appId: z.number(),
});

export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>;

export const SetSupabaseAppProjectParamsSchema = z.object({
  appId: z.number(),
  projectId: z.string().nullable().optional(),
  parentProjectId: z.string().nullable().optional(),
  organizationSlug: z.string().nullable().optional(),
});

export type SetSupabaseAppProjectParams = z.infer<
  typeof SetSupabaseAppProjectParamsSchema
>;

// =============================================================================
// Database Viewer Schemas
// =============================================================================

export const TableColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  defaultValue: z.string().nullable(),
  isPrimaryKey: z.boolean().optional(),
});
export type TableColumn = z.infer<typeof TableColumnSchema>;

// =============================================================================
// SQL Editor Schemas
// =============================================================================

export const ExecuteSqlParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable(),
  query: z.string().min(1),
});
export type ExecuteSqlParams = z.infer<typeof ExecuteSqlParamsSchema>;

export const ExecuteSqlResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.unknown())),
  rowCount: z.number(),
  error: z.string().nullable(),
});
export type ExecuteSqlResult = z.infer<typeof ExecuteSqlResultSchema>;

// =============================================================================
// Row Mutation Schemas
// =============================================================================

export const InsertRowParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable(),
  table: z.string().min(1),
  data: z.record(z.unknown()),
});
export type InsertRowParams = z.infer<typeof InsertRowParamsSchema>;

export const UpdateRowParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable(),
  table: z.string().min(1),
  primaryKey: z.record(z.unknown()),
  data: z.record(z.unknown()),
});
export type UpdateRowParams = z.infer<typeof UpdateRowParamsSchema>;

export const DeleteRowParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable(),
  table: z.string().min(1),
  primaryKey: z.record(z.unknown()),
});
export type DeleteRowParams = z.infer<typeof DeleteRowParamsSchema>;

export const ListTablesParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable(),
});
export type ListTablesParams = z.infer<typeof ListTablesParamsSchema>;

export const GetTableSchemaParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable(),
  table: z.string().min(1),
});
export type GetTableSchemaParams = z.infer<typeof GetTableSchemaParamsSchema>;

export const QueryTableRowsParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable(),
  table: z.string().min(1),
  limit: z.number().min(1).max(100).default(25),
  offset: z.number().min(0).default(0),
});
export type QueryTableRowsParams = z.infer<typeof QueryTableRowsParamsSchema>;

export const QueryTableRowsResultSchema = z.object({
  rows: z.array(z.record(z.unknown())),
  total: z.number().nullable(),
});
export type QueryTableRowsResult = z.infer<typeof QueryTableRowsResultSchema>;

// =============================================================================
// Auth Users Schemas
// =============================================================================

export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable().optional(),
  created_at: z.string(),
  last_sign_in_at: z.string().nullable(),
  app_metadata: z.record(z.unknown()).optional(),
  user_metadata: z.record(z.unknown()).optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const ListAuthUsersParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable(),
  page: z.number().min(1).default(1),
  perPage: z.number().min(1).max(100).default(25),
});
export type ListAuthUsersParams = z.infer<typeof ListAuthUsersParamsSchema>;

export const ListAuthUsersResultSchema = z.object({
  users: z.array(AuthUserSchema),
  total: z.number(),
});
export type ListAuthUsersResult = z.infer<typeof ListAuthUsersResultSchema>;

// =============================================================================
// Secrets Schemas
// =============================================================================

export const SecretSchema = z.object({
  name: z.string(),
});
export type Secret = z.infer<typeof SecretSchema>;

export const ListSecretsParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable(),
});
export type ListSecretsParams = z.infer<typeof ListSecretsParamsSchema>;

export const CreateSecretParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable(),
  name: z.string().min(1),
  value: z.string().min(1),
});
export type CreateSecretParams = z.infer<typeof CreateSecretParamsSchema>;

export const DeleteSecretParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable(),
  names: z.array(z.string().min(1)),
});
export type DeleteSecretParams = z.infer<typeof DeleteSecretParamsSchema>;

// =============================================================================
// Edge Logs Schemas (for LogsSection)
// =============================================================================

export const EdgeLogEntrySchema = z.object({
  timestamp: z.string(),
  level: z.enum(["info", "warn", "error", "debug"]),
  message: z.string(),
  functionName: z.string().optional(),
});
export type EdgeLogEntry = z.infer<typeof EdgeLogEntrySchema>;

export const ListEdgeLogsParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable(),
  timestampStart: z.number().optional(),
});
export type ListEdgeLogsParams = z.infer<typeof ListEdgeLogsParamsSchema>;

export const ListEdgeLogsResultSchema = z.object({
  logs: z.array(EdgeLogEntrySchema),
});
export type ListEdgeLogsResult = z.infer<typeof ListEdgeLogsResultSchema>;

// =============================================================================
// Supabase Contracts
// =============================================================================

export const supabaseContracts = {
  listOrganizations: defineContract({
    channel: "supabase:list-organizations",
    input: z.void(),
    output: z.array(SupabaseOrganizationInfoSchema),
  }),

  deleteOrganization: defineContract({
    channel: "supabase:delete-organization",
    input: DeleteSupabaseOrganizationParamsSchema,
    output: z.void(),
  }),

  listAllProjects: defineContract({
    channel: "supabase:list-all-projects",
    input: z.void(),
    output: z.array(SupabaseProjectSchema),
  }),

  listBranches: defineContract({
    channel: "supabase:list-branches",
    input: ListSupabaseBranchesParamsSchema,
    output: z.array(SupabaseBranchSchema),
  }),

  getEdgeLogs: defineContract({
    channel: "supabase:get-edge-logs",
    input: GetSupabaseEdgeLogsParamsSchema,
    output: z.array(ConsoleEntrySchema),
  }),

  setAppProject: defineContract({
    channel: "supabase:set-app-project",
    input: SetSupabaseAppProjectParamsSchema,
    output: z.void(),
  }),

  unsetAppProject: defineContract({
    channel: "supabase:unset-app-project",
    input: z.object({ app: z.number() }),
    output: z.void(),
  }),

  // Database viewer contracts
  listTables: defineContract({
    channel: "supabase:list-tables",
    input: ListTablesParamsSchema,
    output: z.array(z.string()),
  }),

  getTableSchema: defineContract({
    channel: "supabase:get-table-schema",
    input: GetTableSchemaParamsSchema,
    output: z.array(TableColumnSchema),
  }),

  queryTableRows: defineContract({
    channel: "supabase:query-table-rows",
    input: QueryTableRowsParamsSchema,
    output: QueryTableRowsResultSchema,
  }),

  // SQL Editor contracts
  executeSql: defineContract({
    channel: "supabase:execute-sql",
    input: ExecuteSqlParamsSchema,
    output: ExecuteSqlResultSchema,
  }),

  // Row mutation contracts
  insertRow: defineContract({
    channel: "supabase:insert-row",
    input: InsertRowParamsSchema,
    output: z.void(),
  }),

  updateRow: defineContract({
    channel: "supabase:update-row",
    input: UpdateRowParamsSchema,
    output: z.void(),
  }),

  deleteRow: defineContract({
    channel: "supabase:delete-row",
    input: DeleteRowParamsSchema,
    output: z.void(),
  }),

  // Auth Users contracts
  listAuthUsers: defineContract({
    channel: "supabase:list-auth-users",
    input: ListAuthUsersParamsSchema,
    output: ListAuthUsersResultSchema,
  }),

  // Secrets contracts
  listSecrets: defineContract({
    channel: "supabase:list-secrets",
    input: ListSecretsParamsSchema,
    output: z.array(SecretSchema),
  }),

  createSecret: defineContract({
    channel: "supabase:create-secret",
    input: CreateSecretParamsSchema,
    output: z.void(),
  }),

  deleteSecrets: defineContract({
    channel: "supabase:delete-secrets",
    input: DeleteSecretParamsSchema,
    output: z.void(),
  }),

  // Edge Logs contract (for LogsSection)
  listEdgeLogs: defineContract({
    channel: "supabase:list-edge-logs",
    input: ListEdgeLogsParamsSchema,
    output: ListEdgeLogsResultSchema,
  }),

  // Test-only channel
  fakeConnectAndSetProject: defineContract({
    channel: "supabase:fake-connect-and-set-project",
    input: z.object({
      appId: z.number(),
      fakeProjectId: z.string(),
    }),
    output: z.void(),
  }),
} as const;

// =============================================================================
// Supabase Client
// =============================================================================

export const supabaseClient = createClient(supabaseContracts);
