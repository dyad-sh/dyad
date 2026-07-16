import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { executeSupabaseSql } from "../../../../../../supabase_admin/supabase_management_client";
import { executeNeonSql } from "../../../../../../neon_admin/neon_context";
import { writeMigrationFile } from "../../../../../../ipc/utils/file_utils";
import { readSettings } from "../../../../../../main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  doesSqlDeleteData,
  doesSqlMutateSchema,
} from "@/lib/sqlSchemaMutation";

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}

function doesSqlLikelyMutateState(sql: string): boolean {
  if (doesSqlMutateSchema(sql) || doesSqlDeleteData(sql)) {
    return true;
  }
  const firstStatement = stripSqlComments(sql).split(";")[0]?.trim() ?? "";
  if (/^with\b/i.test(firstStatement)) {
    return /\b(insert|update|delete|merge)\b/i.test(firstStatement);
  }
  const explained = firstStatement.match(/^explain(?:\s+analyze)?\s+(.+)$/i);
  if (explained) {
    return doesSqlLikelyMutateState(explained[1]);
  }
  // Treat clearly read-only statements as no-ops for run_tests gating. Unknown
  // SQL is counted conservatively because function calls and procedural blocks
  // can mutate data even when static analysis cannot prove it.
  return !/^(?:select|show|describe|desc)\b/i.test(firstStatement);
}

const executeSqlSchema = z.object({
  query: z.string().describe("The SQL query to execute"),
  description: z.string().optional().describe("Brief description of the query"),
});

export const executeSqlTool: ToolDefinition<z.infer<typeof executeSqlSchema>> =
  {
    name: "execute_sql",
    description:
      "Execute SQL on the connected database. Important: execute each SQL command separately (do not group multiple commands in a single query).",
    inputSchema: executeSqlSchema,
    defaultConsent: "ask",
    modifiesState: true,
    isEnabled: (ctx) =>
      !!ctx.supabaseProjectId ||
      (!!ctx.neonProjectId && !!ctx.neonActiveBranchId),

    getConsentPreview: (args) => args.query,

    getConsentMetadata: (args) => ({
      sqlMutatesSchema: doesSqlMutateSchema(args.query),
      sqlDeletesData: doesSqlDeleteData(args.query),
    }),

    shouldTrackMutation: (args) => doesSqlLikelyMutateState(args.query),

    buildXml: (args, isComplete) => {
      if (args.query == undefined) return undefined;

      let xml = `<dyad-execute-sql description="${escapeXmlAttr(args.description ?? "")}">\n${escapeXmlContent(args.query)}`;
      if (isComplete) {
        xml += "\n</dyad-execute-sql>";
      }
      return xml;
    },

    execute: async (args, ctx: AgentContext) => {
      if (ctx.neonProjectId && ctx.neonActiveBranchId) {
        const sqlResult = await executeNeonSql({
          projectId: ctx.neonProjectId,
          branchId: ctx.neonActiveBranchId,
          query: args.query,
        });
        return `Successfully executed SQL query.\n\nSQL result:\n${sqlResult}`;
      }

      if (ctx.neonProjectId && !ctx.neonActiveBranchId) {
        throw new DyadError(
          "Neon active branch not configured. Please select a branch in the Neon integration settings.",
          DyadErrorKind.Precondition,
        );
      }

      if (ctx.supabaseProjectId) {
        const sqlResult = await executeSupabaseSql({
          supabaseProjectId: ctx.supabaseProjectId,
          query: args.query,
          organizationSlug: ctx.supabaseOrganizationSlug ?? null,
        });

        const settings = readSettings();
        if (
          settings.enableSupabaseWriteSqlMigration &&
          doesSqlMutateSchema(args.query)
        ) {
          try {
            await writeMigrationFile(ctx.appPath, args.query, args.description);
          } catch (error) {
            return `SQL executed, but failed to write migration file: ${error}\n\nSQL result:\n${sqlResult}`;
          }
        }

        return `Successfully executed SQL query.\n\nSQL result:\n${sqlResult}`;
      }

      throw new DyadError(
        "No database is connected to this app",
        DyadErrorKind.Precondition,
      );
    },
  };
