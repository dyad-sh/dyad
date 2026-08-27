import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  canUseNeonTools,
  canUseSupabaseTools,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { getSupabaseTableSchema } from "../../../../../../supabase_admin/supabase_context";
import { getNeonTableSchema } from "../../../../../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const getDatabaseTableSchemaSchema = z.object({
  tableName: z
    .string()
    .optional()
    .describe(
      "Optional table name to get schema for. If omitted, returns schema for all tables.",
    ),
});

export const getDatabaseTableSchemaTool: ToolDefinition<
  z.infer<typeof getDatabaseTableSchemaSchema>
> = {
  name: "get_database_table_schema",
  description:
    "Get database table schema as PostgreSQL SQL/DDL. If tableName is provided, returns schema for that specific table and relevant constraints/indexes/triggers/policies. If omitted, returns schema for all public tables.",
  inputSchema: getDatabaseTableSchemaSchema,
  defaultConsent: "always",
  isEnabled: (ctx) => canUseSupabaseTools(ctx) || canUseNeonTools(ctx),

  getConsentPreview: (args) =>
    args.tableName
      ? `Get schema for table "${args.tableName}"`
      : "Get schema for all tables",

  execute: async (args, ctx: AgentContext) => {
    const tableAttr = args.tableName
      ? ` table="${escapeXmlAttr(args.tableName)}"`
      : "";

    if (canUseNeonTools(ctx)) {
      ctx.onXmlStream(
        `<dyad-db-table-schema provider="Neon"${tableAttr}></dyad-db-table-schema>`,
      );

      const schema = await getNeonTableSchema({
        projectId: ctx.neonProjectId,
        branchId: ctx.neonActiveBranchId,
        tableName: args.tableName,
      });

      ctx.onXmlComplete(
        `<dyad-db-table-schema provider="Neon"${tableAttr}>\n${escapeXmlContent(schema)}\n</dyad-db-table-schema>`,
      );

      return schema;
    }

    if (canUseSupabaseTools(ctx)) {
      ctx.onXmlStream(
        `<dyad-db-table-schema provider="Supabase"${tableAttr}></dyad-db-table-schema>`,
      );

      const schema = await getSupabaseTableSchema({
        supabaseProjectId: ctx.supabaseProjectId,
        organizationSlug: ctx.supabaseOrganizationSlug ?? null,
        tableName: args.tableName,
      });

      ctx.onXmlComplete(
        `<dyad-db-table-schema provider="Supabase"${tableAttr}>\n${escapeXmlContent(schema)}\n</dyad-db-table-schema>`,
      );

      return schema;
    }

    throw new DyadError(
      "No database provider is available for schema inspection",
      DyadErrorKind.Precondition,
    );
  },
};
