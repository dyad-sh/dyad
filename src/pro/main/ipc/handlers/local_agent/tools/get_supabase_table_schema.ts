import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { getSupabaseTableSchema } from "../../../../../../supabase_admin/supabase_context";

const getSupabaseTableSchemaSchema = z.object({
  tableName: z
    .string()
    .optional()
    .describe(
      "Optional table name to get schema for. If omitted, returns schema for all tables.",
    ),
});

export const getSupabaseTableSchemaTool: ToolDefinition<
  z.infer<typeof getSupabaseTableSchemaSchema>
> = {
  name: "get_supabase_table_schema",
  description:
    "Get database table schema from Supabase. If tableName is provided, returns schema for that specific table (columns, policies, triggers). If omitted, returns schema for all tables.",
  inputSchema: getSupabaseTableSchemaSchema,
  defaultConsent: "always",
  isEnabled: (ctx) => !!ctx.supabaseProjectId,

  getConsentPreview: (args) =>
    args.tableName
      ? `Get schema for table "${args.tableName}"`
      : "Get schema for all tables",

  execute: async (args, ctx: AgentContext) => {
    if (!ctx.supabaseProjectId) {
      throw new Error("Supabase is not connected to this app");
    }

    const tableAttr = args.tableName
      ? ` table="${escapeXmlAttr(args.tableName)}"`
      : "";
    ctx.onXmlStream(
      `<dyad-supabase-table-schema${tableAttr}></dyad-supabase-table-schema>`,
    );

    const schema = await getSupabaseTableSchema({
      supabaseProjectId: ctx.supabaseProjectId,
      organizationSlug: ctx.supabaseOrganizationSlug ?? null,
      tableName: args.tableName,
    });

    ctx.onXmlComplete(
      `<dyad-supabase-table-schema${tableAttr}>\n${escapeXmlContent(schema)}\n</dyad-supabase-table-schema>`,
    );

    return schema;
  },
};
