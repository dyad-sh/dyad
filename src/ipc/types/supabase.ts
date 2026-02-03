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
});
export type TableColumn = z.infer<typeof TableColumnSchema>;

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
