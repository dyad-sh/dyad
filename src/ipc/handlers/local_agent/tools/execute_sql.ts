import { z } from "zod";
import { ToolDefinition, ToolExecuteContext, escapeXmlAttr } from "./types";
import {
  executeSupabaseSqlQuery,
  type FileOperationContext,
} from "../../../processors/file_operations";

const executeSqlSchema = z.object({
  query: z.string().describe("The SQL query to execute"),
  description: z.string().optional().describe("Brief description of the query"),
});

export const executeSqlTool: ToolDefinition<z.infer<typeof executeSqlSchema>> =
  {
    name: "execute_sql",
    description: "Execute SQL on the Supabase database",
    inputSchema: executeSqlSchema,
    defaultConsent: "ask",
    execute: async (args, ctx: ToolExecuteContext) => {
      if (!ctx.supabaseProjectId) {
        throw new Error("Supabase is not connected to this app");
      }

      const allowed = await ctx.requireConsent({
        toolName: "execute_sql",
        toolDescription: "Execute SQL on the database",
        inputPreview:
          args.query.slice(0, 100) + (args.query.length > 100 ? "..." : ""),
      });
      if (!allowed) {
        throw new Error("User denied permission for execute_sql");
      }

      ctx.onXmlChunk(
        `<dyad-execute-sql description="${escapeXmlAttr(args.description ?? "")}">
${args.query}
</dyad-execute-sql>`,
      );

      const opCtx: FileOperationContext = {
        appPath: ctx.appPath,
        supabaseProjectId: ctx.supabaseProjectId,
      };

      const result = await executeSupabaseSqlQuery(
        opCtx,
        args.query,
        args.description,
      );
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.warning || "Successfully executed SQL query";
    },
  };
