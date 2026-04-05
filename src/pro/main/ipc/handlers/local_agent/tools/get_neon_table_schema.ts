import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { getNeonTableSchema } from "../../../../../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const getNeonTableSchemaSchema = z.object({
  tableName: z
    .string()
    .optional()
    .describe(
      "Optional table name to get schema for. If omitted, returns schema for all tables.",
    ),
});

export const getNeonTableSchemaTool: ToolDefinition<
  z.infer<typeof getNeonTableSchemaSchema>
> = {
  name: "get_neon_table_schema",
  description:
    "Get database table schema from Neon. If tableName is provided, returns schema for that specific table (columns, constraints, indexes). If omitted, returns schema for all tables.",
  inputSchema: getNeonTableSchemaSchema,
  defaultConsent: "always",
  isEnabled: (ctx) => !!ctx.neonProjectId && !!ctx.neonActiveBranchId,

  getConsentPreview: (args) =>
    args.tableName
      ? `Get schema for table "${args.tableName}"`
      : "Get schema for all tables",

  execute: async (args, ctx: AgentContext) => {
    if (!ctx.neonProjectId || !ctx.neonActiveBranchId) {
      throw new DyadError(
        "Neon is not connected to this app",
        DyadErrorKind.Precondition,
      );
    }

    const tableAttr = args.tableName
      ? ` table="${escapeXmlAttr(args.tableName)}"`
      : "";
    ctx.onXmlStream(
      `<dyad-neon-table-schema${tableAttr}></dyad-neon-table-schema>`,
    );

    const schema = await getNeonTableSchema({
      projectId: ctx.neonProjectId,
      branchId: ctx.neonActiveBranchId,
      tableName: args.tableName,
    });

    ctx.onXmlComplete(
      `<dyad-neon-table-schema${tableAttr}>\n${escapeXmlContent(schema)}\n</dyad-neon-table-schema>`,
    );

    return schema;
  },
};
