import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  canUseLinkedDatabaseTools,
  canUseNeonTools,
  canUseSupabaseTools,
  escapeXmlAttr,
  escapeXmlContent,
  getUnavailableDatabaseProviderMessage,
} from "./types";
import { getSupabaseTableSchema } from "../../../../../../supabase_admin/supabase_context";
import { getNeonTableSchema } from "../../../../../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveLinkedDatabaseProvider } from "@/shared/database_provider";

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
    "Get database table schema as PostgreSQL SQL/DDL. If tableName is provided, returns schema for that specific table and relevant constraints/indexes/triggers/policies. If omitted, returns schema for all application tables. Neon results include both the public schema and the neon_auth schema used by Better Auth.",
  inputSchema: getDatabaseTableSchemaSchema,
  defaultConsent: "always",
  isEnabled: canUseLinkedDatabaseTools,

  getConsentPreview: (args) =>
    args.tableName
      ? `Get schema for table "${args.tableName}"`
      : "Get schema for all tables",

  execute: async (args, ctx: AgentContext) => {
    const tableAttr = args.tableName
      ? ` table="${escapeXmlAttr(args.tableName)}"`
      : "";

    const provider = resolveLinkedDatabaseProvider({
      hasSupabaseProject: Boolean(ctx.supabaseProjectId),
      hasNeonProject: Boolean(ctx.neonProjectId),
    });

    if (provider === "supabase" && canUseSupabaseTools(ctx)) {
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

    if (provider === "neon" && canUseNeonTools(ctx)) {
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

    throw new DyadError(
      getUnavailableDatabaseProviderMessage(ctx, "schema inspection"),
      DyadErrorKind.Precondition,
    );
  },
};
