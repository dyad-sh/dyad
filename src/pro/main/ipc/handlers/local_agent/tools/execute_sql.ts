import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { executeSupabaseSql } from "../../../../../../supabase_admin/supabase_management_client";
import { writeMigrationFile } from "../../../../../../ipc/utils/file_utils";
import { readSettings } from "../../../../../../main/settings";

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
    isEnabled: (ctx) => !!ctx.supabaseProjectId,

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
      if (!ctx.supabaseProjectId) {
        throw new Error("Supabase is not connected to this app");
      }

      await executeSupabaseSql({
        supabaseProjectId: ctx.supabaseProjectId,
        query: args.query,
        organizationSlug: ctx.supabaseOrganizationSlug ?? null,
      });

      // Write migration file if enabled
      const settings = readSettings();
      if (settings.enableSupabaseWriteSqlMigration) {
        try {
          await writeMigrationFile(ctx.appPath, args.query, args.description);
        } catch (error) {
          return `SQL executed, but failed to write migration file: ${error}`;
        }
      }

      return "Successfully executed SQL query";
    },
  };
