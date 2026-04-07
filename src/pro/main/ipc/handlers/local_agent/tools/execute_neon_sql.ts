import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { executeNeonSql } from "../../../../../../neon_admin/neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const executeNeonSqlSchema = z.object({
  query: z.string().describe("The SQL query to execute"),
  description: z.string().optional().describe("Brief description of the query"),
});

export const executeNeonSqlTool: ToolDefinition<
  z.infer<typeof executeNeonSqlSchema>
> = {
  name: "execute_neon_sql",
  description: "Execute SQL on the Neon database",
  inputSchema: executeNeonSqlSchema,
  defaultConsent: "ask",
  modifiesState: true,
  isEnabled: (ctx) => !!ctx.neonProjectId && !!ctx.neonActiveBranchId,

  getConsentPreview: (args) =>
    args.query.slice(0, 100) + (args.query.length > 100 ? "..." : ""),

  buildXml: (args, isComplete) => {
    if (args.query == undefined) return undefined;

    let xml = `<dyad-execute-sql description="${escapeXmlAttr(args.description ?? "")}">\n${args.query}`;
    if (isComplete) {
      xml += "\n</dyad-execute-sql>";
    }
    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    if (!ctx.neonProjectId || !ctx.neonActiveBranchId) {
      throw new DyadError(
        "Neon is not connected to this app",
        DyadErrorKind.Precondition,
      );
    }

    const sqlResult = await executeNeonSql({
      projectId: ctx.neonProjectId,
      branchId: ctx.neonActiveBranchId,
      query: args.query,
    });

    return `Successfully executed SQL query.\n\nSQL result:\n${sqlResult}`;
  },
};
