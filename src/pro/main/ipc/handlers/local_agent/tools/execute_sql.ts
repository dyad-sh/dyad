import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { executeSupabaseSql } from "../../../../../../supabase_admin/supabase_management_client";
import { generateUndoSql } from "../../../../../../supabase_admin/undo_sql_generator";
import { writeMigrationFile } from "../../../../../../ipc/utils/file_utils";
import { readSettings } from "../../../../../../main/settings";
import log from "electron-log";

const logger = log.scope("execute_sql_tool");

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
    modifiesState: true,
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

      const sqlResult = await executeSupabaseSql({
        supabaseProjectId: ctx.supabaseProjectId,
        query: args.query,
        organizationSlug: ctx.supabaseOrganizationSlug ?? null,
      });

      // Generate undo-SQL and accumulate on context for deferred storage after commit
      try {
        const undoSql = generateUndoSql(args.query);
        logger.info(
          `[DEBUG-ROLLBACK] Forward SQL: ${args.query.slice(0, 200)}`,
        );
        logger.info(
          `[DEBUG-ROLLBACK] Generated undo-SQL: ${undoSql ?? "NULL (cannot reverse)"}`,
        );
        if (undoSql) {
          ctx.undoSqlParts.push(undoSql);
          logger.info(
            `[DEBUG-ROLLBACK] Accumulated undo-SQL (${ctx.undoSqlParts.length} parts so far)`,
          );
        } else {
          logger.warn(
            `Could not generate undo-SQL for agent query: ${args.query.slice(0, 100)}`,
          );
        }
      } catch (undoError) {
        logger.warn("Failed to generate undo-SQL in agent mode:", undoError);
      }

      // Write migration file if enabled
      const settings = readSettings();
      if (settings.enableSupabaseWriteSqlMigration) {
        try {
          await writeMigrationFile(ctx.appPath, args.query, args.description);
        } catch (error) {
          return `SQL executed, but failed to write migration file: ${error}\n\nSQL result:\n${sqlResult}`;
        }
      }

      return `Successfully executed SQL query.\n\nSQL result:\n${sqlResult}`;
    },
  };
